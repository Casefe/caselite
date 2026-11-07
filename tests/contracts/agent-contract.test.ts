import { describe, expect, it, vi } from 'vitest';
import {
  createAgentApplication,
  type AgentRuntimePort,
} from '../../packages/application/src/agent-application';
import { agentRequestSchema, agentResponseSchema } from '../../packages/contracts/src/agent';

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
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
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
      credentials: {
        getDefaultModel: () => 'gpt-4.1-mini',
        setDefaultModel() {},
        get: () => 'synthetic-only',
        set: () => saving,
        clear() {},
      },
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
      credentials: {
        getDefaultModel: () => 'gpt-4.1-mini',
        setDefaultModel() {},
        get: () => 'synthetic-only',
        set: () => saving,
        clear() {},
      },
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
        getDefaultModel: () => 'gpt-4.1-mini',
        setDefaultModel() {},
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
        getDefaultModel: () => 'gpt-4.1-mini',
        setDefaultModel() {},
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

describe('Explicit multi-provider selection', () => {
  function setupProviders() {
    const keys = new Map<string, string>([
      ['openai', 'openai-synthetic'],
      ['deepseek', 'deepseek-synthetic'],
    ]);
    let selected: 'gpt-4.1-mini' | 'deepseek-flash' | 'deepseek-v4-pro' = 'gpt-4.1-mini';
    let finish: Parameters<AgentRuntimePort['start']>[0]['onEnd'];
    const runtime = {
      start: vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
        finish = input.onEnd;
        return { cancel() {} };
      }),
    };
    const app = createAgentApplication({
      credentials: {
        get: (provider = 'openai') => keys.get(provider),
        set: (key, provider = 'openai') => {
          keys.set(provider, key);
        },
        clear: (provider = 'openai') => {
          keys.delete(provider);
        },
        getDefaultModel: () => selected,
        setDefaultModel: (model) => {
          selected = model;
        },
      },
      runtime,
      taskExists: () => false,
    });
    return {
      app,
      keys,
      runtime,
      finish: () => finish({ status: 'succeeded', message: 'done', usage: null }),
    };
  }
  it('isolates keys, persists the selected target through the port, and refuses stale previews and changed replay', async () => {
    const { app, runtime, finish } = setupProviders();
    await app.execute(
      { protocol_version: 1, operation: 'select_model', model: 'deepseek-flash' },
      'w',
    );
    expect(await app.execute(start, 'w')).toMatchObject({ code: 'MODEL_CHANGED' });
    expect(runtime.start).not.toHaveBeenCalled();
    const ds = { ...start, model: 'deepseek-flash' };
    expect(await app.execute(ds, 'w')).toMatchObject({
      ok: true,
      runs: [{ provider: 'deepseek', model: 'deepseek-flash' }],
    });
    expect(runtime.start.mock.calls[0][0]).toMatchObject({
      key: 'deepseek-synthetic',
      model: 'deepseek-flash',
    });
    expect(await app.execute({ ...ds, model: 'deepseek-v4-pro' }, 'w')).toMatchObject({
      code: 'CONFLICT',
    });
    expect(
      await app.execute(
        { protocol_version: 1, operation: 'select_model', model: 'gpt-4.1-mini' },
        'w',
      ),
    ).toMatchObject({ code: 'BUSY' });
    finish();
    await app.execute(
      { protocol_version: 1, operation: 'select_model', model: 'gpt-4.1-mini' },
      'w',
    );
    await app.execute(ds, 'w');
    expect(runtime.start).toHaveBeenCalledTimes(1);
    await app.execute({ ...start, run_id: '22222222-2222-4222-8222-222222222222' }, 'w');
    expect(runtime.start.mock.calls[1][0]).toMatchObject({
      key: 'openai-synthetic',
      model: 'gpt-4.1-mini',
    });
  });
  it('deleting one key never clears another or falls back to another service', async () => {
    const { app, keys, runtime } = setupProviders();
    await app.execute(
      { protocol_version: 1, operation: 'select_model', model: 'deepseek-v4-pro' },
      'w',
    );
    const result = await app.execute(
      { protocol_version: 1, operation: 'clear_key', provider: 'deepseek' },
      'w',
    );
    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-pro',
      configured: false,
      providers: { openai: true, deepseek: false },
    });
    expect(keys.get('openai')).toBe('openai-synthetic');
    expect(await app.execute({ ...start, model: 'deepseek-v4-pro' }, 'w')).toMatchObject({
      code: 'NO_KEY',
    });
    expect(
      await app.execute(
        { protocol_version: 1, operation: 'select_model', model: 'deepseek-flash' },
        'w',
      ),
    ).toMatchObject({ code: 'NO_KEY' });
    expect(runtime.start).not.toHaveBeenCalled();
  });
  it('rejects arbitrary providers, endpoints, models and mismatched identity at the contract boundary', () => {
    for (const request of [
      { ...start, model: 'unknown-model' },
      { ...start, model: 'deepseek-flash', provider: 'openai' },
      { ...start, baseUrl: 'https://another.example' },
      { protocol_version: 1, operation: 'configure', provider: 'another', key: 'sk-synthetic-key' },
    ])
      expect(agentRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe('credential failure projection', () => {
  it('retains readable history, isolates the unavailable Provider, and rejects dispatch without reflecting the error', async () => {
    const runtime = { start: vi.fn(() => ({ cancel() {} })) };
    const app = createAgentApplication({
      credentials: {
        get(provider = 'openai') {
          if (provider === 'openai') throw new Error('private synthetic-system-error');
          return 'synthetic-deepseek';
        },
        set() {},
        clear() {},
        getDefaultModel: () => 'gpt-4.1-mini',
        setDefaultModel() {},
      },
      runtime,
      taskExists: () => true,
      history: {
        load: () => [],
        register: (run) => ({ created: true, run }),
        save() {},
        pinnedIds: () => [],
        setPinned: () => 'OK',
      },
    });
    for (const operation of ['profile', 'read', 'history'] as const) {
      const result = await app.execute(
        { protocol_version: 1, operation, ...(operation === 'read' ? { scope: 'home' } : {}) },
        'window',
      );
      expect(result).toMatchObject({
        ok: true,
        configured: false,
        providers: { openai: false, deepseek: true },
        credential_errors: { openai: 'UNAVAILABLE' },
        runs: [],
      });
      expect(JSON.stringify(result)).not.toContain('private');
    }
    expect(await app.execute(start, 'window')).toMatchObject({
      ok: false,
      code: 'CREDENTIAL_UNAVAILABLE',
    });
    expect(runtime.start).not.toHaveBeenCalled();
  });
});

it('validates only bounded credential error enums and accepts older responses without the optional field', () => {
  const old = {
    ok: true,
    configured: false,
    model: 'gpt-4.1-mini',
    providers: { openai: false, deepseek: false },
    runs: [],
  };
  expect(agentResponseSchema.safeParse(old).success).toBe(true);
  expect(
    agentResponseSchema.safeParse({ ...old, credential_errors: { openai: 'UNAVAILABLE' } }).success,
  ).toBe(true);
  expect(
    agentResponseSchema.safeParse({ ...old, credential_errors: { openai: 'private system error' } })
      .success,
  ).toBe(false);
  expect(
    agentResponseSchema.safeParse({
      ...old,
      credential_errors: { arbitraryProvider: 'UNAVAILABLE' },
    }).success,
  ).toBe(false);
});

describe('explicit credential refresh', () => {
  it('validates a strict no-secret command and never refreshes during polling', async () => {
    const refresh = vi.fn(async () => {});
    const app = createAgentApplication({
      credentials: {
        get: () => undefined,
        getDefaultModel: () => 'gpt-4.1-mini',
        set() {},
        clear() {},
        setDefaultModel() {},
        refresh,
      },
      runtime: { start: vi.fn() },
      taskExists: () => true,
    });
    for (const operation of ['profile', 'read', 'profile'] as const)
      await app.execute(
        { protocol_version: 1, operation, ...(operation === 'read' ? { scope: 'home' } : {}) },
        'window',
      );
    expect(refresh).not.toHaveBeenCalled();
    expect(
      agentRequestSchema.safeParse({ protocol_version: 1, operation: 'refresh_credentials' })
        .success,
    ).toBe(true);
    for (const extra of [
      { key: 'sk-synthetic-key' },
      { provider: 'deepseek' },
      { root: '/arbitrary' },
    ])
      expect(
        agentRequestSchema.safeParse({
          protocol_version: 1,
          operation: 'refresh_credentials',
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      await app.execute({ protocol_version: 1, operation: 'refresh_credentials' }, 'window'),
    ).toMatchObject({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('serializes refresh against save, clear, model selection, start and another refresh without blocking state reads', async () => {
    let complete!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const set = vi.fn(),
      clear = vi.fn(),
      setDefaultModel = vi.fn(),
      runtime = { start: vi.fn(() => ({ cancel() {} })) };
    const app = createAgentApplication({
      credentials: {
        get: () => 'synthetic-key',
        getDefaultModel: () => 'gpt-4.1-mini',
        refresh,
        set,
        clear,
        setDefaultModel,
      },
      runtime,
      taskExists: () => true,
    });
    const command = { protocol_version: 1, operation: 'refresh_credentials' };
    const pending = app.execute(command, 'window');
    for (const request of [
      command,
      { protocol_version: 1, operation: 'configure', key: 'sk-synthetic-key' },
      { protocol_version: 1, operation: 'clear_key' },
      { protocol_version: 1, operation: 'select_model', model: 'deepseek-flash' },
      start,
    ])
      expect(await app.execute(request, 'other-window')).toMatchObject({ ok: false, code: 'BUSY' });
    expect(
      await app.execute({ protocol_version: 1, operation: 'profile' }, 'window'),
    ).toMatchObject({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(setDefaultModel).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
    complete();
    await pending;
  });
  it('rejects refresh while running, preparing or encrypting and never reflects system errors', async () => {
    let finish!: Parameters<AgentRuntimePort['start']>[0]['onEnd'];
    const refresh = vi.fn(async () => {
      throw new Error('private system error');
    });
    let resolvePreparation!: (text: string) => void;
    let resolveSave!: () => void;
    const app = createAgentApplication({
      credentials: {
        get: () => 'synthetic-key',
        getDefaultModel: () => 'gpt-4.1-mini',
        refresh,
        clear() {},
        setDefaultModel() {},
        set: () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      },
      runtime: {
        start: (input) => {
          finish = input.onEnd;
          return { cancel() {} };
        },
      },
      taskExists: () => true,
      resolveContext: () =>
        new Promise<string>((resolve) => {
          resolvePreparation = resolve;
        }),
    });
    const command = { protocol_version: 1, operation: 'refresh_credentials' };
    const preparing = app.execute(
      { ...start, context_id: '34343434-3434-4434-8434-343434343434' },
      'window',
    );
    expect(await app.execute(command, 'window')).toMatchObject({ code: 'BUSY' });
    resolvePreparation('合成文字');
    await preparing;
    expect(await app.execute(command, 'window')).toMatchObject({ code: 'BUSY' });
    finish({ status: 'succeeded', usage: null, message: '完成' });
    const saving = app.execute(
      { protocol_version: 1, operation: 'configure', key: 'sk-synthetic-key' },
      'window',
    );
    expect(await app.execute(command, 'window')).toMatchObject({ code: 'BUSY' });
    expect(refresh).not.toHaveBeenCalled();
    resolveSave();
    await saving;
    const failed = await app.execute(command, 'window');
    expect(failed).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(JSON.stringify(failed)).not.toContain('private');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
