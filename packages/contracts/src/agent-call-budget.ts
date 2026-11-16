import { z } from 'zod';

// DEV-1760设计合同：只补DEV-1586原预算政策未覆盖的计数、续跑与费用未知语义。
// 现有agent:v1与pi-runtime尚未消费这些DTO；本文件不新增Runtime，也不改变Run存储Owner。
const id = z.string().uuid();
const count = z.number().int().nonnegative();

export const CALL_BUDGET_MAX_OUTPUT_TOKENS = 2048;

export const callBudgetSchema = z
  .object({
    max_steps: z.number().int().min(1).max(16),
    max_calls: z.number().int().min(1).max(32),
    max_total_tokens: z.number().int().min(1).max(2_000_000),
    max_output_tokens_per_call: z.number().int().min(1).max(CALL_BUDGET_MAX_OUTPUT_TOKENS),
    max_compressions: z.number().int().min(0).max(4),
    // 与providerProfile.automatic_retries一致：本期不存在自动重试额度。
    max_retries: z.literal(0),
    deadline_ms: z.number().int().min(1).max(3_600_000),
    expansion_authorization_id: id.nullable(),
  })
  .strict()
  .superRefine((budget, context) => {
    const expanded = budget.max_steps > 1 || budget.max_calls > 1 || budget.max_compressions > 0;
    if (expanded && !budget.expansion_authorization_id)
      context.addIssue({ code: 'custom', message: 'Expanded budget requires authorization' });
    if (!expanded && budget.expansion_authorization_id)
      context.addIssue({ code: 'custom', message: 'Single-call default carries no expansion' });
    if (budget.max_calls < budget.max_steps)
      context.addIssue({ code: 'custom', message: 'Every step needs at least one call' });
    if (budget.max_calls < budget.max_steps + budget.max_compressions)
      context.addIssue({ code: 'custom', message: 'Compression shares the call limit' });
  });
export type CallBudget = z.infer<typeof callBudgetSchema>;

// 当前单次默认：一步、一次调用、不压缩、不重试；任何放宽都必须走授权字段。
export const DEFAULT_CALL_BUDGET: CallBudget = {
  max_steps: 1,
  max_calls: 1,
  max_total_tokens: 32_000,
  max_output_tokens_per_call: CALL_BUDGET_MAX_OUTPUT_TOKENS,
  max_compressions: 0,
  max_retries: 0,
  deadline_ms: 120_000,
  expansion_authorization_id: null,
};

export const callKindSchema = z.enum(['initial', 'tool_continue', 'compress', 'retry', 'replay']);
export type CallKind = z.infer<typeof callKindSchema>;

export const callOutcomeKindSchema = z.enum([
  'completed',
  'auth_rejected_401',
  'rate_limited_429',
  'result_unknown',
  'cancelled',
  'local_refused',
]);
export type CallOutcomeKind = z.infer<typeof callOutcomeKindSchema>;

export const remoteCostSchema = z.enum(['settled', 'unknown', 'none_dispatched']);
export type RemoteCost = z.infer<typeof remoteCostSchema>;

const callRecordSchema = z
  .object({
    call_index: count,
    kind: callKindSchema,
    reserved_input_tokens: count,
    reserved_output_tokens: count,
    outcome: callOutcomeKindSchema.nullable(),
    actual_input_tokens: count.nullable(),
    actual_output_tokens: count.nullable(),
    remote_cost: remoteCostSchema.nullable(),
  })
  .strict();
export type CallRecord = z.infer<typeof callRecordSchema>;

export const callLedgerSchema = z
  .object({
    run_id: id,
    started_at_ms: count,
    steps_started: count,
    compressions: count,
    calls: z.array(callRecordSchema).max(32),
  })
  .strict()
  .superRefine((ledger, context) => {
    ledger.calls.forEach((call, index) => {
      if (call.call_index !== index)
        context.addIssue({ code: 'custom', message: 'Call index must be contiguous' });
      if (call.outcome === null) {
        if (call.remote_cost !== null)
          context.addIssue({ code: 'custom', message: 'Unsettled call has no cost state' });
        return;
      }
      const expected = remoteCostFor(
        call.outcome,
        call.actual_input_tokens,
        call.actual_output_tokens,
      );
      if (call.remote_cost !== expected)
        context.addIssue({ code: 'custom', message: 'Remote cost must follow the outcome' });
    });
  });
export type CallLedger = z.infer<typeof callLedgerSchema>;

// 费用只由结果推导，调用方不能自报：取消、401、429、结果未知一律“远端费用未知”，
// 只有本地拒绝（未发出）才可记无远端费用，只有完成且实际用量可核对才可记已结算。
export function remoteCostFor(
  outcome: CallOutcomeKind,
  actualInput: number | null,
  actualOutput: number | null,
): RemoteCost {
  if (outcome === 'local_refused') return 'none_dispatched';
  if (outcome === 'completed' && actualInput !== null && actualOutput !== null) return 'settled';
  return 'unknown';
}

export function startCallLedger(runId: string, nowMs: number): CallLedger {
  return { run_id: runId, started_at_ms: nowMs, steps_started: 0, compressions: 0, calls: [] };
}

export type CallRefusal =
  | 'UNSETTLED_CALL'
  | 'PRIOR_FAILURE_NO_REPLAY'
  | 'RETRY_FORBIDDEN'
  | 'REPLAY_FORBIDDEN'
  | 'INITIAL_ALREADY_USED'
  | 'NO_INITIAL_CALL'
  | 'MAX_STEPS'
  | 'MAX_CALLS'
  | 'COMPRESSION_LIMIT'
  | 'OUTPUT_TOKEN_LIMIT'
  | 'TOKEN_BUDGET'
  | 'DEADLINE';

export type CallRequest = {
  kind: CallKind;
  input_tokens: number;
  output_tokens: number;
  now_ms: number;
};

export type ReserveResult =
  { ok: true; ledger: CallLedger; call_index: number } | { ok: false; reason: CallRefusal };

// 已预留或已结算的token：实际用量可核对时取实际值，否则按预留上界计，
// 因此取消/未知结果不会把额度“退回”给后续调用。
export function committedTokens(ledger: CallLedger): number {
  return ledger.calls.reduce(
    (sum, call) =>
      sum +
      (call.actual_input_tokens !== null && call.actual_output_tokens !== null
        ? call.actual_input_tokens + call.actual_output_tokens
        : call.reserved_input_tokens + call.reserved_output_tokens),
    0,
  );
}

const failedOutcomes: CallOutcomeKind[] = [
  'auth_rejected_401',
  'rate_limited_429',
  'result_unknown',
  'cancelled',
];

// 最后发送边界：工具续跑、压缩与重放都先过同一份预算，且同一时刻只允许一个未结算调用。
export function reserveCall(
  budget: CallBudget,
  ledger: CallLedger,
  request: CallRequest,
): ReserveResult {
  const refuse = (reason: CallRefusal): ReserveResult => ({ ok: false, reason });
  const last = ledger.calls.at(-1);
  if (last && last.outcome === null) return refuse('UNSETTLED_CALL');
  if (ledger.calls.some((call) => call.outcome && failedOutcomes.includes(call.outcome)))
    return refuse('PRIOR_FAILURE_NO_REPLAY');
  if (request.kind === 'retry') return refuse('RETRY_FORBIDDEN');
  if (request.kind === 'replay') return refuse('REPLAY_FORBIDDEN');
  if (request.now_ms >= ledger.started_at_ms + budget.deadline_ms) return refuse('DEADLINE');
  if (request.kind === 'initial' && ledger.steps_started > 0) return refuse('INITIAL_ALREADY_USED');
  if (request.kind !== 'initial' && ledger.steps_started === 0) return refuse('NO_INITIAL_CALL');
  if (ledger.calls.length >= budget.max_calls) return refuse('MAX_CALLS');
  if (request.kind === 'tool_continue' && ledger.steps_started >= budget.max_steps)
    return refuse('MAX_STEPS');
  if (request.kind === 'compress' && ledger.compressions >= budget.max_compressions)
    return refuse('COMPRESSION_LIMIT');
  if (request.output_tokens > budget.max_output_tokens_per_call)
    return refuse('OUTPUT_TOKEN_LIMIT');
  if (
    committedTokens(ledger) + request.input_tokens + request.output_tokens >
    budget.max_total_tokens
  )
    return refuse('TOKEN_BUDGET');
  const opensStep = request.kind === 'initial' || request.kind === 'tool_continue';
  const next: CallLedger = {
    ...ledger,
    steps_started: ledger.steps_started + (opensStep ? 1 : 0),
    compressions: ledger.compressions + (request.kind === 'compress' ? 1 : 0),
    calls: [
      ...ledger.calls,
      {
        call_index: ledger.calls.length,
        kind: request.kind,
        reserved_input_tokens: request.input_tokens,
        reserved_output_tokens: request.output_tokens,
        outcome: null,
        actual_input_tokens: null,
        actual_output_tokens: null,
        remote_cost: null,
      },
    ],
  };
  return { ok: true, ledger: next, call_index: ledger.calls.length };
}

export type SettleInput = {
  outcome: CallOutcomeKind;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
};

// 结算只更新调用记录；失败类结果不退还预留额度，也不允许记为零费用。
export function settleCall(ledger: CallLedger, callIndex: number, input: SettleInput): CallLedger {
  const call = ledger.calls[callIndex];
  if (!call || call.outcome !== null) throw new Error('Call is not awaiting settlement');
  const actualKnown = input.outcome === 'completed';
  const actualInput = actualKnown ? input.actual_input_tokens : null;
  const actualOutput = actualKnown ? input.actual_output_tokens : null;
  const settled: CallRecord = {
    ...call,
    outcome: input.outcome,
    actual_input_tokens: actualInput,
    actual_output_tokens: actualOutput,
    remote_cost: remoteCostFor(input.outcome, actualInput, actualOutput),
  };
  return {
    ...ledger,
    calls: ledger.calls.map((item, index) => (index === callIndex ? settled : item)),
  };
}

// 面向用户的费用说明不得出现“零费用/未产生费用”，除非该调用从未发出。
export function describeRemoteCost(cost: RemoteCost): string {
  if (cost === 'none_dispatched') return '未发出请求，无远端费用。';
  if (cost === 'settled') return '远端用量已核对。';
  return '远端费用未知，可能已产生，请以服务商账单为准。';
}
