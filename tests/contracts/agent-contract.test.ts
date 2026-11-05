import { describe, expect, it, vi } from 'vitest';
import {
  createAgentApplication,
  type AgentRuntimePort,
} from '../../packages/application/src/agent-application';
import { agentRequestSchema } from '../../packages/contracts/src/agent';

const id = '11111111-1111-4111-8111-111111111111';
const start = {
  operation: 'start',
  protocol_version: 1,
  run_id: id,
  scope: 'home',
  prompt: '只处理本次文字',
  confirmed: true,
};
function setup(hasKey = true) {
  let callback: Parameters<AgentRuntimePort['start']>[0];
  const cancel = vi.fn();
  const runtime = {
    start: vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
      callback = input;
      return { cancel };
    }),
  };
  const app = createAgentApplication({
    credentials: {
      get: () => (hasKey ? 'synthetic-only' : undefined),
      set: vi.fn(),
      clear: vi.fn(),
    },
    runtime,
    taskExists: () => false,
  });
  return { app, runtime, cancel, callback: () => callback };
}
describe('Agent controlled boundary', () => {
  it('allows reconciliation of an accepted run while a new credential is being encrypted', async () => {
    let complete = () => {};
    let finish: Parameters<AgentRuntimePort['start']>[0]['onEnd'] = () => {};
    const saving = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const runtime = {
      start: vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
        finish = input.onEnd;
        return { cancel() {} };
      }),
    };
    const app = createAgentApplication({
      credentials: { get: () => 'synthetic-only', set: () => saving, clear() {} },
      runtime,
      taskExists: () => false,
    });
    await app.execute(start, 'window1');
    finish({ status: 'succeeded', message: '完成', usage: null });
    const setting = app.execute(
      { protocol_version: 1, operation: 'configure', key: 'sk-synthetic-only' },
      'window2',
    );
    expect(await app.execute(start, 'window1')).toMatchObject({
      ok: true,
      runs: [{ id, status: 'succeeded' }],
    });
    expect(runtime.start).toHaveBeenCalledTimes(1);
    complete();
    await setting;
  });
  it('does not start or replace credentials during asynchronous encryption', async () => {
    let complete = () => {};
    const saving = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const runtime = { start: vi.fn(() => ({ cancel() {} })) };
    const app = createAgentApplication({
      credentials: { get: () => 'synthetic-only', set: () => saving, clear() {} },
      runtime,
      taskExists: () => false,
    });
    const configured = app.execute(
      { protocol_version: 1, operation: 'configure', key: 'sk-synthetic-only' },
      'window1',
    );
    expect(await app.execute(start, 'window1')).toMatchObject({ code: 'BUSY' });
    expect(
      await app.execute({ protocol_version: 1, operation: 'clear_key' }, 'window1'),
    ).toMatchObject({ code: 'BUSY' });
    expect(runtime.start).not.toHaveBeenCalled();
    complete();
    expect((await configured).ok).toBe(true);
  });
  it('does not turn an accepted run into a failed receipt if credential status becomes unavailable', async () => {
    let reads = 0;
    let calls = 0;
    const app = createAgentApplication({
      credentials: {
        get() {
          if (++reads > 1) throw new Error('locked');
          return 'synthetic-only';
        },
        set() {},
        clear() {},
      },
      runtime: {
        start() {
          calls++;
          return { cancel() {} };
        },
      },
      taskExists: () => false,
    });
    expect(await app.execute(start, 'window1')).toMatchObject({
      ok: true,
      runs: [{ id, status: 'running' }],
    });
    expect(await app.execute(start, 'window1')).toMatchObject({ ok: true, runs: [{ id }] });
    expect(calls).toBe(1);
  });
  it('rejects extra content, absent confirmation, wrong task and missing key without dispatch', async () => {
    const { app, runtime } = setup(false);
    for (const command of [
      { ...start, path: '/private' },
      { ...start, history: [] },
      { ...start, confirmed: false },
    ])
      expect(agentRequestSchema.safeParse(command).success).toBe(false);
    expect(await app.execute(start, 'window1')).toMatchObject({ ok: false, code: 'NO_KEY' });
    expect(await app.execute({ ...start, scope: id }, 'window1')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(runtime.start).not.toHaveBeenCalled();
  });
  it('deduplicates run identity and refuses changed input or a concurrent run', async () => {
    const { app, runtime } = setup();
    expect((await app.execute(start, 'window1')).ok).toBe(true);
    await app.execute(start, 'window1');
    expect(await app.execute({ ...start, prompt: 'changed' }, 'window1')).toMatchObject({
      code: 'CONFLICT',
    });
    expect(
      await app.execute({ ...start, run_id: '22222222-2222-4222-8222-222222222222' }, 'window1'),
    ).toMatchObject({ code: 'BUSY' });
    expect(runtime.start).toHaveBeenCalledTimes(1);
  });
  it('isolates windows and scope; cancelled runs reject late output and completion', async () => {
    const { app, callback, cancel } = setup();
    await app.execute(start, 'window1');
    callback().onText('部分输出');
    expect(
      await app.execute({ operation: 'read', protocol_version: 1, scope: 'home' }, 'window2'),
    ).toMatchObject({ runs: [] });
    const stop = { operation: 'cancel', protocol_version: 1, scope: 'home', run_id: id };
    expect(await app.execute(stop, 'window2')).toMatchObject({ code: 'NOT_FOUND' });
    await app.execute(stop, 'window1');
    callback().onText('迟到内容');
    callback().onEnd({ status: 'succeeded', message: 'late', usage: null });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      await app.execute({ operation: 'read', protocol_version: 1, scope: 'home' }, 'window1'),
    ).toMatchObject({ runs: [{ status: 'cancelled', output: '部分输出' }] });
  });
  it('redacts credential failures and stops owned runs when the window closes', async () => {
    const { app, cancel } = setup();
    await app.execute(start, 'window1');
    app.release('window1');
    expect(cancel).toHaveBeenCalledOnce();
    const broken = createAgentApplication({
      credentials: {
        get: () => {
          throw new Error('private-key-path');
        },
        set() {},
        clear() {},
      },
      runtime: {
        start() {
          throw new Error();
        },
      },
      taskExists: () => false,
    });
    expect(
      JSON.stringify(await broken.execute({ operation: 'profile', protocol_version: 1 }, 'x')),
    ).not.toContain('private-key-path');
  });
});
