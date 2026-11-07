import { expect, it, vi } from 'vitest';
import { createAgentApplication, type AgentRuntimePort } from './agent-application';
import type { AgentRun } from '@caselite/contracts';

const id = '31313131-3131-4131-8131-313131313131';
const credentials = {
  get: () => undefined,
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};
const run: AgentRun = {
  id,
  scope: 'home',
  model: 'gpt-4.1-mini',
  provider: 'openai',
  prompt: '要求',
  output: '**合成输出**',
  status: 'succeeded',
  sequence: 1,
  message: '完成',
  usage: null,
};
const copy = { protocol_version: 1, operation: 'copy_output', scope: 'home', run_id: id };

it('copies only the exact accessible stored output without a Key or model dispatch', async () => {
  const copyOutput = vi.fn();
  const runtime = { start: vi.fn(() => ({ cancel() {} })) };
  const app = createAgentApplication({
    credentials,
    runtime,
    copyOutput,
    history: { load: () => [run], register: (value) => ({ created: true, run: value }), save() {} },
    taskExists: () => true,
  });
  expect(await app.execute({ ...copy, text: '任意替换内容' }, 'window')).toMatchObject({
    code: 'INVALID_REQUEST',
  });
  expect(
    await app.execute({ ...copy, scope: '32323232-3232-4232-8232-323232323232' }, 'window'),
  ).toMatchObject({ code: 'NOT_FOUND' });
  expect(
    await app.execute({ ...copy, run_id: '33333333-3333-4333-8333-333333333333' }, 'window'),
  ).toMatchObject({ code: 'NOT_FOUND' });
  expect(copyOutput).not.toHaveBeenCalled();
  expect(await app.execute(copy, 'window')).toMatchObject({ ok: true });
  expect(copyOutput).toHaveBeenCalledExactlyOnceWith(run.output);
  expect(runtime.start).not.toHaveBeenCalled();
});

it('rejects another live window and reports clipboard failure without changing the Run', async () => {
  const copyOutput = vi.fn(() => {
    throw new Error('Clipboard unavailable');
  });
  const runtime = {
    start: vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
      input.onText(run.output);
      input.onEnd({ status: 'succeeded', usage: null, message: '完成' });
      return { cancel() {} };
    }),
  };
  const app = createAgentApplication({
    credentials: { ...credentials, get: () => 'synthetic-only' },
    runtime,
    copyOutput,
    taskExists: () => false,
  });
  await app.execute(
    {
      protocol_version: 1,
      operation: 'start',
      scope: 'home',
      run_id: id,
      prompt: '要求',
      confirmed: true,
    },
    'window1',
  );
  expect(await app.execute(copy, 'window2')).toMatchObject({ code: 'NOT_FOUND' });
  expect(copyOutput).not.toHaveBeenCalled();
  expect(await app.execute(copy, 'window1')).toMatchObject({ code: 'COPY_FAILED' });
  expect(
    await app.execute({ protocol_version: 1, operation: 'read', scope: 'home' }, 'window1'),
  ).toMatchObject({ ok: true, runs: [{ output: run.output, status: 'succeeded' }] });
  expect(runtime.start).toHaveBeenCalledTimes(1);
});

it.each(['', 'x'.repeat(64_001)])('rejects empty or oversized stored output', async (output) => {
  const copyOutput = vi.fn();
  const app = createAgentApplication({
    credentials,
    runtime: { start: () => ({ cancel() {} }) },
    copyOutput,
    taskExists: () => true,
    history: {
      load: () => [{ ...run, output }],
      register: (value) => ({ created: true, run: value }),
      save() {},
    },
  });
  expect(await app.execute(copy, 'window')).toMatchObject({ code: 'COPY_UNAVAILABLE' });
  expect(copyOutput).not.toHaveBeenCalled();
});

it('waits for asynchronous native clipboard completion and reports asynchronous rejection', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const copyOutput = vi.fn(() => pending);
  const app = createAgentApplication({
    credentials,
    runtime: { start: () => ({ cancel() {} }) },
    copyOutput,
    taskExists: () => true,
    history: { load: () => [run], register: (value) => ({ created: true, run: value }), save() {} },
  });
  let confirmed = false;
  const request = app.execute(copy, 'window').then((result) => {
    confirmed = true;
    return result;
  });
  await Promise.resolve();
  expect(copyOutput).toHaveBeenCalledExactlyOnceWith(run.output);
  expect(confirmed).toBe(false);
  finish();
  expect(await request).toMatchObject({ ok: true });
  copyOutput.mockImplementationOnce(async () => {
    throw new Error('Native clipboard rejected');
  });
  expect(await app.execute(copy, 'window')).toMatchObject({ code: 'COPY_FAILED' });
  expect(
    await app.execute({ protocol_version: 1, operation: 'read', scope: 'home' }, 'window'),
  ).toMatchObject({ ok: true, runs: [{ output: run.output, status: 'succeeded' }] });
});
