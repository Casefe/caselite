import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { agentRunSchema, type Theme, type AgentRun } from '@caselite/contracts';
import { createAgentApplication, createAppearanceApplication } from '@caselite/application';
import { openTaskStore } from '../../packages/local-db/src/index';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';
import { createAppearancePreferences } from '../../apps/desktop/src/main/adapters/appearance-preferences';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const credentials = {
  get: () => 'synthetic-theme-only',
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};
const message = (
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'toolUse',
): AssistantMessage => ({
  role: 'assistant',
  content,
  stopReason,
  api: 'openai-responses',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  timestamp: 1,
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
const tool = (name = 'set_theme', args: unknown = { theme: 'dark' }) => ({
  type: 'toolCall' as const,
  id: 'synthetic-call',
  name,
  arguments: args as Record<string, unknown>,
});
const start = (run_id: string, prompt = '把 CaseLite 调成深色') => ({
  protocol_version: 1,
  operation: 'start',
  scope: 'home',
  run_id,
  model: 'gpt-4.1-mini',
  prompt,
  confirmed: true,
});

it('executes an actual Pi proposal once through the original file Owner and persists undo in SQLite across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-theme-integration-'));
  roots.push(root);
  const file = join(root, 'data.sqlite'),
    store = openTaskStore(file, resolve('packages/local-db/migrations'));
  const preferences = createAppearancePreferences(root);
  preferences.write('light');
  const write = vi.fn((theme: Theme) => preferences.write(theme));
  const appearance = createAppearanceApplication({ read: preferences.read, write });
  let dispatches = 0;
  const runtime = createPiRuntime((_model, context, options) => {
    dispatches++;
    expect(JSON.stringify(context)).toContain('set_theme');
    expect(JSON.stringify(context)).not.toContain('database_file');
    expect(options).toMatchObject({ maxRetries: 0, env: {}, apiKey: 'synthetic-theme-only' });
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() =>
      stream.push({ type: 'done', reason: 'toolUse', message: message([tool()]) }),
    );
    return stream;
  });
  const app = createAgentApplication({
    credentials,
    appearance,
    runtime,
    history: store.agentHistory,
    taskExists: () => false,
  });
  const id = crypto.randomUUID(),
    oldId = crypto.randomUUID();
  try {
    store.agentHistory.register({
      id: oldId,
      scope: 'home',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      prompt: '旧版合成输入',
      output: '旧回答',
      status: 'succeeded',
      message: '',
      sequence: 1,
      usage: null,
    });
    expect((await app.execute(start(id), 'window-A')).ok).toBe(true);
    await vi.waitFor(() =>
      expect(store.agentHistory.load().find((run) => run.id === id)?.theme_command?.state).toBe(
        'saved',
      ),
    );
    expect(preferences.read()).toBe('dark');
    expect(
      await app.execute(
        { protocol_version: 1, operation: 'undo_theme', scope: 'home', run_id: id },
        'window-A',
      ),
    ).toMatchObject({ ok: true });
    expect(store.agentHistory.load().find((run) => run.id === id)).toMatchObject({
      output: '已撤销本次主题修改。',
      theme_command: { state: 'undone' },
    });
    await app.execute(start(id), 'window-A');
    expect(dispatches).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(join(root, 'appearance-preferences.json'), 'utf8'))).toEqual({
      version: 1,
      theme: 'light',
    });
  } finally {
    app.release();
    store.close();
  }
  const reopened = openTaskStore(file, resolve('packages/local-db/migrations'));
  const neverStart = vi.fn(() => {
    throw Error('Restart must not dispatch');
  });
  try {
    const restored = createAgentApplication({
      credentials,
      appearance: createAppearanceApplication(createAppearancePreferences(root)),
      runtime: { start: neverStart },
      history: reopened.agentHistory,
      taskExists: () => false,
    });
    const old = reopened.agentHistory.load().find((run) => run.id === oldId)!;
    expect(old).toMatchObject({ prompt: '旧版合成输入', output: '旧回答' });
    expect(old.theme_command).toBeUndefined();
    const saved = reopened.agentHistory.load().find((run) => run.id === id)!;
    expect(saved.theme_command?.state).toBe('undone');
    const legacy = agentRunSchema.omit({ theme_command: true }).parse(saved);
    expect(legacy.output).toContain('已撤销');
    expect(legacy.prompt).toBe('把 CaseLite 调成深色');
    expect(
      await restored.execute(
        { protocol_version: 1, operation: 'undo_theme', scope: 'home', run_id: id },
        'window-A',
      ),
    ).toMatchObject({ ok: false, code: 'THEME_EXPIRED' });
    expect(createAppearancePreferences(root).read()).toBe('light');
    expect(neverStart).not.toHaveBeenCalled();
    const corrupt = '{"version":999,"theme":"dark"}';
    writeFileSync(join(root, 'appearance-preferences.json'), corrupt);
    expect(
      createAppearanceApplication(createAppearancePreferences(root)).prepare('window-A', 'light'),
    ).toBeUndefined();
    expect(readFileSync(join(root, 'appearance-preferences.json'), 'utf8')).toBe(corrupt);
  } finally {
    reopened.close();
  }
});

it.each([
  ['unknown tool', message([tool('bash')])],
  ['multiple calls', message([tool(), { ...tool(), id: 'second' }])],
  ['truncated arguments', message([tool()], 'length')],
  ['wrong target', message([tool('set_theme', { theme: 'light' })])],
  ['extra arguments', message([tool('set_theme', { theme: 'dark', key: 'not-allowed' })])],
  ['text-only false success', message([{ type: 'text', text: '主题已修改成功' }], 'stop')],
] as const)('rejects %s without writes or follow-up dispatch', async (_label, response) => {
  let value: Theme = 'light',
    latest: AgentRun | undefined;
  const write = vi.fn((next: Theme) => {
    value = next;
  });
  let dispatches = 0;
  const runtime = createPiRuntime(() => {
    dispatches++;
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() =>
      stream.push({
        type: 'done',
        reason:
          response.stopReason === 'length'
            ? 'length'
            : response.stopReason === 'stop'
              ? 'stop'
              : 'toolUse',
        message: response,
      }),
    );
    return stream;
  });
  const app = createAgentApplication({
    credentials,
    runtime,
    appearance: createAppearanceApplication({ read: () => value, write }),
    history: {
      load: () => [],
      register: (run) => ({ created: true, run }),
      save: (run) => {
        latest = run;
      },
    },
    taskExists: () => false,
  });
  try {
    await app.execute(start(crypto.randomUUID()), 'A');
    await vi.waitFor(() => expect(latest?.status).toBe('failed'));
    expect(write).not.toHaveBeenCalled();
    expect(dispatches).toBe(1);
    expect(latest?.output).not.toBe('主题已修改成功');
  } finally {
    app.release();
  }
});

it('keeps ordinary consultation runs tool-free even if a synthetic model emits a theme call', async () => {
  const write = vi.fn(),
    saved: AgentRun[] = [];
  const runtime = createPiRuntime((_model, context) => {
    expect(
      context.messages
        .filter((value) => value.role === 'system')
        .every((value) => !value.toolsAdded?.length),
    ).toBe(true);
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() =>
      stream.push({ type: 'done', reason: 'toolUse', message: message([tool()]) }),
    );
    return stream;
  });
  const app = createAgentApplication({
    credentials,
    runtime,
    appearance: createAppearanceApplication({ read: () => 'light', write }),
    history: {
      load: () => [],
      register: (run) => ({ created: true, run }),
      save: (run) => saved.push(structuredClone(run)),
    },
    taskExists: () => false,
  });
  try {
    await app.execute(start(crypto.randomUUID(), '如何改成深色'), 'A');
    await vi.waitFor(() => expect(saved.at(-1)?.status).toBe('failed'));
    expect(write).not.toHaveBeenCalled();
  } finally {
    app.release();
  }
});

it('repairs a failed terminal SQLite checkpoint in the same process without repeating the file write or runtime', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-theme-repair-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'data.sqlite'), resolve('packages/local-db/migrations'));
  const preferences = createAppearancePreferences(root);
  preferences.write('light');
  const write = vi.fn(preferences.write);
  let fail = true;
  let input!: Parameters<import('@caselite/application').AgentRuntimePort['start']>[0];
  const runtime = {
    start: vi.fn((value: typeof input) => {
      input = value;
      return { cancel() {} };
    }),
  };
  const app = createAgentApplication({
    credentials,
    runtime,
    taskExists: () => false,
    appearance: createAppearanceApplication({ read: preferences.read, write }),
    history: {
      ...store.agentHistory,
      save(run) {
        if (fail) throw Error('Injected terminal checkpoint failure');
        store.agentHistory.save(run);
      },
    },
  });
  const id = crypto.randomUUID();
  const query = () =>
    app.execute({ protocol_version: 1, operation: 'theme_status', scope: 'home', run_id: id }, 'A');
  try {
    await app.execute(start(id), 'A');
    input.theme!.propose({ theme: 'dark' });
    input.onEnd({ status: 'succeeded', usage: null, message: '' });
    expect(preferences.read()).toBe('dark');
    expect(store.agentHistory.load()[0].theme_command?.state).toBe('pending');
    expect(await query()).toMatchObject({
      ok: true,
      runs: [
        { message: expect.stringContaining('运行记录尚未保存'), theme_command: { state: 'saved' } },
      ],
    });
    fail = false;
    expect(await query()).toMatchObject({
      ok: true,
      runs: [{ message: '主题已保存，等待界面应用核对。', theme_command: { state: 'saved' } }],
    });
    expect(store.agentHistory.load()[0].theme_command?.state).toBe('saved');
    await query();
    expect(write).toHaveBeenCalledTimes(1);
    expect(runtime.start).toHaveBeenCalledTimes(1);
  } finally {
    app.release();
    store.close();
  }
});

it('preserves a pending operation identity when file commit precedes a failed Run checkpoint, then recovers as unknown without replay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-theme-unknown-'));
  roots.push(root);
  const file = join(root, 'data.sqlite'),
    store = openTaskStore(file, resolve('packages/local-db/migrations'));
  const preferences = createAppearancePreferences(root);
  preferences.write('light');
  let input!: Parameters<import('@caselite/application').AgentRuntimePort['start']>[0];
  const app = createAgentApplication({
    credentials,
    appearance: createAppearanceApplication(preferences),
    taskExists: () => false,
    runtime: {
      start(value) {
        input = value;
        return { cancel() {} };
      },
    },
    history: {
      ...store.agentHistory,
      save() {
        throw Error('Injected failure after file commit');
      },
    },
  });
  const id = crypto.randomUUID();
  try {
    await app.execute(start(id), 'A');
    const pending = store.agentHistory.load()[0].theme_command!;
    expect(pending).toMatchObject({ state: 'pending', before: 'light', after: 'dark' });
    input.theme!.propose({ theme: 'dark' });
    input.onEnd({ status: 'succeeded', usage: null, message: '' });
    expect(preferences.read()).toBe('dark');
    expect(store.agentHistory.load()[0].theme_command).toEqual(pending);
  } finally {
    app.release();
    store.close();
  }
  const reopened = openTaskStore(file, resolve('packages/local-db/migrations'));
  try {
    reopened.agentHistory.recoverInterrupted();
    const neverStart = vi.fn(() => {
      throw Error('Refuse recovered effect replay');
    });
    const restored = createAgentApplication({
      credentials,
      appearance: createAppearanceApplication(preferences),
      runtime: { start: neverStart },
      history: reopened.agentHistory,
      taskExists: () => false,
    });
    const history = await restored.execute(
      { protocol_version: 1, operation: 'read', scope: 'home' },
      'A',
    );
    expect(history).toMatchObject({
      ok: true,
      runs: [
        {
          status: 'interrupted',
          theme_command: { state: 'unknown', can_undo: false, before: 'light', after: 'dark' },
        },
      ],
    });
    expect(reopened.agentHistory.load()[0].theme_command?.state).toBe('pending');
    await restored.execute(start(id), 'A');
    expect(neverStart).not.toHaveBeenCalled();
    expect(
      await restored.execute(
        { protocol_version: 1, operation: 'undo_theme', scope: 'home', run_id: id },
        'A',
      ),
    ).toMatchObject({ ok: false });
    expect(preferences.read()).toBe('dark');
  } finally {
    reopened.close();
  }
});
