import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentApplication, type AgentRuntimePort } from '@caselite/application';
import type { AgentRun } from '@caselite/contracts';
const probe = vi.hoisted(() => ({
  network: vi.fn(() => ({})),
  messages: undefined as unknown,
  tokens: 2048,
  last: undefined as Parameters<AgentRuntimePort['start']>[0] | undefined,
}));
vi.mock('@earendil-works/pi-ai', () => ({
  createModels: () => ({ setProvider() {}, streamSimple: probe.network }),
  getCurrentTools: (messages: { tools?: unknown[] }[]) =>
    messages.flatMap((message) => message.tools ?? []),
}));
vi.mock('@earendil-works/pi-ai/providers/openai', () => ({ openaiProvider: () => ({}) }));
vi.mock('@earendil-works/pi-ai/providers/deepseek', () => ({ deepseekProvider: () => ({}) }));
vi.mock('./agent-demo', () => ({ syntheticAgentStream: vi.fn() }));
vi.mock('./adapters/pi-runtime', () => ({
  createPiRuntime: (stream: (...args: unknown[]) => unknown) => ({
    start(input: Parameters<AgentRuntimePort['start']>[0]) {
      probe.last = input;
      stream(
        { id: input.model },
        {
          messages: probe.messages ?? [
            { role: 'system', content: 'fixed synthetic system' },
            { role: 'user', content: input.prompt },
          ],
        },
        { maxTokens: probe.tokens, maxRetries: 0 },
      );
      return { cancel() {} };
    },
  }),
}));
import { createRealDemoRuntime } from './agent-real-demo';
import { realDemoMarker, realDemoPrompts } from './agent-real-policy';
let roots: string[] = [];
let run: AgentRun;
beforeEach(() => {
  probe.network.mockClear();
  probe.messages = undefined;
  probe.tokens = 2048;
  probe.last = undefined;
  run = {
    id: '11111111-1111-4111-8111-111111111111',
    scope: 'home',
    model: 'gpt-4.1-mini',
    provider: 'openai',
    prompt: realDemoPrompts[0],
    output: '',
    status: 'running',
    sequence: 0,
    message: '',
    usage: null,
  };
});
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});
function setup(source = true) {
  const directory = mkdtempSync(join(tmpdir(), 'caselite-real-runtime-'));
  roots.push(directory);
  return createRealDemoRuntime({
    directory,
    model: 'gpt-4.1-mini',
    dry: false,
    runs: () => [run],
    verifySource: () => source,
  });
}
const input = () => ({
  model: 'gpt-4.1-mini' as const,
  prompt: run.prompt,
  key: 'synthetic-only',
  onText() {},
  onEnd() {},
});
it.each([
  'model',
  'image',
  'scope',
  'attachment',
  'instruction',
  'history',
  'tools',
  'tokens',
] as const)('refuses %s mismatch before SDK dispatch', (mismatch) => {
  const runtime = setup();
  const request = input();
  if (mismatch === 'model') request.model = 'deepseek-flash' as never;
  if (mismatch === 'image')
    Object.assign(request, {
      images: [{ type: 'image', mimeType: 'image/png', data: 'synthetic' }],
    });
  if (mismatch === 'scope') run.scope = '22222222-2222-4222-8222-222222222222';
  if (mismatch === 'attachment') run.context_id = '22222222-2222-4222-8222-222222222222';
  if (mismatch === 'instruction') request.prompt = 'outside authorization';
  if (mismatch === 'history')
    probe.messages = [{ role: 'system' }, { role: 'user' }, { role: 'assistant' }];
  if (mismatch === 'tools')
    probe.messages = [{ role: 'system', tools: [{ name: 'shell' }] }, { role: 'user' }];
  if (mismatch === 'tokens') probe.tokens = 4096;
  expect(() => runtime.start(request)).toThrow();
  expect(probe.network).not.toHaveBeenCalled();
});
it.each(['source', 'marker', 'page'] as const)(
  'refuses PDF %s mismatch before a second SDK dispatch',
  (mismatch) => {
    const runtime = setup(mismatch !== 'source');
    runtime.start(input());
    probe.last!.onEnd({
      status: 'succeeded',
      usage: { input: 1, output: 1 },
      message: 'synthetic',
    });
    run = { ...run, id: '22222222-2222-4222-8222-222222222222', prompt: realDemoPrompts[1] };
    const request = input();
    request.prompt += `${mismatch === 'marker' ? 'missing' : realDemoMarker} ${mismatch === 'page' ? 'page missing' : '物理页 1'}`;
    expect(() => runtime.start(request)).toThrow();
    expect(probe.network).toHaveBeenCalledTimes(1);
  },
);
it('persists the first identity before SDK use, and stops after a failed receipt', () => {
  const runtime = setup();
  runtime.start(input());
  expect(probe.network).toHaveBeenCalledTimes(1);
  probe.last!.onEnd({ status: 'failed', usage: null, message: 'synthetic failure' });
  run = { ...run, id: '22222222-2222-4222-8222-222222222222', prompt: realDemoPrompts[1] };
  expect(() =>
    runtime.start({ ...input(), prompt: realDemoPrompts[1] + realDemoMarker + '物理页 1' }),
  ).toThrow();
  expect(probe.network).toHaveBeenCalledTimes(1);
});

it('does not open a budget or consume a resume marker on a credential preflight failure', async () => {
  const runtime = setup();
  const root = roots.at(-1)!;
  expect(existsSync(join(root, 'validation-started.json'))).toBe(false);
  const app = createAgentApplication({
    runtime,
    credentials: {
      get() {
        throw new Error('unavailable');
      },
      getDefaultModel: () => 'gpt-4.1-mini',
      set() {},
      clear() {},
      setDefaultModel() {},
    },
    taskExists: () => false,
  });
  const result = await app.execute(
    {
      protocol_version: 1,
      operation: 'start',
      scope: 'home',
      model: 'gpt-4.1-mini',
      run_id: run.id,
      prompt: realDemoPrompts[0],
      confirmed: true,
    },
    'synthetic-owner',
  );
  expect(result).toMatchObject({ ok: false, code: 'CREDENTIAL_UNAVAILABLE' });
  expect(probe.network).not.toHaveBeenCalled();
  expect(existsSync(join(root, 'validation-started.json'))).toBe(false);
  expect(existsSync(join(root, 'resume-started.json'))).toBe(false);
  expect(existsSync(join(root, 'dispatch-1.json'))).toBe(false);
});
