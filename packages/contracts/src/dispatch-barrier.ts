import { z } from 'zod';

// DEV-1759 派发屏障夹具。复用 1654 的只读工具名，以及 1652 的单次派发与取消后丢弃迟到结果。
// 这不是第二 Runtime，也不进入 agent:v1；产品接线仍由原 Runtime Owner 验收。
// 不可破坏：派发前 Stop 使 dispatch 保持 0；工具读取中 Stop 后不得续跑或采纳工具结果；
// 白名单外工具不执行且不产生后续派发；终态后的迟到事件不得写入另一个 Run。失败时只记录拒绝，不改 Run。

export const dispatchReadTools = [
  'read_selected_document',
  'read_selected_source',
  'read_selected_task_message',
] as const;
export type DispatchReadTool = (typeof dispatchReadTools)[number];

const runId = z.string().uuid();
export const dispatchBarrierEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_run'), run_id: runId }).strict(),
  z.object({ type: z.literal('stop'), run_id: runId }).strict(),
  z.object({ type: z.literal('dispatch_model'), run_id: runId }).strict(),
  z
    .object({ type: z.literal('tool_call'), run_id: runId, name: z.string().min(1).max(64) })
    .strict(),
  z.object({ type: z.literal('continue_after_tool'), run_id: runId }).strict(),
  z.object({ type: z.literal('model_event'), run_id: runId, text: z.string().max(4000) }).strict(),
  z.object({ type: z.literal('tool_result'), run_id: runId, text: z.string().max(4000) }).strict(),
]);
export type DispatchBarrierEvent = z.infer<typeof dispatchBarrierEventSchema>;

export const dispatchBarrierDecisionCodes = [
  'empty',
  'invalid_event',
  'opened',
  'busy',
  'conflict',
  'unknown_run',
  'stopped_before_dispatch',
  'stopped_mid_tool',
  'cancelled_in_flight',
  'already_terminal',
  'dispatched',
  'dispatch_refused',
  'tool_before_dispatch',
  'tool_read_started',
  'unknown_tool',
  'continuation_refused',
  'output_updated',
  'tool_read_closed',
  'late_event',
] as const;
export type DispatchBarrierDecisionCode = (typeof dispatchBarrierDecisionCodes)[number];

export type DispatchBarrierRun = {
  run_id: string;
  phase: 'armed' | 'model' | 'tool_read' | 'terminal';
  status: 'armed' | 'running' | 'cancelled' | 'rejected' | 'closed';
  dispatch_count: number;
  follow_up_dispatches: number;
  tool_executed: boolean;
  output: string;
};

export type DispatchBarrierState = {
  active_run_id: string | null;
  runs: Readonly<Record<string, DispatchBarrierRun>>;
  last_decision: {
    accepted: boolean;
    code: DispatchBarrierDecisionCode;
    run_id: string | null;
  };
};

export function createDispatchBarrierState(): DispatchBarrierState {
  return {
    active_run_id: null,
    runs: {},
    last_decision: { accepted: true, code: 'empty', run_id: null },
  };
}

function isReadTool(name: string): name is DispatchReadTool {
  return (dispatchReadTools as readonly string[]).includes(name);
}

function decide(
  state: DispatchBarrierState,
  accepted: boolean,
  code: DispatchBarrierDecisionCode,
  run_id: string | null,
): DispatchBarrierState {
  return {
    active_run_id: state.active_run_id,
    runs: state.runs,
    last_decision: { accepted, code, run_id },
  };
}

function withRun(
  state: DispatchBarrierState,
  run: DispatchBarrierRun,
  code: DispatchBarrierDecisionCode,
  accepted = true,
): DispatchBarrierState {
  return {
    active_run_id: state.active_run_id,
    runs: { ...state.runs, [run.run_id]: run },
    last_decision: { accepted, code, run_id: run.run_id },
  };
}

export function applyDispatchBarrier(
  state: DispatchBarrierState,
  input: unknown,
): DispatchBarrierState {
  const parsed = dispatchBarrierEventSchema.safeParse(input);
  if (!parsed.success) return decide(state, false, 'invalid_event', null);
  const event = parsed.data;
  if (event.type === 'open_run') {
    if (state.runs[event.run_id]) return decide(state, false, 'conflict', event.run_id);
    const active = state.active_run_id ? state.runs[state.active_run_id] : undefined;
    if (active && active.phase !== 'terminal') return decide(state, false, 'busy', event.run_id);
    const run: DispatchBarrierRun = {
      run_id: event.run_id,
      phase: 'armed',
      status: 'armed',
      dispatch_count: 0,
      follow_up_dispatches: 0,
      tool_executed: false,
      output: '',
    };
    return {
      active_run_id: event.run_id,
      runs: { ...state.runs, [event.run_id]: run },
      last_decision: { accepted: true, code: 'opened', run_id: event.run_id },
    };
  }

  const current = state.runs[event.run_id];
  if (!current) return decide(state, false, 'unknown_run', event.run_id);

  if (event.type === 'stop') {
    if (current.phase === 'armed')
      return withRun(
        state,
        { ...current, phase: 'terminal', status: 'cancelled' },
        'stopped_before_dispatch',
      );
    if (current.phase === 'tool_read')
      return withRun(
        state,
        { ...current, phase: 'terminal', status: 'cancelled' },
        'stopped_mid_tool',
      );
    if (current.phase === 'model')
      return withRun(
        state,
        { ...current, phase: 'terminal', status: 'cancelled' },
        'cancelled_in_flight',
      );
    return decide(state, false, 'already_terminal', event.run_id);
  }

  if (event.type === 'dispatch_model') {
    if (current.phase !== 'armed' || current.dispatch_count !== 0)
      return decide(state, false, 'dispatch_refused', event.run_id);
    return withRun(
      state,
      { ...current, phase: 'model', status: 'running', dispatch_count: 1 },
      'dispatched',
    );
  }

  if (event.type === 'tool_call') {
    if (current.phase === 'terminal') return decide(state, false, 'late_event', event.run_id);
    if (current.phase !== 'model' || current.dispatch_count !== 1)
      return decide(state, false, 'tool_before_dispatch', event.run_id);
    if (!isReadTool(event.name))
      return withRun(
        state,
        { ...current, phase: 'terminal', status: 'rejected' },
        'unknown_tool',
        false,
      );
    return withRun(state, { ...current, phase: 'tool_read' }, 'tool_read_started');
  }

  if (event.type === 'continue_after_tool')
    return decide(state, false, 'continuation_refused', event.run_id);

  if (event.type === 'model_event') {
    if (current.phase === 'model' && current.status === 'running')
      return withRun(state, { ...current, output: event.text }, 'output_updated');
    return decide(state, false, 'late_event', event.run_id);
  }

  if (current.phase !== 'tool_read') return decide(state, false, 'late_event', event.run_id);
  return withRun(
    state,
    { ...current, phase: 'terminal', status: 'closed', tool_executed: true, output: event.text },
    'tool_read_closed',
  );
}
