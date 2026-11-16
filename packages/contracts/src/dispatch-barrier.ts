import { z } from 'zod';
import { readToolPolicySchema } from './agent-input';

type ReadToolPolicy = z.infer<typeof readToolPolicySchema>;

// DEV-1759 PLH-04：1652/1654 派发屏障负向路径的可执行合同夹具；不建第二 Runtime，不接线 agent:v1。
const id = z.string().uuid();

export const readToolNameSchema = z.enum([
  'read_selected_document',
  'read_selected_source',
  'read_selected_task_message',
]);
export type ReadToolName = z.infer<typeof readToolNameSchema>;

export const dispatchBarrierEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text_delta'),
      run_id: id,
      sequence: z.number().int().nonnegative(),
      text: z.string().max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool_result'),
      run_id: id,
      sequence: z.number().int().nonnegative(),
      tool: readToolNameSchema,
      text: z.string().max(32_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('completion'),
      run_id: id,
      sequence: z.number().int().nonnegative(),
      status: z.enum(['succeeded', 'failed', 'cancelled']),
    })
    .strict(),
]);
export type DispatchBarrierEvent = z.infer<typeof dispatchBarrierEventSchema>;

export const dispatchBarrierPhaseSchema = z.enum([
  'idle',
  'arming',
  'armed',
  'dispatched',
  'tool_active',
  'terminal',
]);
export type DispatchBarrierPhase = z.infer<typeof dispatchBarrierPhaseSchema>;

export const dispatchBarrierStopReasonSchema = z.enum([
  'stop_before_dispatch',
  'stop_mid_tool',
  'unknown_tool',
  'completed',
  'host_rejected',
]);
export type DispatchBarrierStopReason = z.infer<typeof dispatchBarrierStopReasonSchema>;

export type DispatchBarrierLedger = {
  run_id: string;
  phase: DispatchBarrierPhase;
  dispatch_count: number;
  tool_calls: number;
  output: string;
  stop_reason: DispatchBarrierStopReason | null;
  dropped_late_events: number;
  last_sequence: number;
};

export type DispatchBarrierDecision =
  | { ok: true }
  | { ok: false; code: 'STOPPED' | 'UNKNOWN_TOOL' | 'NOT_ARMED' | 'WRONG_RUN' | 'LATE_EVENT' };

export function createDispatchBarrierSession(
  runId: string,
  policy: ReadToolPolicy,
): { policy: ReadToolPolicy; ledger: DispatchBarrierLedger } {
  readToolPolicySchema.parse(policy);
  return {
    policy,
    ledger: {
      run_id: runId,
      phase: 'idle',
      dispatch_count: 0,
      tool_calls: 0,
      output: '',
      stop_reason: null,
      dropped_late_events: 0,
      last_sequence: -1,
    },
  };
}

/** 派发前预处理；Stop 发生在本步之后、首次 dispatch 之前时 dispatch_count 必须保持 0。 */
export function armDispatchBarrier(session: {
  ledger: DispatchBarrierLedger;
}): DispatchBarrierDecision {
  if (session.ledger.phase === 'terminal') return { ok: false, code: 'STOPPED' };
  session.ledger.phase = session.ledger.phase === 'idle' ? 'arming' : session.ledger.phase;
  if (session.ledger.phase === 'arming') session.ledger.phase = 'armed';
  return { ok: true };
}

/** 最终取消屏障：派发前 Stop 后不得再发起模型或工具派发。 */
export function stopDispatchBarrier(
  session: { ledger: DispatchBarrierLedger },
  reason: 'stop_before_dispatch' | 'stop_mid_tool',
): DispatchBarrierDecision {
  if (session.ledger.phase === 'terminal') return { ok: false, code: 'STOPPED' };
  session.ledger.phase = 'terminal';
  session.ledger.stop_reason = reason;
  return { ok: true };
}

export function tryModelDispatch(session: {
  ledger: DispatchBarrierLedger;
}): DispatchBarrierDecision {
  const { ledger } = session;
  if (ledger.phase === 'terminal') return { ok: false, code: 'STOPPED' };
  if (ledger.phase !== 'armed') return { ok: false, code: 'NOT_ARMED' };
  ledger.phase = 'dispatched';
  ledger.dispatch_count += 1;
  return { ok: true };
}

/** 工具读取中 Stop 后不得再续跑；未知工具须在白名单外明确拒绝。 */
export function tryReadTool(
  session: { policy: ReadToolPolicy; ledger: DispatchBarrierLedger },
  tool: string,
): DispatchBarrierDecision {
  const { ledger, policy } = session;
  if (ledger.phase === 'terminal') return { ok: false, code: 'STOPPED' };
  if (ledger.phase !== 'dispatched' && ledger.phase !== 'tool_active')
    return { ok: false, code: 'NOT_ARMED' };
  const parsed = readToolNameSchema.safeParse(tool);
  if (!parsed.success || !policy.tools.includes(parsed.data))
    return { ok: false, code: 'UNKNOWN_TOOL' };
  ledger.phase = 'tool_active';
  ledger.tool_calls += 1;
  return { ok: true };
}

/** 取消终态后，迟到事件不得再写正文或污染后续 Run。 */
export function ingestDispatchBarrierEvent(
  session: { ledger: DispatchBarrierLedger },
  event: DispatchBarrierEvent,
): DispatchBarrierDecision {
  const parsed = dispatchBarrierEventSchema.safeParse(event);
  if (!parsed.success) return { ok: false, code: 'LATE_EVENT' };
  const body = parsed.data;
  const { ledger } = session;
  if (body.run_id !== ledger.run_id) return { ok: false, code: 'WRONG_RUN' };
  if (ledger.phase === 'terminal' || ledger.stop_reason !== null) {
    ledger.dropped_late_events += 1;
    return { ok: false, code: 'LATE_EVENT' };
  }
  if (body.sequence <= ledger.last_sequence) {
    ledger.dropped_late_events += 1;
    return { ok: false, code: 'LATE_EVENT' };
  }
  ledger.last_sequence = body.sequence;
  if (body.kind === 'text_delta') ledger.output += body.text;
  if (body.kind === 'tool_result') ledger.output += body.text;
  if (body.kind === 'completion') {
    ledger.phase = 'terminal';
    ledger.stop_reason = body.status === 'cancelled' ? 'stop_before_dispatch' : 'completed';
  }
  return { ok: true };
}

/** 新 Run 身份隔离：旧 Run 的迟到事件不能作用于新 ledger。 */
export function forkDispatchBarrierRun(
  session: { policy: ReadToolPolicy; ledger: DispatchBarrierLedger },
  nextRunId: string,
): { policy: ReadToolPolicy; ledger: DispatchBarrierLedger } {
  return createDispatchBarrierSession(nextRunId, session.policy);
}

export function dispatchBarrierAudit(ledger: DispatchBarrierLedger) {
  return {
    run_id: ledger.run_id,
    dispatch_count: ledger.dispatch_count,
    tool_calls: ledger.tool_calls,
    phase: ledger.phase,
    stop_reason: ledger.stop_reason,
    dropped_late_events: ledger.dropped_late_events,
    output_bytes: ledger.output.length,
  };
}
