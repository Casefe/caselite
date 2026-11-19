import { z } from 'zod';

// DEV-1760差异合同：在DEV-1586单次调用默认之上定义多步上限与费用未知语义；现有agent:v1尚未消费，不是第二Runtime。
export const AGENT_CALL_BUDGET_POLICY = 'call-budget-v1' as const;

const count = z.number().int().nonnegative();
const positive = z.number().int().positive();

export const agentCallBudgetSchema = z
  .strictObject({
    policy: z.literal(AGENT_CALL_BUDGET_POLICY),
    max_steps: positive,
    max_calls: positive,
    max_input_tokens: positive,
    max_output_tokens: positive,
    // null仅允许单次调用：沿用宿主现有请求超时，预算本身不另加期限。
    deadline_ms: positive.nullable(),
    max_compressions: count,
    max_retries: count,
  })
  .refine((b) => b.max_calls >= b.max_steps, {
    path: ['max_calls'],
    message: 'Each step needs at least one call',
  })
  .refine((b) => b.deadline_ms !== null || b.max_calls === 1, {
    path: ['deadline_ms'],
    message: 'Multi-call budgets require a deadline',
  });
export type AgentCallBudget = z.infer<typeof agentCallBudgetSchema>;

// 与application的utf8-byte-proxy-v1输入上限（256 KiB可见字节+8192协议预留）及2048输出预留一致。
export const AGENT_SINGLE_CALL_BUDGET: AgentCallBudget = agentCallBudgetSchema.parse({
  policy: AGENT_CALL_BUDGET_POLICY,
  max_steps: 1,
  max_calls: 1,
  max_input_tokens: 256 * 1024 + 8192,
  max_output_tokens: 2048,
  deadline_ms: null,
  max_compressions: 0,
  max_retries: 0,
});

export const agentCallKindSchema = z.enum(['step', 'tool_continue', 'compress', 'retry']);
export type AgentCallKind = z.infer<typeof agentCallKindSchema>;

export const agentCallOutcomeSchema = z.enum([
  'completed',
  'not_sent',
  'cancelled_before_send',
  'cancelled_after_send',
  'http_401',
  'http_429',
  'unknown_result',
]);
export type AgentCallOutcome = z.infer<typeof agentCallOutcomeSchema>;

// 请求已离开本机但未拿到可信用量：远端可能已处理或计费，预留不退回，运行停止。
const SENT_WITHOUT_USAGE = new Set<AgentCallOutcome>([
  'cancelled_after_send',
  'http_401',
  'http_429',
  'unknown_result',
]);

const reservation = z.strictObject({
  kind: agentCallKindSchema,
  input_tokens: count,
  output_tokens: count,
});

export const agentBudgetLedgerSchema = z
  .strictObject({
    policy: z.literal(AGENT_CALL_BUDGET_POLICY),
    started_at_ms: count,
    steps_used: count,
    calls_used: count,
    compressions_used: count,
    retries_used: count,
    input_tokens_charged: count,
    output_tokens_charged: count,
    pending: reservation.nullable(),
    last_outcome: agentCallOutcomeSchema.nullable(),
    remote_cost: z.enum(['none', 'known', 'unknown']),
    stopped: z.boolean(),
  })
  .refine((l) => !l.last_outcome || !SENT_WITHOUT_USAGE.has(l.last_outcome) || l.stopped, {
    path: ['stopped'],
  })
  .refine(
    (l) =>
      !l.last_outcome || !SENT_WITHOUT_USAGE.has(l.last_outcome) || l.remote_cost === 'unknown',
    { path: ['remote_cost'], message: 'Sent calls without usage cannot claim known or zero cost' },
  );
export type AgentBudgetLedger = z.infer<typeof agentBudgetLedgerSchema>;

export const startAgentBudgetLedger = (startedAtMs: number): AgentBudgetLedger =>
  agentBudgetLedgerSchema.parse({
    policy: AGENT_CALL_BUDGET_POLICY,
    started_at_ms: startedAtMs,
    steps_used: 0,
    calls_used: 0,
    compressions_used: 0,
    retries_used: 0,
    input_tokens_charged: 0,
    output_tokens_charged: 0,
    pending: null,
    last_outcome: null,
    remote_cost: 'none',
    stopped: false,
  });

export type AgentBudgetRefusal =
  | 'STOPPED'
  | 'CALL_PENDING'
  | 'FIRST_CALL_MUST_START_STEP'
  | 'PERMISSION_REQUIRED'
  | 'REPLAY_FORBIDDEN'
  | 'DEADLINE'
  | 'MAX_CALLS'
  | 'MAX_STEPS'
  | 'MAX_COMPRESSIONS'
  | 'MAX_RETRIES'
  | 'MAX_INPUT_TOKENS'
  | 'MAX_OUTPUT_TOKENS';

export type AgentBudgetDecision =
  | { ok: true; ledger: AgentBudgetLedger }
  | { ok: false; code: AgentBudgetRefusal; ledger: AgentBudgetLedger };

export const reserveAgentCall = (
  budget: AgentCallBudget,
  ledger: AgentBudgetLedger,
  request: {
    kind: AgentCallKind;
    input_tokens: number;
    output_tokens: number;
    now_ms: number;
    expands_permission: boolean;
  },
): AgentBudgetDecision => {
  const refuse = (code: AgentBudgetRefusal): AgentBudgetDecision => ({ ok: false, code, ledger });
  const kind = agentCallKindSchema.parse(request.kind);
  const input = count.parse(request.input_tokens);
  const output = count.parse(request.output_tokens);
  if (ledger.stopped) return refuse('STOPPED');
  if (ledger.pending) return refuse('CALL_PENDING');
  if (ledger.calls_used === 0 && kind !== 'step') return refuse('FIRST_CALL_MUST_START_STEP');
  // 扩大权限必须暂停并补授权，预算余量不构成授权。
  if (request.expands_permission) return refuse('PERMISSION_REQUIRED');
  // 只有确认未发出的调用可在预算内重试；401/429/结果未知已在结算时停止运行。
  if (kind === 'retry' && ledger.last_outcome !== 'not_sent') return refuse('REPLAY_FORBIDDEN');
  if (budget.deadline_ms !== null && request.now_ms - ledger.started_at_ms >= budget.deadline_ms)
    return refuse('DEADLINE');
  // 工具续跑、压缩和重试都消耗同一调用上限，不能借续跑/压缩重置计数。
  if (ledger.calls_used + 1 > budget.max_calls) return refuse('MAX_CALLS');
  if (kind === 'step' && ledger.steps_used + 1 > budget.max_steps) return refuse('MAX_STEPS');
  if (kind === 'compress' && ledger.compressions_used + 1 > budget.max_compressions)
    return refuse('MAX_COMPRESSIONS');
  if (kind === 'retry' && ledger.retries_used + 1 > budget.max_retries)
    return refuse('MAX_RETRIES');
  if (ledger.input_tokens_charged + input > budget.max_input_tokens)
    return refuse('MAX_INPUT_TOKENS');
  if (ledger.output_tokens_charged + output > budget.max_output_tokens)
    return refuse('MAX_OUTPUT_TOKENS');
  return {
    ok: true,
    ledger: agentBudgetLedgerSchema.parse({
      ...ledger,
      steps_used: ledger.steps_used + (kind === 'step' ? 1 : 0),
      calls_used: ledger.calls_used + 1,
      compressions_used: ledger.compressions_used + (kind === 'compress' ? 1 : 0),
      retries_used: ledger.retries_used + (kind === 'retry' ? 1 : 0),
      input_tokens_charged: ledger.input_tokens_charged + input,
      output_tokens_charged: ledger.output_tokens_charged + output,
      pending: { kind, input_tokens: input, output_tokens: output },
    }),
  };
};

export const settleAgentCall = (
  ledger: AgentBudgetLedger,
  outcome: AgentCallOutcome,
  usage: { input: number; output: number } | null,
): AgentBudgetLedger => {
  const pending = ledger.pending;
  if (!pending) throw new Error('No pending call to settle');
  agentCallOutcomeSchema.parse(outcome);
  if ((outcome === 'completed') !== (usage !== null))
    throw new Error('Usage is required for completed calls and forbidden otherwise');
  const base = { ...ledger, pending: null, last_outcome: outcome };
  if (outcome === 'completed' && usage) {
    // 实际用量替换预留；之前已出现未知费用时保持未知。
    return agentBudgetLedgerSchema.parse({
      ...base,
      input_tokens_charged:
        ledger.input_tokens_charged - pending.input_tokens + count.parse(usage.input),
      output_tokens_charged:
        ledger.output_tokens_charged - pending.output_tokens + count.parse(usage.output),
      remote_cost: ledger.remote_cost === 'unknown' ? 'unknown' : 'known',
    });
  }
  if (outcome === 'not_sent' || outcome === 'cancelled_before_send')
    return agentBudgetLedgerSchema.parse({
      ...base,
      input_tokens_charged: ledger.input_tokens_charged - pending.input_tokens,
      output_tokens_charged: ledger.output_tokens_charged - pending.output_tokens,
      stopped: outcome === 'cancelled_before_send',
    });
  return agentBudgetLedgerSchema.parse({ ...base, remote_cost: 'unknown', stopped: true });
};

export type AgentReplayDecision = {
  auto_replay: boolean;
  next: 'continue' | 'retry' | 'reauthorize' | 'user_retry' | 'reconcile' | 'stopped';
};

export const agentCallReplayDecision = (
  budget: AgentCallBudget,
  ledger: AgentBudgetLedger,
): AgentReplayDecision => {
  switch (ledger.last_outcome) {
    case 'not_sent':
      return ledger.retries_used < budget.max_retries && ledger.calls_used < budget.max_calls
        ? { auto_replay: true, next: 'retry' }
        : { auto_replay: false, next: 'user_retry' };
    case 'http_401':
      return { auto_replay: false, next: 'reauthorize' };
    case 'http_429':
      return { auto_replay: false, next: 'user_retry' };
    case 'unknown_result':
      return { auto_replay: false, next: 'reconcile' };
    case 'cancelled_before_send':
    case 'cancelled_after_send':
      return { auto_replay: false, next: 'stopped' };
    default:
      return { auto_replay: false, next: 'continue' };
  }
};
