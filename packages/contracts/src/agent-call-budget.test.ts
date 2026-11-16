import { describe, expect, it } from 'vitest';
import {
  agentCallBudgetCancelSettlementSchema,
  agentCallBudgetPolicySchema,
  classifyHttpStatus,
  createAgentCallBudgetLedger,
  defaultAgentCallBudgetPolicy,
  requestContextCompress,
  requestToolContinue,
  reserveProviderCall,
  recordModelStep,
  recordObservedOutputTokens,
  settleCancelledRun,
  settleProviderCall,
  shouldAutoReplayTransport,
} from './agent-call-budget';

describe('agentCallBudgetPolicySchema', () => {
  it('keeps single-call default and zero automatic retries', () => {
    const policy = defaultAgentCallBudgetPolicy();
    expect(agentCallBudgetPolicySchema.parse(policy)).toEqual({
      protocol_version: 1,
      max_steps: 1,
      max_calls: 1,
      max_output_tokens: 2048,
      automatic_retries: 0,
      single_call_default: true,
    });
    expect(() => agentCallBudgetPolicySchema.parse({ ...policy, automatic_retries: 1 })).toThrow();
  });
});

describe('reserve and step budgets', () => {
  it('enforces max_calls, max_steps, tokens, and deadline', () => {
    const policy = defaultAgentCallBudgetPolicy({
      max_steps: 2,
      max_calls: 2,
      max_output_tokens: 100,
      deadline_ms: 50,
    });
    const start = 1_000;
    const ledger = createAgentCallBudgetLedger(policy, start);
    reserveProviderCall(ledger, start);
    recordModelStep(ledger, start);
    recordObservedOutputTokens(ledger, 40);
    settleProviderCall(ledger, 'success', { output_tokens: 0 });
    reserveProviderCall(ledger, start + 10);
    recordModelStep(ledger, start + 10);
    expect(() => recordModelStep(ledger, start + 10)).toThrow(/max_steps/);
    settleProviderCall(ledger, 'success');
    expect(() => reserveProviderCall(ledger, start + 10)).toThrow(/max_calls/);
    expect(() => recordObservedOutputTokens(ledger, 70)).toThrow(/max_output_tokens/);
    const fresh = createAgentCallBudgetLedger(policy, start);
    reserveProviderCall(fresh, start + 10);
    expect(() => reserveProviderCall(fresh, start + 100)).toThrow(/Deadline/);
  });
});

describe('continue_run and compress cannot bypass call cap', () => {
  it('rejects continue after max_calls is consumed', () => {
    const ledger = createAgentCallBudgetLedger(
      defaultAgentCallBudgetPolicy({ max_calls: 2, max_steps: 4 }),
    );
    reserveProviderCall(ledger);
    expect(requestToolContinue(ledger).calls_remaining).toBe(1);
    settleProviderCall(ledger, 'success');
    reserveProviderCall(ledger);
    settleProviderCall(ledger, 'success');
    expect(() => requestToolContinue(ledger)).toThrow(/continue_run cannot bypass/);
    expect(() => reserveProviderCall(ledger)).toThrow(/max_calls/);
  });

  it('rejects compress while at cap with unsettled reservation', () => {
    const ledger = createAgentCallBudgetLedger(defaultAgentCallBudgetPolicy({ max_calls: 1 }));
    reserveProviderCall(ledger);
    expect(() => requestContextCompress(ledger)).toThrow(/compress cannot bypass/);
  });
});

describe('transport replay policy', () => {
  it.each(['http_401', 'http_429', 'provider_unknown', 'http_other'] as const)(
    'never auto-replays %s',
    (outcome) => {
      expect(shouldAutoReplayTransport(outcome)).toBe(false);
    },
  );

  it('classifies HTTP statuses for settlement', () => {
    expect(classifyHttpStatus(401)).toBe('http_401');
    expect(classifyHttpStatus(429)).toBe('http_429');
    expect(classifyHttpStatus(500)).toBe('http_other');
    const ledger = createAgentCallBudgetLedger();
    reserveProviderCall(ledger);
    settleProviderCall(ledger, 'http_429');
    expect(ledger.closed?.remote_billing).toBe('unknown');
    expect(ledger.closed?.last_outcome).toBe('http_429');
  });
});

describe('cancel settlement billing semantics', () => {
  it('never claims remote zero cost after dispatch', () => {
    const ledger = createAgentCallBudgetLedger();
    reserveProviderCall(ledger);
    const settlement = settleCancelledRun(ledger, true);
    expect(settlement).toEqual({
      status: 'cancelled',
      provider_dispatched: true,
      remote_billing: 'unknown',
    });
    expect(() =>
      agentCallBudgetCancelSettlementSchema.parse({
        status: 'cancelled',
        provider_dispatched: true,
        remote_billing: 'not_applicable',
      }),
    ).toThrow();
  });

  it('allows not_applicable only before provider dispatch', () => {
    const ledger = createAgentCallBudgetLedger();
    const settlement = settleCancelledRun(ledger, false);
    expect(settlement.remote_billing).toBe('not_applicable');
    expect(ledger.closed?.remote_billing).toBe('not_applicable');
  });
});
