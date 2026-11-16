import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import {
  dispatchBarrierViolations,
  type AgentRun,
  type DispatchBarrierObservation,
  type Theme,
} from '@caselite/contracts';
import {
  createAgentApplication,
  createAppearanceApplication,
  type AgentRuntimePort,
} from '@caselite/application';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';

const WINDOW = 'dispatch-barrier-window';
const NEXT_OUTPUT = '下一轮自己的回答';
const credentials = {
  get: () => 'synthetic-only',
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};
const message = (
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
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
const text = (value: string) => [{ type: 'text' as const, text: value }];
const toolCall = (name: string, args: Record<string, unknown>) => ({
  type: 'toolCall' as const,
  id: 'synthetic-call',
  name,
  arguments: args,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const snapshot = (run: AgentRun | undefined) =>
  run &&
  JSON.stringify({
    status: run.status,
    output: run.output,
    sequence: run.sequence,
    message: run.message,
    usage: run.usage,
    theme: run.theme_command?.state,
  });

// 使用既有 Agent Application 与真实 Pi Core 适配器；只把模型流替换为合成流（MOCK_ONLY provider），不新建 Runtime。
function setup(options: { resolveContext?: () => Promise<string> } = {}) {
  let theme: Theme = 'light';
  const write = vi.fn((next: Theme) => {
    theme = next;
  });
  const streams: ReturnType<typeof createAssistantMessageEventStream>[] = [];
  const pi = createPiRuntime(() => {
    const stream = createAssistantMessageEventStream();
    streams.push(stream);
    return stream;
  });
  const callbacks: Parameters<AgentRuntimePort['start']>[0][] = [];
  let proposals = 0;
  const runtime: AgentRuntimePort = {
    ...pi,
    start(input) {
      callbacks.push(input);
      const theme = input.theme;
      return pi.start(
        theme
          ? {
              ...input,
              theme: {
                ...theme,
                propose(value) {
                  proposals++;
                  theme.propose(value);
                },
              },
            }
          : input,
      );
    },
  };
  const registered: string[] = [];
  const app = createAgentApplication({
    credentials,
    runtime,
    appearance: createAppearanceApplication({ read: () => theme, write }),
    history: {
      load: () => [],
      register: (run) => {
        registered.push(run.id);
        return { created: true, run };
      },
      save() {},
    },
    taskExists: () => false,
    ...(options.resolveContext ? { resolveContext: options.resolveContext } : {}),
  });
  const read = async (id: string) => {
    const response = await app.execute(
      { protocol_version: 1, operation: 'read', scope: 'home' },
      WINDOW,
    );
    if (!response.ok) throw new Error(response.code);
    return response.runs.find((run) => run.id === id);
  };
  const start = (run_id: string, prompt: string, extra: Record<string, unknown> = {}) =>
    app.execute(
      {
        protocol_version: 1,
        operation: 'start',
        scope: 'home',
        run_id,
        model: 'gpt-4.1-mini',
        prompt,
        confirmed: true,
        ...extra,
      },
      WINDOW,
    );
  const cancel = (run_id: string) =>
    app.execute({ protocol_version: 1, operation: 'cancel', scope: 'home', run_id }, WINDOW);
  const startNext = async () => {
    const id = randomUUID();
    const before = streams.length;
    expect(await start(id, '下一轮普通问题')).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(streams).toHaveLength(before + 1));
    return {
      id,
      before,
      complete: () =>
        streams[before].push({ type: 'done', reason: 'stop', message: message(text(NEXT_OUTPUT)) }),
    };
  };
  const observeNext = async (next: Awaited<ReturnType<typeof startNext>>) => {
    await vi.waitFor(async () => expect((await read(next.id))?.status).not.toBe('running'));
    await settle();
    const run = await read(next.id);
    return {
      next_run_dispatches: streams.length - next.before,
      next_run_status: run?.status ?? 'not_registered',
      next_run_output_is_own: run?.output === NEXT_OUTPUT,
    } as const;
  };
  return {
    app,
    streams,
    callbacks,
    write,
    registered,
    proposals: () => proposals,
    read,
    start,
    cancel,
    startNext,
    observeNext,
  };
}

describe('DEV-1759 dispatch barrier negatives on the existing Agent Application + Pi Core (MOCK_ONLY provider)', () => {
  it('stop during input preparation dispatches nothing and leaves the next run clean', async () => {
    let release: ((value: string) => void) | undefined;
    const s = setup({
      resolveContext: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    });
    try {
      const id = randomUUID();
      const pending = s.start(id, '总结固定材料', { context_id: randomUUID() });
      await vi.waitFor(() => expect(release).toBeDefined());
      expect(await s.cancel(id)).toMatchObject({ ok: true, runs: [] });
      const stopped = snapshot(await s.read(id));
      release!('合成固定材料正文');
      expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
      await settle();
      const barrierDispatches = s.streams.length;
      expect(s.callbacks).toHaveLength(0);
      expect(s.registered).not.toContain(id);
      const barrierRun = await s.read(id);
      const next = await s.startNext();
      next.complete();
      const observation: DispatchBarrierObservation = {
        case: 'stop_before_dispatch',
        provider_dispatches: barrierDispatches,
        tool_effects: s.write.mock.calls.length,
        barrier_run: barrierRun?.status ?? 'not_registered',
        barrier_run_mutated_after_stop: snapshot(barrierRun) !== stopped,
        ...(await s.observeNext(next)),
      };
      expect(dispatchBarrierViolations(observation)).toEqual([]);
    } finally {
      s.app.release();
    }
  });

  it('stop while the approved set_theme call is still streaming never executes it or continues', async () => {
    const s = setup();
    try {
      const id = randomUUID();
      expect(await s.start(id, '把 CaseLite 调成深色')).toMatchObject({ ok: true });
      await vi.waitFor(() => expect(s.streams).toHaveLength(1));
      const call = toolCall('set_theme', { theme: 'dark' });
      const partial = message([{ ...call, arguments: {} }], 'toolUse');
      s.streams[0].push({ type: 'start', partial });
      s.streams[0].push({ type: 'toolcall_start', contentIndex: 0, partial });
      s.streams[0].push({ type: 'toolcall_delta', contentIndex: 0, delta: '{"theme":', partial });
      await settle();
      expect((await s.read(id))?.status).toBe('running');
      expect(await s.cancel(id)).toMatchObject({ ok: true });
      const stopped = snapshot(await s.read(id));
      const complete = message([call], 'toolUse');
      s.streams[0].push({
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: call,
        partial: complete,
      });
      s.streams[0].push({ type: 'done', reason: 'toolUse', message: complete });
      await settle();
      const barrierDispatches = s.streams.length;
      const barrierRun = await s.read(id);
      // Pi 层停止后不得把迟到的工具调用转交 Application；Application/外观授权的后备屏障另由写入计数覆盖。
      expect(s.proposals()).toBe(0);
      expect(barrierRun?.theme_command?.state).not.toBe('saved');
      const next = await s.startNext();
      next.complete();
      const observation: DispatchBarrierObservation = {
        case: 'stop_mid_tool',
        provider_dispatches: barrierDispatches,
        tool_effects: s.write.mock.calls.length,
        barrier_run: barrierRun?.status ?? 'not_registered',
        barrier_run_mutated_after_stop: snapshot(barrierRun) !== stopped,
        ...(await s.observeNext(next)),
      };
      expect(dispatchBarrierViolations(observation)).toEqual([]);
    } finally {
      s.app.release();
    }
  });

  it.each([
    ['bash', { command: 'cat private' }],
    ['sql_query', { sql: 'SELECT * FROM tasks' }],
    ['mcp__dynamic_connector', { server: 'unregistered', action: 'read_all' }],
  ])(
    'rejects unknown tool %s in an ordinary run without follow-up dispatch',
    async (name, args) => {
      const s = setup();
      try {
        const id = randomUUID();
        expect(await s.start(id, '整理今天的待办')).toMatchObject({ ok: true });
        await vi.waitFor(() => expect(s.streams).toHaveLength(1));
        s.streams[0].push({
          type: 'done',
          reason: 'toolUse',
          message: message([toolCall(name, args)], 'toolUse'),
        });
        await vi.waitFor(async () => expect((await s.read(id))?.status).not.toBe('running'));
        const stopped = snapshot(await s.read(id));
        await settle();
        const barrierDispatches = s.streams.length;
        const barrierRun = await s.read(id);
        const next = await s.startNext();
        next.complete();
        const observation: DispatchBarrierObservation = {
          case: 'unknown_tool',
          provider_dispatches: barrierDispatches,
          tool_effects: s.write.mock.calls.length,
          barrier_run: barrierRun?.status ?? 'not_registered',
          barrier_run_mutated_after_stop: snapshot(barrierRun) !== stopped,
          ...(await s.observeNext(next)),
        };
        expect(dispatchBarrierViolations(observation)).toEqual([]);
      } finally {
        s.app.release();
      }
    },
  );

  it.each([
    ['Pi Core stream events', false],
    ['adapter callbacks that ignore cancel', true],
  ])(
    'late %s from a stopped run cannot pollute the new run in the same window',
    async (_label, leakCallbacks) => {
      const s = setup();
      try {
        const id = randomUUID();
        expect(await s.start(id, '第一轮问题')).toMatchObject({ ok: true });
        await vi.waitFor(() => expect(s.streams).toHaveLength(1));
        const partial = message(text('第一轮部分'));
        s.streams[0].push({ type: 'start', partial });
        s.streams[0].push({ type: 'text_start', contentIndex: 0, partial });
        s.streams[0].push({ type: 'text_delta', contentIndex: 0, delta: '第一轮部分', partial });
        await vi.waitFor(async () => expect((await s.read(id))?.output).toBe('第一轮部分'));
        expect(await s.cancel(id)).toMatchObject({ ok: true });
        const stopped = snapshot(await s.read(id));
        const next = await s.startNext();
        if (leakCallbacks) {
          // 模拟忽略取消的适配器：直接调用已停止运行的回调，单独验证 Application 层屏障。
          s.callbacks[0].onText('迟到污染');
          s.callbacks[0].onEnd({
            status: 'succeeded',
            usage: { input: 9, output: 9 },
            message: '迟到完成',
          });
        } else {
          const late = message(text('第一轮部分迟到污染'));
          s.streams[0].push({
            type: 'text_delta',
            contentIndex: 0,
            delta: '迟到污染',
            partial: late,
          });
          s.streams[0].push({ type: 'done', reason: 'stop', message: late });
        }
        await settle();
        expect((await s.read(next.id))?.output).toBe('');
        next.complete();
        const nextObservation = await s.observeNext(next);
        const barrierRun = await s.read(id);
        const observation: DispatchBarrierObservation = {
          case: 'late_event_new_run',
          provider_dispatches: s.streams.length - nextObservation.next_run_dispatches,
          tool_effects: s.write.mock.calls.length,
          barrier_run: barrierRun?.status ?? 'not_registered',
          barrier_run_mutated_after_stop: snapshot(barrierRun) !== stopped,
          ...nextObservation,
        };
        expect(dispatchBarrierViolations(observation)).toEqual([]);
      } finally {
        s.app.release();
      }
    },
  );
});
