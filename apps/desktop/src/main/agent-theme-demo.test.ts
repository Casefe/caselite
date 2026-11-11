import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: class {}, clipboard: {}, session: {} }));
import { syntheticAgentStream } from './agent-demo';
import { createPiRuntime } from './adapters/pi-runtime';

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('Network forbidden in synthetic theme test'));
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('offers one synthetic proposal only inside the existing agent-preview phase with a real granted tool', async () => {
  vi.stubEnv('CASELITE_TASK_DEMO', 'agent-preview');
  const propose = vi.fn();
  const result = await new Promise((resolve) =>
    createPiRuntime(syntheticAgentStream).start({
      model: 'gpt-4.1-mini',
      key: 'synthetic-only',
      prompt: '把 CaseLite 调成深色',
      theme: { target: 'dark', propose },
      onText: () => {},
      onEnd: resolve,
    }),
  );
  expect(propose).toHaveBeenCalledExactlyOnceWith({ theme: 'dark' });
  expect(result).toMatchObject({ status: 'succeeded' });
});

it.each(['agent', 'agent-home-check', ''])(
  'does not synthesize a write proposal for another phase: %s',
  async (phase) => {
    vi.stubEnv('CASELITE_TASK_DEMO', phase);
    const propose = vi.fn();
    const result = await new Promise((resolve) =>
      createPiRuntime(syntheticAgentStream).start({
        model: 'gpt-4.1-mini',
        key: 'synthetic-only',
        prompt: '调成深色',
        theme: { target: 'dark', propose },
        onText: () => {},
        onEnd: resolve,
      }),
    );
    expect(propose).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'failed' });
  },
);

it('keeps normal mock conversations text-only even when their input names a theme', async () => {
  vi.stubEnv('CASELITE_TASK_DEMO', 'agent-preview');
  const onText = vi.fn();
  const result = await new Promise((resolve) =>
    createPiRuntime(syntheticAgentStream).start({
      model: 'gpt-4.1-mini',
      key: 'synthetic-only',
      prompt: '调成深色',
      onText,
      onEnd: resolve,
    }),
  );
  expect(result).toMatchObject({ status: 'succeeded' });
  expect(onText).toHaveBeenCalled();
});

it('drops the offline proposal when the granted run is cancelled before completion', async () => {
  vi.stubEnv('CASELITE_TASK_DEMO', 'agent-preview');
  const propose = vi.fn(),
    onEnd = vi.fn();
  const handle = createPiRuntime(syntheticAgentStream).start({
    model: 'gpt-4.1-mini',
    key: 'synthetic-only',
    prompt: '调成深色',
    theme: { target: 'dark', propose },
    onText() {},
    onEnd,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  handle.cancel();
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(propose).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
});
