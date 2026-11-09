import { expect, it, vi } from 'vitest';
import type { AgentRun } from '@caselite/contracts';
import { createAgentApplication, type AgentRuntimePort } from './agent-application';

const run = (scope: string, status: AgentRun['status'] = 'running'): AgentRun => ({
  id: crypto.randomUUID(),
  scope,
  status,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  prompt: '合成工作',
  output: '',
  sequence: 1,
  message: '生成中',
  usage: null,
});
const credentials = {
  get: () => 'synthetic-only',
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};
const query = { protocol_version: 1, operation: 'active_runs' };

it('reads all accessible active scopes beyond the five-round history without starting or saving a Run', async () => {
  const taskId = crypto.randomUUID(),
    objectId = crypto.randomUUID();
  const active = [
    'home',
    taskId,
    `project:${objectId}`,
    `document:${objectId}`,
    `contact:${objectId}`,
  ].map((s) => run(s));
  active.push({ ...run(taskId), purpose: 'important_dates' });
  const hidden = [
    run(crypto.randomUUID()),
    ...['project:', 'document:', 'contact:'].map((prefix) => run(prefix + crypto.randomUUID())),
  ];
  const terminal = (['succeeded', 'failed', 'cancelled', 'interrupted'] as const).map((status) =>
    run('home', status),
  );
  const runtime = { start: vi.fn(() => ({ cancel() {} })) },
    save = vi.fn();
  const app = createAgentApplication({
    credentials,
    runtime,
    taskExists: (id) => id === taskId,
    project: { exists: (id) => id === objectId, preview: () => undefined },
    contact: { exists: (id) => id === objectId },
    review: {
      exists: (id) => id === objectId,
      matches: () => false,
      receipt: () => undefined,
      apply: () => ({ code: 'UNAVAILABLE', message: '' }),
    },
    history: {
      load: () => [...active, ...hidden, ...terminal],
      register: (value) => ({ created: true, run: value }),
      save,
    },
  });
  expect(await app.execute(query, 'window')).toMatchObject({ ok: true, runs: active });
  expect(runtime.start).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(await app.execute({ ...query, scope: 'home' }, 'window')).toMatchObject({
    code: 'INVALID_REQUEST',
  });
});

it('isolates live windows, reflects progress and removes terminal Runs', async () => {
  let callbacks!: Parameters<AgentRuntimePort['start']>[0];
  const app = createAgentApplication({
    credentials,
    taskExists: () => false,
    runtime: {
      start(input) {
        callbacks = input;
        return { cancel() {} };
      },
    },
  });
  const id = crypto.randomUUID();
  await app.execute(
    {
      protocol_version: 1,
      operation: 'start',
      scope: 'home',
      run_id: id,
      prompt: '工作',
      confirmed: true,
    },
    'first',
  );
  expect(await app.execute(query, 'second')).toMatchObject({ ok: true, runs: [] });
  callbacks.onText('实时文字');
  expect(await app.execute(query, 'first')).toMatchObject({
    ok: true,
    runs: [{ id, output: '实时文字' }],
  });
  callbacks.onEnd({ status: 'succeeded', message: '完成', usage: null });
  expect(await app.execute(query, 'first')).toMatchObject({ ok: true, runs: [] });
});

it('reports unreadable history instead of a false empty state', async () => {
  const app = createAgentApplication({
    credentials,
    taskExists: () => false,
    runtime: { start: () => ({ cancel() {} }) },
    history: {
      load() {
        throw new Error('unreadable');
      },
      register: (value) => ({ created: true, run: value }),
      save() {},
    },
  });
  expect(await app.execute(query, 'window')).toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
});
