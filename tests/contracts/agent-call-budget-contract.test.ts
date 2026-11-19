import { describe, expect, it } from 'vitest';
import {
  AGENT_OUTPUT_RESERVE,
  AGENT_PROTOCOL_RESERVE,
  AGENT_TEXT_MAX_BYTES,
} from '../../packages/application/src/agent-input-budget';
import { providerProfileSchema } from '../../packages/contracts/src/agent-input';
import {
  AGENT_SINGLE_CALL_BUDGET,
  agentBudgetLedgerSchema,
  agentCallBudgetSchema,
  agentCallReplayDecision,
  reserveAgentCall,
  settleAgentCall,
  startAgentBudgetLedger,
  type AgentBudgetLedger,
  type AgentCallBudget,
  type AgentCallKind,
  type AgentCallOutcome,
} from '../../packages/contracts/src/agent-call-budget';

const multiStep: AgentCallBudget = agentCallBudgetSchema.parse({
  ...AGENT_SINGLE_CALL_BUDGET,
  max_steps: 2,
  max_calls: 4,
  max_input_tokens: 10_000,
  max_output_tokens: 4_000,
  deadline_ms: 60_000,
  max_compressions: 1,
  max_retries: 1,
});
const call = (
  kind: AgentCallKind,
  extra: Partial<Parameters<typeof reserveAgentCall>[2]> = {},
) => ({
  kind,
  input_tokens: 1_000,
  output_tokens: 500,
  now_ms: 1_000,
  expands_permission: false,
  ...extra,
});
const reserved = (budget: AgentCallBudget, ledger: AgentBudgetLedger, kind: AgentCallKind) => {
  const decision = reserveAgentCall(budget, ledger, call(kind));
  if (!decision.ok) throw new Error(`unexpected refusal ${decision.code}`);
  return decision.ledger;
};
const completed = (ledger: AgentBudgetLedger) =>
  settleAgentCall(ledger, 'completed', { input: 900, output: 100 });

describe('DEV-1760 call budget defaults', () => {
  it('keeps the single-call default aligned with existing input/output reserves and zero retries', () => {
    expect(AGENT_SINGLE_CALL_BUDGET).toMatchObject({
      max_steps: 1,
      max_calls: 1,
      max_compressions: 0,
      max_retries: 0,
      deadline_ms: null,
      max_input_tokens: AGENT_TEXT_MAX_BYTES + AGENT_PROTOCOL_RESERVE,
      max_output_tokens: AGENT_OUTPUT_RESERVE,
    });
    expect(providerProfileSchema.shape.automatic_retries.value).toBe(
      AGENT_SINGLE_CALL_BUDGET.max_retries,
    );
    expect(providerProfileSchema.shape.max_output_tokens.value).toBe(
      AGENT_SINGLE_CALL_BUDGET.max_output_tokens,
    );
  });

  it('rejects multi-call budgets without a deadline and calls fewer than steps', () => {
    expect(agentCallBudgetSchema.safeParse({ ...multiStep, deadline_ms: null }).success).toBe(
      false,
    );
    expect(agentCallBudgetSchema.safeParse({ ...multiStep, max_calls: 1 }).success).toBe(false);
    expect(agentCallBudgetSchema.safeParse({ ...multiStep, extra: 1 }).success).toBe(false);
  });

  it('allows exactly one call by default and refuses any continuation, compression or retry', () => {
    let ledger = reserved(AGENT_SINGLE_CALL_BUDGET, startAgentBudgetLedger(0), 'step');
    ledger = completed(ledger);
    for (const kind of ['step', 'tool_continue', 'compress', 'retry'] as const)
      expect(reserveAgentCall(AGENT_SINGLE_CALL_BUDGET, ledger, call(kind)).ok).toBe(false);
    expect(reserveAgentCall(AGENT_SINGLE_CALL_BUDGET, ledger, call('tool_continue'))).toMatchObject(
      { ok: false, code: 'MAX_CALLS' },
    );
  });
});

describe('DEV-1760 budget cannot be bypassed', () => {
  it('counts tool continuation and compression against the same call limit', () => {
    let ledger = completed(reserved(multiStep, startAgentBudgetLedger(0), 'step'));
    ledger = completed(reserved(multiStep, ledger, 'tool_continue'));
    ledger = completed(reserved(multiStep, ledger, 'compress'));
    ledger = completed(reserved(multiStep, ledger, 'tool_continue'));
    expect(ledger).toMatchObject({ calls_used: 4, steps_used: 1, compressions_used: 1 });
    expect(reserveAgentCall(multiStep, ledger, call('compress'))).toMatchObject({
      ok: false,
      code: 'MAX_CALLS',
    });
    const roomy = { ...multiStep, max_calls: 10 };
    expect(reserveAgentCall(roomy, ledger, call('compress'))).toMatchObject({
      ok: false,
      code: 'MAX_COMPRESSIONS',
    });
  });

  it('enforces steps, deadline, tokens, pending calls, first-call shape and permission expansion', () => {
    const fresh = startAgentBudgetLedger(0);
    expect(reserveAgentCall(multiStep, fresh, call('tool_continue'))).toMatchObject({
      code: 'FIRST_CALL_MUST_START_STEP',
    });
    const pending = reserved(multiStep, fresh, 'step');
    expect(reserveAgentCall(multiStep, pending, call('tool_continue'))).toMatchObject({
      code: 'CALL_PENDING',
    });
    let ledger = completed(pending);
    ledger = completed(reserved(multiStep, ledger, 'step'));
    expect(reserveAgentCall(multiStep, ledger, call('step'))).toMatchObject({ code: 'MAX_STEPS' });
    expect(
      reserveAgentCall(multiStep, ledger, call('tool_continue', { now_ms: 60_000 })),
    ).toMatchObject({ code: 'DEADLINE' });
    expect(reserveAgentCall(multiStep, ledger, call('tool_continue', { now_ms: 59_999 })).ok).toBe(
      true,
    );
    expect(
      reserveAgentCall(multiStep, ledger, call('tool_continue', { input_tokens: 10_000 })),
    ).toMatchObject({ code: 'MAX_INPUT_TOKENS' });
    expect(
      reserveAgentCall(multiStep, ledger, call('tool_continue', { output_tokens: 3_801 })),
    ).toMatchObject({ code: 'MAX_OUTPUT_TOKENS' });
    expect(
      reserveAgentCall(multiStep, ledger, call('tool_continue', { expands_permission: true })),
    ).toMatchObject({ ok: false, code: 'PERMISSION_REQUIRED', ledger });
  });

  it('leaves the ledger unchanged when a reservation is refused', () => {
    const ledger = completed(reserved(AGENT_SINGLE_CALL_BUDGET, startAgentBudgetLedger(0), 'step'));
    const decision = reserveAgentCall(AGENT_SINGLE_CALL_BUDGET, ledger, call('tool_continue'));
    expect(decision.ok).toBe(false);
    expect(decision.ledger).toBe(ledger);
  });
});

describe('DEV-1760 unknown cost and no automatic replay', () => {
  it.each([
    ['http_401', 'reauthorize'],
    ['http_429', 'user_retry'],
    ['unknown_result', 'reconcile'],
    ['cancelled_after_send', 'stopped'],
  ] as const)('%s keeps the reservation charged, marks cost unknown and stops', (outcome, next) => {
    const pending = reserved(multiStep, startAgentBudgetLedger(0), 'step');
    const ledger = settleAgentCall(pending, outcome, null);
    expect(ledger).toMatchObject({
      stopped: true,
      remote_cost: 'unknown',
      input_tokens_charged: 1_000,
      output_tokens_charged: 500,
      pending: null,
    });
    expect(agentCallReplayDecision(multiStep, ledger)).toEqual({ auto_replay: false, next });
    for (const kind of ['retry', 'tool_continue', 'step', 'compress'] as const)
      expect(reserveAgentCall(multiStep, ledger, call(kind))).toMatchObject({ code: 'STOPPED' });
  });

  it('never lets a cancelled or failed sent call claim zero or known remote cost', () => {
    const pending = reserved(multiStep, startAgentBudgetLedger(0), 'step');
    const cancelled = settleAgentCall(pending, 'cancelled_after_send', null);
    for (const remote_cost of ['none', 'known'] as const)
      expect(agentBudgetLedgerSchema.safeParse({ ...cancelled, remote_cost }).success).toBe(false);
    expect(agentBudgetLedgerSchema.safeParse({ ...cancelled, stopped: false }).success).toBe(false);
    const knownFirst = completed(pending);
    expect(knownFirst.remote_cost).toBe('known');
    const mixed = settleAgentCall(
      reserved(multiStep, knownFirst, 'tool_continue'),
      'unknown_result',
      null,
    );
    expect(mixed).toMatchObject({ remote_cost: 'unknown', input_tokens_charged: 1_900 });
  });

  it('keeps unknown cost sticky after later successful calls are known', () => {
    const unknownFirst = agentBudgetLedgerSchema.parse({
      ...reserved(multiStep, startAgentBudgetLedger(0), 'step'),
      remote_cost: 'unknown',
    });
    expect(completed(unknownFirst).remote_cost).toBe('unknown');
  });

  it('releases tokens only for calls confirmed not sent, and cancel before send stops without cost', () => {
    const pending = reserved(multiStep, startAgentBudgetLedger(0), 'step');
    const cancelled = settleAgentCall(pending, 'cancelled_before_send', null);
    expect(cancelled).toMatchObject({
      stopped: true,
      remote_cost: 'none',
      input_tokens_charged: 0,
      calls_used: 1,
    });
    expect(agentCallReplayDecision(multiStep, cancelled)).toEqual({
      auto_replay: false,
      next: 'stopped',
    });
  });

  it('allows a not-sent retry only inside the retry and call budget, still counting the attempt', () => {
    const notSent = settleAgentCall(
      reserved(multiStep, startAgentBudgetLedger(0), 'step'),
      'not_sent',
      null,
    );
    expect(notSent).toMatchObject({ calls_used: 1, input_tokens_charged: 0, stopped: false });
    expect(agentCallReplayDecision(multiStep, notSent)).toEqual({
      auto_replay: true,
      next: 'retry',
    });
    expect(agentCallReplayDecision(AGENT_SINGLE_CALL_BUDGET, notSent)).toEqual({
      auto_replay: false,
      next: 'user_retry',
    });
    const retried = settleAgentCall(reserved(multiStep, notSent, 'retry'), 'not_sent', null);
    expect(retried.retries_used).toBe(1);
    expect(agentCallReplayDecision(multiStep, retried).auto_replay).toBe(false);
    expect(reserveAgentCall(multiStep, retried, call('retry'))).toMatchObject({
      code: 'MAX_RETRIES',
    });
    const done = completed(reserved(multiStep, startAgentBudgetLedger(0), 'step'));
    expect(reserveAgentCall(multiStep, done, call('retry'))).toMatchObject({
      code: 'REPLAY_FORBIDDEN',
    });
  });

  it('rejects settlement without a pending call or with mismatched usage', () => {
    const fresh = startAgentBudgetLedger(0);
    expect(() => settleAgentCall(fresh, 'completed', { input: 1, output: 1 })).toThrow();
    const pending = reserved(multiStep, fresh, 'step');
    expect(() => settleAgentCall(pending, 'completed', null)).toThrow();
    for (const outcome of ['http_401', 'cancelled_after_send'] satisfies AgentCallOutcome[])
      expect(() => settleAgentCall(pending, outcome, { input: 0, output: 0 })).toThrow();
  });
});
