import { expect, it, vi } from 'vitest';
import { createAgentApplication } from '../../packages/application/src/agent-application';
const start = {
  protocol_version: 1,
  operation: 'start',
  scope: 'home',
  model: 'gpt-4.1-mini',
  run_id: '11111111-1111-4111-8111-111111111111',
  context_id: '22222222-2222-4222-8222-222222222222',
  prompt: '核对材料',
  confirmed: true,
};
function setup() {
  let complete!: (text: string) => void;
  const context = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const runtime = { start: vi.fn(() => ({ cancel: vi.fn() })) };
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
    resolveContext: () => context,
  });
  return { app, runtime, complete };
}
it('does not dispatch selected material after its window closes during preparation', async () => {
  const s = setup();
  const pending = s.app.execute(start, 'window');
  s.app.release('window');
  s.complete('合成材料');
  expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
  expect(s.runtime.start).not.toHaveBeenCalled();
});
it('application shutdown also cancels a preparing run', async () => {
  const s = setup();
  const pending = s.app.execute(start, 'window');
  s.app.release();
  s.complete('合成材料');
  expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
  expect(s.runtime.start).not.toHaveBeenCalled();
});
it('serializes prepare with new dispatch and model changes, then preserves context identity', async () => {
  const s = setup();
  const pending = s.app.execute(start, 'window');
  expect(
    await s.app.execute({ ...start, run_id: '33333333-3333-4333-8333-333333333333' }, 'window'),
  ).toMatchObject({ ok: false, code: 'BUSY' });
  expect(
    await s.app.execute({ protocol_version: 1, operation: 'clear_key' }, 'window'),
  ).toMatchObject({ ok: false, code: 'BUSY' });
  s.complete('固定材料 payload');
  expect(await pending).toMatchObject({ ok: true });
  expect(s.runtime.start).toHaveBeenCalledTimes(1);
  expect(s.runtime.start.mock.calls[0][0]).toMatchObject({ prompt: '固定材料 payload' });
  expect(
    await s.app.execute({ ...start, context_id: '44444444-4444-4444-8444-444444444444' }, 'window'),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(s.runtime.start).toHaveBeenCalledTimes(1);
});
