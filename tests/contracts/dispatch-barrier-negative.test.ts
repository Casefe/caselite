import { describe, expect, it, vi } from 'vitest';
import {
  createAgentApplication,
  type AgentRuntimePort,
} from '../../packages/application/src/agent-application';
import { createAppearanceApplication } from '../../packages/application/src/appearance-application';
import type { Theme } from '../../packages/contracts/src';

// DEV-1759：只复用 DEV-1652/1654 已有的 Application 入口验证派发屏障的负向路径；
// 不新增 Runtime、工具或权限服务。全部输入为合成数据，运行端口为替身（MOCK_ONLY）。
type StartInput = Parameters<AgentRuntimePort['start']>[0];

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const CONTEXT = '33333333-3333-4333-8333-333333333333';
const request = (run_id: string, extra: Record<string, unknown> = {}) => ({
  protocol_version: 1,
  operation: 'start',
  scope: 'home',
  model: 'gpt-4.1-mini',
  run_id,
  prompt: '合成派发屏障输入',
  confirmed: true,
  ...extra,
});
const cancel = (run_id: string) => ({
  protocol_version: 1,
  operation: 'cancel',
  scope: 'home',
  run_id,
});
const read = { protocol_version: 1, operation: 'read', scope: 'home' };

function setup(options: { appearance?: boolean; deferContext?: boolean } = {}) {
  const inputs: StartInput[] = [];
  const cancels: Array<ReturnType<typeof vi.fn>> = [];
  const runtime: AgentRuntimePort = {
    start: vi.fn((input: StartInput) => {
      inputs.push(input);
      const stop = vi.fn();
      cancels.push(stop);
      return { cancel: stop };
    }),
  };
  let theme: Theme = 'light';
  const write = vi.fn((value: Theme) => {
    theme = value;
  });
  let releaseContext!: (text: string) => void;
  const context = new Promise<string>((resolve) => {
    releaseContext = resolve;
  });
  const app = createAgentApplication({
    credentials: {
      get: () => 'synthetic-only',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    runtime,
    taskExists: () => true,
    ...(options.appearance
      ? { appearance: createAppearanceApplication({ read: () => theme, write }) }
      : {}),
    ...(options.deferContext ? { resolveContext: () => context } : {}),
  });
  const runs = async (owner = 'window') => {
    const response = await app.execute(read, owner);
    if (!response.ok) throw new Error('read failed');
    return response.runs;
  };
  return { app, runtime, inputs, cancels, write, runs, releaseContext };
}

describe('DEV-1759 dispatch barrier negative paths (MOCK_ONLY runtime port)', () => {
  it('does not dispatch when Stop arrives before the preprocessing step finishes', async () => {
    const s = setup({ deferContext: true });
    const pending = s.app.execute(request(RUN_A, { context_id: CONTEXT }), 'window');
    expect(await s.app.execute(cancel(RUN_A), 'window')).toMatchObject({ ok: true, runs: [] });
    s.releaseContext('合成材料，迟到完成');
    expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(s.runtime.start).toHaveBeenCalledTimes(0);
    expect(await s.runs()).toEqual([]);
  });

  it('keeps Stop from an unrelated window or run from cancelling the preparing run', async () => {
    const s = setup({ deferContext: true });
    const pending = s.app.execute(request(RUN_A, { context_id: CONTEXT }), 'window');
    await s.app.execute(cancel(RUN_A), 'other-window');
    await s.app.execute(cancel(RUN_B), 'window');
    s.releaseContext('合成材料');
    expect(await pending).toMatchObject({ ok: true });
    expect(s.runtime.start).toHaveBeenCalledTimes(1);
  });

  it('stops a running Run once and ignores every later event from the stopped Run', async () => {
    const s = setup();
    await s.app.execute(request(RUN_A), 'window');
    s.inputs[0].onText('停止前的输出');
    await s.app.execute(cancel(RUN_A), 'window');
    await s.app.execute(cancel(RUN_A), 'window');
    s.inputs[0].onText('停止后迟到的输出');
    s.inputs[0].onEnd({ status: 'succeeded', message: '迟到完成', usage: { input: 9, output: 9 } });
    expect(s.cancels[0]).toHaveBeenCalledTimes(1);
    expect(s.runtime.start).toHaveBeenCalledTimes(1);
    expect(await s.runs()).toMatchObject([
      { id: RUN_A, status: 'cancelled', output: '停止前的输出', usage: null },
    ]);
  });

  it('lets late events of a stopped Run neither alter nor end a new Run', async () => {
    const s = setup();
    await s.app.execute(request(RUN_A), 'window');
    await s.app.execute(cancel(RUN_A), 'window');
    await s.app.execute(request(RUN_B, { prompt: '合成第二次输入' }), 'window');
    expect(s.runtime.start).toHaveBeenCalledTimes(2);

    s.inputs[0].onText('旧 Run 的迟到输出');
    s.inputs[0].onEnd({ status: 'failed', message: '旧 Run 的迟到失败', usage: null });
    let runs = await s.runs();
    expect(runs.find((run) => run.id === RUN_B)).toMatchObject({
      status: 'running',
      output: '',
      message: '',
      sequence: 0,
      usage: null,
    });
    expect(runs.find((run) => run.id === RUN_A)).toMatchObject({ status: 'cancelled', output: '' });

    s.inputs[1].onText('新 Run 的输出');
    s.inputs[1].onEnd({ status: 'succeeded', message: '完成', usage: { input: 1, output: 2 } });
    s.inputs[0].onText('旧 Run 在新 Run 完成后的输出');
    runs = await s.runs();
    expect(runs.find((run) => run.id === RUN_B)).toMatchObject({
      status: 'succeeded',
      output: '新 Run 的输出',
      usage: { input: 1, output: 2 },
    });
    expect(s.cancels[1]).not.toHaveBeenCalled();
  });

  it('rejects a tool proposal that arrives after Stop and never writes the setting', async () => {
    const s = setup({ appearance: true });
    await s.app.execute(request(RUN_A, { prompt: '调成深色' }), 'window');
    const theme = s.inputs[0].theme!;
    await s.app.execute(cancel(RUN_A), 'window');
    expect(() => theme.propose({ theme: 'dark' })).toThrow();
    s.inputs[0].onEnd({ status: 'succeeded', message: '迟到', usage: null });
    expect(s.write).not.toHaveBeenCalled();
    expect(await s.runs()).toMatchObject([{ id: RUN_A, status: 'cancelled' }]);
  });

  it('rejects a tool proposal that carries an undeclared field or another target', async () => {
    const s = setup({ appearance: true });
    await s.app.execute(request(RUN_A, { prompt: '调成深色' }), 'window');
    const theme = s.inputs[0].theme!;
    theme.propose({ theme: 'dark', shell: 'cat private' });
    s.inputs[0].onEnd({ status: 'succeeded', message: '完成', usage: null });
    expect(s.write).not.toHaveBeenCalled();
    expect(await s.runs()).toMatchObject([{ id: RUN_A, status: 'failed' }]);
  });
});
