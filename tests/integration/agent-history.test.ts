import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src/index';
import {
  createAgentApplication,
  type AgentRuntimePort,
} from '../../packages/application/src/agent-application';
import type { AgentResponse } from '../../packages/contracts/src/index';
const roots: string[] = [],
  migrations = resolve('packages/local-db/migrations');
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));
const credentials = {
  get: () => 'synthetic-history-key',
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};
const request = (scope = 'home') => ({
  protocol_version: 1 as const,
  operation: 'start' as const,
  model: 'gpt-4.1-mini' as const,
  scope,
  run_id: randomUUID(),
  prompt: '仅本次确认输入',
  confirmed: true as const,
});
function ok(r: AgentResponse) {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-agent-history-'));
  roots.push(root);
  const file = join(root, 'data.sqlite');
  return { file, store: openTaskStore(file, migrations) };
}
describe('durable local Run projections', () => {
  it('recovers interrupted output without another dispatch, and replays the same run after restart', async () => {
    const { file, store } = setup();
    let callbacks: Parameters<AgentRuntimePort['start']>[0] | undefined;
    const start = vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
      callbacks = input;
      return { cancel: vi.fn() };
    });
    const app = createAgentApplication({
      credentials,
      runtime: { start },
      taskExists: () => true,
      history: store.agentHistory,
    });
    const r = request();
    ok(await app.execute(r, 'first'));
    callbacks!.onText('已保存的部分输出');
    expect(start).toHaveBeenCalledTimes(1);
    store.close();
    const next = openTaskStore(file, migrations);
    next.agentHistory.recoverInterrupted();
    const runtime = { start: vi.fn(() => ({ cancel: vi.fn() })) },
      reopened = createAgentApplication({
        credentials,
        runtime,
        taskExists: () => true,
        history: next.agentHistory,
      });
    const run = ok(
      await reopened.execute(
        { protocol_version: 1, operation: 'read', scope: 'home' },
        'new-window',
      ),
    ).runs[0];
    expect(run).toMatchObject({
      id: r.run_id,
      status: 'interrupted',
      output: '已保存的部分输出',
      usage: null,
    });
    expect(run.message).toContain('未自动重试');
    expect(ok(await reopened.execute(r, 'new-window')).runs[0].id).toBe(r.run_id);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(await reopened.execute({ ...r, model: 'deepseek-flash' }, 'new-window')).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    next.close();
  });
  it('preserves completed and cancelled runs while refusing late callbacks and cross-task reads', async () => {
    const { file, store } = setup();
    let callback: Parameters<AgentRuntimePort['start']>[0] | undefined;
    const app = createAgentApplication({
      credentials,
      history: store.agentHistory,
      taskExists: () => true,
      runtime: {
        start(input) {
          callback = input;
          return { cancel() {} };
        },
      },
    });
    const scope = randomUUID(),
      first = request(scope);
    ok(await app.execute(first, 'owner'));
    callback!.onText('完成输出');
    callback!.onEnd({ status: 'succeeded', usage: { input: 4, output: 8 }, message: '完成' });
    const second = request(scope);
    ok(await app.execute(second, 'owner'));
    ok(
      await app.execute(
        { protocol_version: 1, operation: 'cancel', scope, run_id: second.run_id },
        'owner',
      ),
    );
    callback!.onText('不应保存的迟到输出');
    callback!.onEnd({ status: 'succeeded', usage: { input: 99, output: 99 }, message: '迟到' });
    store.close();
    const next = openTaskStore(file, migrations);
    next.agentHistory.recoverInterrupted();
    const reopened = createAgentApplication({
      credentials,
      history: next.agentHistory,
      taskExists: () => true,
      runtime: { start: vi.fn(() => ({ cancel() {} })) },
    });
    const runs = ok(
      await reopened.execute({ protocol_version: 1, operation: 'read', scope }, 'after'),
    ).runs;
    expect(runs[0]).toMatchObject({
      id: first.run_id,
      status: 'succeeded',
      output: '完成输出',
      usage: { input: 4, output: 8 },
    });
    expect(runs[1]).toMatchObject({
      id: second.run_id,
      status: 'cancelled',
      output: '',
      usage: null,
    });
    expect(
      ok(
        await reopened.execute(
          { protocol_version: 1, operation: 'read', scope: randomUUID() },
          'after',
        ),
      ).runs,
    ).toEqual([]);
    next.close();
  });
  it('never dispatches if the initial local record cannot be saved', async () => {
    const runtime = { start: vi.fn(() => ({ cancel() {} })) };
    const app = createAgentApplication({
      credentials,
      runtime,
      taskExists: () => true,
      history: {
        register(run) {
          void run;
          throw new Error('disk full');
        },
        load: () => [],
        save() {
          throw new Error('disk full');
        },
      },
    });
    const r = request();
    expect(await app.execute(r, 'owner')).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(runtime.start).not.toHaveBeenCalled();
    expect(await app.execute(r, 'owner')).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(runtime.start).not.toHaveBeenCalled();
  });
  it('stops on a checkpoint write failure and never accepts the later provider success', async () => {
    let count = 0,
      callback: Parameters<AgentRuntimePort['start']>[0] | undefined;
    const cancel = vi.fn();
    const app = createAgentApplication({
      credentials,
      taskExists: () => true,
      history: {
        register(run) {
          count++;
          return { created: true, run };
        },
        load: () => [],
        save() {
          if (++count > 1) throw new Error('storage failure');
        },
      },
      runtime: {
        start(input) {
          callback = input;
          return { cancel };
        },
      },
    });
    const r = request();
    ok(await app.execute(r, 'owner'));
    callback!.onText('未能确认落盘');
    callback!.onEnd({ status: 'succeeded', message: '不应成功', usage: { input: 1, output: 1 } });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(
      ok(await app.execute({ protocol_version: 1, operation: 'read', scope: 'home' }, 'owner'))
        .runs[0],
    ).toMatchObject({ status: 'failed', usage: null });
  });
  it('isolates workspaces and stores no credential fields', () => {
    const { file, store } = setup(),
      r = request();
    store.agentHistory.register({
      id: r.run_id,
      scope: 'home',
      prompt: r.prompt,
      output: '结果',
      provider: 'openai',
      model: r.model,
      status: 'succeeded',
      sequence: 1,
      message: '完成',
      usage: null,
      ...{ apiKey: 'synthetic-secret-must-be-stripped' },
    });
    const db = openToolchainProbe(file, migrations);
    expect(JSON.stringify(db.sqlite.prepare('SELECT payload FROM agent_runs').get())).not.toContain(
      'synthetic-secret-must-be-stripped',
    );
    db.sqlite.close();
    const other = openTaskStore(file, migrations, 'other');
    expect(other.agentHistory.load()).toEqual([]);
    other.close();
    store.close();
  });
  it('keeps model dispatch disabled if history is corrupt while profile settings remain usable', async () => {
    const runtime = { start: vi.fn(() => ({ cancel() {} })) };
    const app = createAgentApplication({
      credentials,
      runtime,
      taskExists: () => true,
      history: {
        register(run) {
          return { created: true, run };
        },
        load() {
          throw new Error('corrupt');
        },
        save() {},
      },
    });
    expect((await app.execute({ protocol_version: 1, operation: 'profile' }, 'owner')).ok).toBe(
      true,
    );
    expect(await app.execute(request(), 'owner')).toMatchObject({
      ok: false,
      code: 'HISTORY_UNAVAILABLE',
    });
    expect(runtime.start).not.toHaveBeenCalled();
  });
  it('claims one Run atomically across two preloaded applications and never replaces its input', async () => {
    const { file, store } = setup(),
      other = openTaskStore(file, migrations);
    const firstRuntime = { start: vi.fn(() => ({ cancel() {} })) },
      secondRuntime = { start: vi.fn(() => ({ cancel() {} })) };
    const a = createAgentApplication({
        credentials,
        taskExists: () => true,
        history: store.agentHistory,
        runtime: firstRuntime,
      }),
      b = createAgentApplication({
        credentials,
        taskExists: () => true,
        history: other.agentHistory,
        runtime: secondRuntime,
      });
    const r = request();
    ok(await a.execute(r, 'first'));
    ok(await b.execute(r, 'second'));
    expect(firstRuntime.start).toHaveBeenCalledTimes(1);
    expect(secondRuntime.start).not.toHaveBeenCalled();
    expect(await b.execute({ ...r, prompt: '不能覆盖的新输入' }, 'second')).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(store.agentHistory.load()[0].prompt).toBe(r.prompt);
    other.close();
    store.close();
  });
  it('makes released-window terminal history visible to the next local window', async () => {
    const { store } = setup();
    let callback: Parameters<AgentRuntimePort['start']>[0] | undefined;
    const app = createAgentApplication({
      credentials,
      taskExists: () => true,
      history: store.agentHistory,
      runtime: {
        start(input) {
          callback = input;
          return { cancel() {} };
        },
      },
    });
    const r = request();
    ok(await app.execute(r, 'window1'));
    callback!.onText('已完成');
    callback!.onEnd({ status: 'succeeded', usage: null, message: '完成' });
    app.release('window1');
    expect(
      ok(await app.execute({ protocol_version: 1, operation: 'read', scope: 'home' }, 'window2'))
        .runs[0],
    ).toMatchObject({ id: r.run_id, status: 'succeeded' });
    store.close();
  });
});
