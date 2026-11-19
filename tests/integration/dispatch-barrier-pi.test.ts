import { expect, it } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createAgentApplication } from '../../packages/application/src/agent-application';
import { createAppearanceApplication } from '../../packages/application/src/appearance-application';
import type { Theme } from '../../packages/contracts/src';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';

// DEV-1759：真实 Pi Core + 真实 Application，Provider 流为合成替身（MOCK_ONLY provider）。
const message = (content: AssistantMessage['content'], stopReason: 'stop' | 'toolUse') =>
  ({
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 1,
  }) satisfies AssistantMessage;
const call = (name: string, args: Record<string, unknown>) =>
  ({ type: 'toolCall', id: 'synthetic-call', name, arguments: args }) as const;
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const start = (run_id: string, prompt: string) => ({
  protocol_version: 1,
  operation: 'start',
  scope: 'home',
  run_id,
  model: 'gpt-4.1-mini',
  prompt,
  confirmed: true,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function setup() {
  let theme: Theme = 'light';
  let dispatches = 0;
  const writes: Theme[] = [];
  const pending: Array<ReturnType<typeof createAssistantMessageEventStream>> = [];
  const signals: Array<AbortSignal | undefined> = [];
  const runtime = createPiRuntime((_model, _context, options) => {
    dispatches++;
    signals.push(options?.signal);
    const stream = createAssistantMessageEventStream();
    pending.push(stream);
    return stream;
  });
  const app = createAgentApplication({
    credentials: {
      get: () => 'synthetic-only',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    appearance: createAppearanceApplication({
      read: () => theme,
      write(value) {
        writes.push(value);
        theme = value;
      },
    }),
    runtime,
    taskExists: () => false,
  });
  const runs = async () => {
    const response = await app.execute(
      { protocol_version: 1, operation: 'read', scope: 'home' },
      'window',
    );
    if (!response.ok) throw new Error('read failed');
    return response.runs;
  };
  return { app, pending, signals, writes, runs, dispatches: () => dispatches };
}

it('rejects an unknown tool on a plain Run with no execution, no follow-up dispatch and no side effect', async () => {
  const s = setup();
  await s.app.execute(start(RUN_A, '普通问题'), 'window');
  await waitForDispatch(s);
  s.pending[0].push({
    type: 'done',
    reason: 'toolUse',
    message: message([call('bash', { command: 'cat private' })], 'toolUse'),
  });
  await settle();
  expect(await s.runs()).toMatchObject([{ id: RUN_A, status: 'failed' }]);
  expect(s.dispatches()).toBe(1);
  expect(s.writes).toEqual([]);
});

it('rejects a tool other than the single granted one on a theme Run', async () => {
  const s = setup();
  await s.app.execute(start(RUN_A, '把 CaseLite 调成深色'), 'window');
  await waitForDispatch(s);
  s.pending[0].push({
    type: 'done',
    reason: 'toolUse',
    message: message([call('sql_query', { sql: 'select 1' })], 'toolUse'),
  });
  await settle();
  expect(await s.runs()).toMatchObject([{ id: RUN_A, status: 'failed' }]);
  expect(s.dispatches()).toBe(1);
  expect(s.writes).toEqual([]);
});

it('aborts on Stop mid-tool, then a late tool call from the stopped Run cannot write or pollute the next Run', async () => {
  const s = setup();
  await s.app.execute(start(RUN_A, '把 CaseLite 调成深色'), 'window');
  await waitForDispatch(s);
  await s.app.execute(
    { protocol_version: 1, operation: 'cancel', scope: 'home', run_id: RUN_A },
    'window',
  );
  expect(s.signals[0]?.aborted).toBe(true);

  await s.app.execute(start(RUN_B, '普通问题'), 'window');
  await waitForDispatch(s, 2);
  s.pending[0].push({
    type: 'done',
    reason: 'toolUse',
    message: message([call('set_theme', { theme: 'dark' })], 'toolUse'),
  });
  await settle();
  const runs = await s.runs();
  expect(runs.find((run) => run.id === RUN_A)).toMatchObject({ status: 'cancelled' });
  expect(runs.find((run) => run.id === RUN_B)).toMatchObject({ status: 'running', output: '' });
  expect(s.writes).toEqual([]);
  expect(s.dispatches()).toBe(2);

  s.pending[1].push({
    type: 'done',
    reason: 'stop',
    message: message([{ type: 'text', text: '新 Run 输出' }], 'stop'),
  });
  await settle();
  expect(await s.runs()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: RUN_B, status: 'succeeded', output: '新 Run 输出' }),
      expect.objectContaining({
        id: RUN_A,
        status: 'cancelled',
        theme_command: expect.objectContaining({ state: 'rejected' }),
      }),
    ]),
  );
});

async function waitForDispatch(s: ReturnType<typeof setup>, count = 1) {
  for (let i = 0; i < 50 && s.dispatches() < count; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(s.dispatches()).toBeGreaterThanOrEqual(count);
}
