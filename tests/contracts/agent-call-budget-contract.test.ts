import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALL_BUDGET,
  callBudgetSchema,
  callLedgerSchema,
  committedTokens,
  describeRemoteCost,
  reserveCall,
  settleCall,
  startCallLedger,
  type CallBudget,
  type CallLedger,
  type CallRequest,
} from '../../packages/contracts/src/agent-call-budget';

const id = '11111111-1111-4111-8111-111111111111';
const grant = '22222222-2222-4222-8222-222222222222';
const multi: CallBudget = {
  ...DEFAULT_CALL_BUDGET,
  max_steps: 3,
  max_calls: 5,
  max_compressions: 1,
  max_total_tokens: 10_000,
  expansion_authorization_id: grant,
};
const ask = (kind: CallRequest['kind'], now_ms = 1_000, input_tokens = 100): CallRequest => ({
  kind,
  input_tokens,
  output_tokens: 200,
  now_ms,
});
const done = { outcome: 'completed' as const, actual_input_tokens: 90, actual_output_tokens: 50 };

function reserved(budget: CallBudget, ledger: CallLedger, request: CallRequest) {
  const result = reserveCall(budget, ledger, request);
  if (!result.ok) throw new Error(`refused:${result.reason}`);
  return result;
}
function run(budget: CallBudget, kinds: CallRequest['kind'][]) {
  let ledger = startCallLedger(id, 0);
  for (const kind of kinds) {
    const next = reserved(budget, ledger, ask(kind));
    ledger = settleCall(next.ledger, next.call_index, done);
  }
  return ledger;
}
const refusal = (budget: CallBudget, ledger: CallLedger, request: CallRequest) => {
  const result = reserveCall(budget, ledger, request);
  return result.ok ? 'ACCEPTED' : result.reason;
};

describe('DEV-1760 call budget and continuation policy contract', () => {
  it('keeps the single-call default and demands authorization for any expansion', () => {
    expect(callBudgetSchema.safeParse(DEFAULT_CALL_BUDGET).success).toBe(true);
    expect(callBudgetSchema.safeParse(multi).success).toBe(true);
    for (const widened of [
      { max_steps: 2, max_calls: 2 },
      { max_calls: 2 },
      { max_compressions: 1, max_calls: 2 },
    ])
      expect(callBudgetSchema.safeParse({ ...DEFAULT_CALL_BUDGET, ...widened }).success).toBe(
        false,
      );
    expect(
      callBudgetSchema.safeParse({ ...DEFAULT_CALL_BUDGET, expansion_authorization_id: grant })
        .success,
    ).toBe(false);
  });

  it('has no automatic retry quota and bounds output, steps and compression within calls', () => {
    expect(callBudgetSchema.safeParse({ ...DEFAULT_CALL_BUDGET, max_retries: 1 }).success).toBe(
      false,
    );
    expect(
      callBudgetSchema.safeParse({ ...DEFAULT_CALL_BUDGET, max_output_tokens_per_call: 4096 })
        .success,
    ).toBe(false);
    expect(callBudgetSchema.safeParse({ ...multi, max_calls: 2 }).success).toBe(false);
    expect(callBudgetSchema.safeParse({ ...multi, max_steps: 3, max_calls: 3 }).success).toBe(
      false,
    );
    expect(callBudgetSchema.safeParse({ ...multi, unknown_field: true }).success).toBe(false);
  });

  it('allows exactly one call by default and refuses every continuation', () => {
    const first = reserved(DEFAULT_CALL_BUDGET, startCallLedger(id, 0), ask('initial'));
    const ledger = settleCall(first.ledger, 0, done);
    expect(refusal(DEFAULT_CALL_BUDGET, ledger, ask('initial'))).toBe('INITIAL_ALREADY_USED');
    expect(refusal(DEFAULT_CALL_BUDGET, ledger, ask('tool_continue'))).toBe('MAX_CALLS');
    expect(refusal(DEFAULT_CALL_BUDGET, ledger, ask('compress'))).toBe('MAX_CALLS');
  });

  it('does not let tool continuation or compression exceed the step, compression or call caps', () => {
    const two = run(multi, ['initial', 'tool_continue', 'tool_continue']);
    expect(refusal(multi, two, ask('tool_continue'))).toBe('MAX_STEPS');
    const squeezed = run(multi, ['initial', 'compress']);
    expect(refusal(multi, squeezed, ask('compress'))).toBe('COMPRESSION_LIMIT');
    const full = run({ ...multi, max_compressions: 2 }, [
      'initial',
      'compress',
      'compress',
      'tool_continue',
      'tool_continue',
    ]);
    expect(refusal({ ...multi, max_compressions: 2 }, full, ask('tool_continue'))).toBe(
      'MAX_CALLS',
    );
    expect(refusal({ ...multi, max_compressions: 2 }, full, ask('compress'))).toBe('MAX_CALLS');
    expect(refusal(multi, startCallLedger(id, 0), ask('tool_continue'))).toBe('NO_INITIAL_CALL');
  });

  it('counts compression as a call but not as a new step', () => {
    const ledger = run(multi, ['initial', 'compress']);
    expect(ledger.calls).toHaveLength(2);
    expect(ledger.steps_started).toBe(1);
    expect(ledger.compressions).toBe(1);
  });

  it('enforces the shared token budget including reservations and unknown outcomes', () => {
    const tight = { ...multi, max_total_tokens: 700 };
    const first = reserved(tight, startCallLedger(id, 0), ask('initial'));
    expect(refusal(tight, first.ledger, ask('tool_continue'))).toBe('UNSETTLED_CALL');
    const ledger = settleCall(first.ledger, 0, done);
    expect(committedTokens(ledger)).toBe(140);
    expect(refusal(tight, ledger, { ...ask('tool_continue'), input_tokens: 400 })).toBe(
      'TOKEN_BUDGET',
    );
    expect(refusal(tight, ledger, { ...ask('tool_continue'), output_tokens: 4096 })).toBe(
      'OUTPUT_TOKEN_LIMIT',
    );
    const unverified = settleCall(first.ledger, 0, { ...done, actual_input_tokens: null });
    expect(committedTokens(unverified)).toBe(300);
  });

  it('uses one run-level deadline that continuation cannot reset', () => {
    const timed = { ...multi, deadline_ms: 5_000 };
    const ledger = run(timed, ['initial']);
    expect(refusal(timed, ledger, ask('tool_continue', 4_999))).toBe('ACCEPTED');
    expect(refusal(timed, ledger, ask('tool_continue', 5_000))).toBe('DEADLINE');
    expect(refusal(timed, ledger, ask('compress', 9_000))).toBe('DEADLINE');
  });

  it('never allows automatic retry or replay of the same request', () => {
    const ledger = run(multi, ['initial']);
    expect(refusal(multi, ledger, ask('retry'))).toBe('RETRY_FORBIDDEN');
    expect(refusal(multi, ledger, ask('replay'))).toBe('REPLAY_FORBIDDEN');
  });

  it.each(['auth_rejected_401', 'rate_limited_429', 'result_unknown', 'cancelled'] as const)(
    'stops all further calls after %s and records the remote cost as unknown',
    (outcome) => {
      const first = reserved(multi, startCallLedger(id, 0), ask('initial'));
      const ledger = settleCall(first.ledger, 0, {
        outcome,
        actual_input_tokens: 0,
        actual_output_tokens: 0,
      });
      const call = ledger.calls[0];
      expect(call?.remote_cost).toBe('unknown');
      expect(call?.actual_input_tokens).toBeNull();
      expect(committedTokens(ledger)).toBe(300);
      for (const kind of ['initial', 'tool_continue', 'compress', 'retry', 'replay'] as const)
        expect(refusal(multi, ledger, ask(kind))).toBe('PRIOR_FAILURE_NO_REPLAY');
      expect(callLedgerSchema.safeParse(ledger).success).toBe(true);
      expect(describeRemoteCost('unknown')).not.toMatch(/零费用|无远端费用/);
    },
  );

  it('rejects a ledger that claims cancellation or unknown results cost nothing', () => {
    const first = reserved(multi, startCallLedger(id, 0), ask('initial'));
    const cancelled = settleCall(first.ledger, 0, { ...done, outcome: 'cancelled' });
    for (const remote_cost of ['none_dispatched', 'settled'] as const) {
      const forged = {
        ...cancelled,
        calls: cancelled.calls.map((call) => ({ ...call, remote_cost })),
      };
      expect(callLedgerSchema.safeParse(forged).success).toBe(false);
    }
    const settledUnknownTokens = settleCall(first.ledger, 0, {
      ...done,
      actual_output_tokens: null,
    });
    expect(settledUnknownTokens.calls[0]?.remote_cost).toBe('unknown');
  });

  it('only a call that was never dispatched may claim no remote cost', () => {
    const first = reserved(multi, startCallLedger(id, 0), ask('initial'));
    const refused = settleCall(first.ledger, 0, {
      outcome: 'local_refused',
      actual_input_tokens: null,
      actual_output_tokens: null,
    });
    expect(refused.calls[0]?.remote_cost).toBe('none_dispatched');
    expect(describeRemoteCost('none_dispatched')).toContain('未发出');
    expect(() => settleCall(refused, 0, done)).toThrow('awaiting settlement');
  });

  it('does not mutate the input ledger when reserving or settling', () => {
    const base = startCallLedger(id, 0);
    const frozen = structuredClone(base);
    const next = reserved(multi, base, ask('initial'));
    settleCall(next.ledger, 0, done);
    expect(base).toEqual(frozen);
  });
});
