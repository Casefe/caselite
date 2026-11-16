import { z } from 'zod';

// DEV-1760 / PLH-05：复用 DEV-1586 的调用预算与续跑差异合同；纯类型与策略，不接第二 Runtime。
export const agentCallBudgetProtocolVersion = 1;

export const agentTransportOutcomeSchema = z.enum([
  'success',
  'cancelled',
  'http_401',
  'http_429',
  'http_other',
  'provider_unknown',
  'deadline_exceeded',
  'budget_exceeded',
]);
export type AgentTransportOutcome = z.infer<typeof agentTransportOutcomeSchema>;

export const agentRemoteBillingSchema = z.enum(['unknown', 'settled', 'not_applicable']);
export type AgentRemoteBilling = z.infer<typeof agentRemoteBillingSchema>;

export const agentCallBudgetPolicySchema = z
  .object({
    protocol_version: z.literal(agentCallBudgetProtocolVersion),
    max_steps: z.number().int().min(1).max(256),
    max_calls: z.number().int().min(1).max(64),
    max_output_tokens: z.number().int().positive().max(2_000_000),
    max_input_tokens: z.number().int().positive().max(2_000_000).optional(),
    deadline_ms: z.number().int().positive().optional(),
    automatic_retries: z.literal(0),
    single_call_default: z.literal(true).optional(),
  })
  .strict();
export type AgentCallBudgetPolicy = z.infer<typeof agentCallBudgetPolicySchema>;

export const agentCallBudgetCancelSettlementSchema = z
  .object({
    status: z.literal('cancelled'),
    remote_billing: z.enum(['unknown', 'not_applicable']),
    provider_dispatched: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider_dispatched && value.remote_billing === 'not_applicable') {
      context.addIssue({
        code: 'custom',
        message: 'Cancelled after provider dispatch cannot claim not_applicable billing',
        path: ['remote_billing'],
      });
    }
  });
export type AgentCallBudgetCancelSettlement = z.infer<typeof agentCallBudgetCancelSettlementSchema>;

export type AgentCallBudgetLedger = {
  policy: AgentCallBudgetPolicy;
  started_at_ms: number;
  steps_used: number;
  calls_reserved: number;
  calls_settled: number;
  output_tokens_observed: number;
  compress_events: number;
  continue_events: number;
  closed?: {
    run_status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
    remote_billing: AgentRemoteBilling;
    last_outcome?: AgentTransportOutcome;
  };
};

export class AgentCallBudgetViolation extends Error {
  constructor(
    readonly code: 'BUDGET_EXCEEDED' | 'LEDGER_CLOSED' | 'POLICY',
    message: string,
  ) {
    super(message);
    this.name = 'AgentCallBudgetViolation';
  }
}

export function defaultAgentCallBudgetPolicy(
  overrides: Partial<Omit<AgentCallBudgetPolicy, 'protocol_version' | 'automatic_retries'>> = {},
): AgentCallBudgetPolicy {
  return agentCallBudgetPolicySchema.parse({
    protocol_version: agentCallBudgetProtocolVersion,
    max_steps: 1,
    max_calls: 1,
    max_output_tokens: 2048,
    automatic_retries: 0,
    single_call_default: true,
    ...overrides,
  });
}

export function createAgentCallBudgetLedger(
  policy: AgentCallBudgetPolicy = defaultAgentCallBudgetPolicy(),
  now = Date.now(),
): AgentCallBudgetLedger {
  agentCallBudgetPolicySchema.parse(policy);
  return {
    policy,
    started_at_ms: now,
    steps_used: 0,
    calls_reserved: 0,
    calls_settled: 0,
    output_tokens_observed: 0,
    compress_events: 0,
    continue_events: 0,
  };
}

function assertOpen(ledger: AgentCallBudgetLedger) {
  if (ledger.closed)
    throw new AgentCallBudgetViolation('LEDGER_CLOSED', 'Call budget ledger closed');
}

function assertDeadline(ledger: AgentCallBudgetLedger, now: number) {
  const limit = ledger.policy.deadline_ms;
  if (limit !== undefined && now - ledger.started_at_ms > limit) {
    throw new AgentCallBudgetViolation('BUDGET_EXCEEDED', 'Deadline exceeded');
  }
}

export function reserveProviderCall(ledger: AgentCallBudgetLedger, now = Date.now()) {
  assertOpen(ledger);
  assertDeadline(ledger, now);
  if (ledger.calls_reserved !== ledger.calls_settled) {
    throw new AgentCallBudgetViolation('POLICY', 'Cannot reserve while a call is unsettled');
  }
  if (ledger.calls_reserved >= ledger.policy.max_calls) {
    throw new AgentCallBudgetViolation('BUDGET_EXCEEDED', 'max_calls exhausted');
  }
  ledger.calls_reserved += 1;
  return ledger.calls_reserved;
}

export function recordModelStep(ledger: AgentCallBudgetLedger, now = Date.now()) {
  assertOpen(ledger);
  assertDeadline(ledger, now);
  if (ledger.steps_used >= ledger.policy.max_steps) {
    throw new AgentCallBudgetViolation('BUDGET_EXCEEDED', 'max_steps exhausted');
  }
  ledger.steps_used += 1;
}

export function recordObservedOutputTokens(ledger: AgentCallBudgetLedger, tokens: number) {
  assertOpen(ledger);
  if (!Number.isInteger(tokens) || tokens < 0) {
    throw new AgentCallBudgetViolation('POLICY', 'Invalid output token count');
  }
  const next = ledger.output_tokens_observed + tokens;
  if (next > ledger.policy.max_output_tokens) {
    throw new AgentCallBudgetViolation('BUDGET_EXCEEDED', 'max_output_tokens exceeded');
  }
  ledger.output_tokens_observed = next;
}

// 工具续跑只记录意图，不得重置或绕过已消耗的 max_calls。
export function requestToolContinue(ledger: AgentCallBudgetLedger) {
  assertOpen(ledger);
  ledger.continue_events += 1;
  const remaining = ledger.policy.max_calls - ledger.calls_reserved;
  if (remaining <= 0) {
    throw new AgentCallBudgetViolation('BUDGET_EXCEEDED', 'continue_run cannot bypass max_calls');
  }
  return { continue_events: ledger.continue_events, calls_remaining: remaining };
}

// 压缩上下文不得在未结清调用时伪造额外额度。
export function requestContextCompress(ledger: AgentCallBudgetLedger) {
  assertOpen(ledger);
  ledger.compress_events += 1;
  if (
    ledger.calls_reserved > ledger.calls_settled &&
    ledger.calls_reserved >= ledger.policy.max_calls
  ) {
    throw new AgentCallBudgetViolation('BUDGET_EXCEEDED', 'compress cannot bypass max_calls');
  }
  return { compress_events: ledger.compress_events };
}

export function classifyHttpStatus(status: number): AgentTransportOutcome {
  if (status === 401) return 'http_401';
  if (status === 429) return 'http_429';
  if (status >= 200 && status < 300) return 'success';
  return 'http_other';
}

export function shouldAutoReplayTransport(outcome: AgentTransportOutcome): false {
  if (
    outcome === 'http_401' ||
    outcome === 'http_429' ||
    outcome === 'provider_unknown' ||
    outcome === 'http_other'
  ) {
    return false;
  }
  return false;
}

export function settleProviderCall(
  ledger: AgentCallBudgetLedger,
  outcome: AgentTransportOutcome,
  details: { output_tokens?: number } = {},
) {
  assertOpen(ledger);
  if (ledger.calls_reserved !== ledger.calls_settled + 1) {
    throw new AgentCallBudgetViolation('POLICY', 'No reserved provider call to settle');
  }
  if (details.output_tokens !== undefined)
    recordObservedOutputTokens(ledger, details.output_tokens);
  ledger.calls_settled += 1;
  if (outcome === 'success') {
    return;
  }
  const run_status = outcome === 'cancelled' ? 'cancelled' : 'failed';
  ledger.closed = {
    run_status,
    remote_billing: outcome === 'cancelled' ? 'unknown' : 'unknown',
    last_outcome: outcome,
  };
}

export function settleCancelledRun(
  ledger: AgentCallBudgetLedger,
  providerDispatched: boolean,
): AgentCallBudgetCancelSettlement {
  assertOpen(ledger);
  const settlement = agentCallBudgetCancelSettlementSchema.parse({
    status: 'cancelled',
    provider_dispatched: providerDispatched,
    remote_billing: providerDispatched ? 'unknown' : 'not_applicable',
  });
  if (ledger.calls_reserved > ledger.calls_settled) {
    ledger.calls_settled = ledger.calls_reserved;
  }
  ledger.closed = {
    run_status: 'cancelled',
    remote_billing: settlement.remote_billing,
    last_outcome: 'cancelled',
  };
  return settlement;
}

export function parseAgentCallBudgetPolicy(input: unknown): AgentCallBudgetPolicy {
  return agentCallBudgetPolicySchema.parse(input);
}
