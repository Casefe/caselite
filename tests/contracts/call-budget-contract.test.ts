import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessCallBudget,
  callBudgetCandidateSchema,
  callBudgetPolicySchema,
  candidateAuthorizesRun,
  INPUT_BYTE_BUDGET_POLICY_ID,
  type CallBudgetAttempt,
  type CallBudgetLedger,
} from '../../packages/contracts/src/call-budget';

const fixture = JSON.parse(
  readFileSync(resolve('tests/fixtures/call-budget/single-dispatch-policy.json'), 'utf8'),
) as {
  policy_id: string;
  distinct_from_input_budget: string;
  policy: unknown;
  empty_ledger: unknown;
  candidates: unknown[];
  bypass_attempts: CallBudgetAttempt[];
};

describe('DEV-1760 call budget and continue-run difference', () => {
  it('keeps the current single dispatch and does not reuse the byte-proxy budget id', () => {
    const policy = callBudgetPolicySchema.parse(fixture.policy);
    expect(policy.policy).toBe(fixture.policy_id);
    expect(policy.policy).not.toBe(INPUT_BYTE_BUDGET_POLICY_ID);
    expect(fixture.distinct_from_input_budget).toBe(INPUT_BYTE_BUDGET_POLICY_ID);
    expect(policy).toMatchObject({
      max_steps: 1,
      max_calls: 1,
      deadline_ms: 60_000,
      compress_count: 0,
      retry_count: 0,
      token_reserve: { input: null, output: 2048 },
    });
    for (const patch of [
      { policy: INPUT_BYTE_BUDGET_POLICY_ID },
      { max_steps: 2 },
      { max_calls: 2 },
      { deadline_ms: 120_000 },
      { compress_count: 1 },
      { retry_count: 1 },
      { token_reserve: { input: 0, output: 2048 } },
      { token_reserve: { input: null, output: 4096 } },
    ])
      expect(callBudgetPolicySchema.safeParse({ ...policy, ...patch }).success).toBe(false);
  });

  it('records conditional multi-step, compress and retry candidates as non-executable', () => {
    expect(fixture.candidates).toHaveLength(3);
    for (const candidate of fixture.candidates) {
      const parsed = callBudgetCandidateSchema.parse(candidate);
      expect(candidateAuthorizesRun(parsed)).toBe(false);
    }
    expect(
      callBudgetCandidateSchema.safeParse({
        status: 'conditional_candidate',
        kind: 'multi_step',
        executable: true,
      }).success,
    ).toBe(false);
  });

  it('spends the only call on dispatch and keeps the token reserve unsettled', () => {
    const sent = assessCallBudget(fixture.policy, fixture.empty_ledger, { action: 'dispatch' });
    expect(sent.allowed).toBe(true);
    expect(sent.auto_replay).toBe(false);
    expect(sent.ledger.calls_used).toBe(1);
    expect(sent.ledger.steps_used).toBe(1);
    expect(sent.ledger.settled_tokens).toBeNull();
    expect(sent.ledger.remote_cost).toBe('unobserved');
    const again = assessCallBudget(fixture.policy, sent.ledger, { action: 'dispatch' });
    expect(again).toMatchObject({ allowed: false, auto_replay: false, code: 'BUDGET_EXHAUSTED' });
    expect(again.ledger.calls_used).toBe(1);
    const settled = assessCallBudget(fixture.policy, sent.ledger, {
      action: 'settle',
      input_tokens: 15,
      output_tokens: 4,
    });
    expect(settled.ledger.settled_tokens).toEqual({ input: 15, output: 4 });
    expect(settled.ledger.settled_tokens?.output).not.toBe(2048);
    expect(settled.ledger.remote_cost).toBe('settled');
  });

  it('refuses tool continue and compress as ways around the single call', () => {
    const opened = assessCallBudget(fixture.policy, fixture.empty_ledger, {
      action: 'compress',
      reset_budget: true,
      counts_as_call: false,
    });
    expect(opened).toMatchObject({ allowed: false, code: 'COMPRESS_BLOCKED', auto_replay: false });
    expect(opened.ledger.calls_used).toBe(0);
    expect(opened.ledger.compress_attempts).toBe(1);
    const sent = assessCallBudget(fixture.policy, opened.ledger, { action: 'dispatch' });
    expect(sent.ledger).toMatchObject({ calls_used: 1, steps_used: 1, compress_attempts: 1 });
    const continued = assessCallBudget(fixture.policy, sent.ledger, {
      action: 'tool_continue',
      reset_budget: true,
      counts_as_call: false,
    });
    expect(continued).toMatchObject({
      allowed: false,
      code: 'CONTINUE_BLOCKED',
      auto_replay: false,
    });
    expect(continued.ledger.calls_used).toBe(1);
    expect(continued.ledger.steps_used).toBe(1);
    const compressed = assessCallBudget(fixture.policy, continued.ledger, {
      action: 'compress',
      reset_budget: true,
    });
    expect(compressed.ledger).toMatchObject({ calls_used: 1, steps_used: 1, compress_attempts: 2 });
    expect(
      assessCallBudget(fixture.policy, compressed.ledger, { action: 'dispatch' }).allowed,
    ).toBe(false);
  });

  it('does not auto-replay 401, 429, unknown or deadline, and records no zero bill', () => {
    const sent = assessCallBudget(fixture.policy, fixture.empty_ledger, { action: 'dispatch' });
    for (const reason of ['401', '429', 'unknown', 'deadline'] as const) {
      const replay = assessCallBudget(fixture.policy, sent.ledger, { action: 'retry', reason });
      expect(replay.allowed).toBe(false);
      expect(replay.auto_replay).toBe(false);
      expect(replay.code).toBe('REPLAY_BLOCKED');
      expect(replay.ledger.calls_used).toBe(1);
      expect(replay.ledger.retry_attempts).toBe(1);
      expect(replay.ledger.remote_cost).toBe('unknown');
      expect(replay.ledger.settled_tokens).toBeNull();
      const rewritten = assessCallBudget(fixture.policy, replay.ledger, {
        action: 'settle',
        input_tokens: 0,
        output_tokens: 0,
      });
      expect(rewritten.allowed).toBe(false);
      expect(rewritten.ledger.remote_cost).toBe('unknown');
      expect(rewritten.ledger.settled_tokens).toBeNull();
    }
    const late = assessCallBudget(
      fixture.policy,
      { ...(fixture.empty_ledger as CallBudgetLedger), elapsed_ms: 60_000 },
      { action: 'dispatch' },
    );
    expect(late).toMatchObject({ allowed: false, auto_replay: false, code: 'DEADLINE' });
    expect(late.ledger.calls_used).toBe(0);
    expect(late.ledger.remote_cost).toBe('unobserved');
  });

  it('accepts cancel only as unknown remote cost', () => {
    const sent = assessCallBudget(fixture.policy, fixture.empty_ledger, { action: 'dispatch' });
    const zero = assessCallBudget(fixture.policy, sent.ledger, {
      action: 'cancel',
      remote_cost_claim: 'zero',
    });
    expect(zero).toMatchObject({ allowed: false, auto_replay: false, code: 'ZERO_COST_REJECTED' });
    expect(zero.ledger.settled_tokens).toBeNull();
    expect(zero.ledger.remote_cost).toBe('unknown');
    expect(zero.ledger.calls_used).toBe(1);
    const honest = assessCallBudget(fixture.policy, sent.ledger, {
      action: 'cancel',
      remote_cost_claim: 'unknown',
    });
    expect(honest.allowed).toBe(true);
    expect(honest.code).toBe('CANCEL_COST_UNKNOWN');
    expect(honest.ledger.remote_cost).toBe('unknown');
    expect(honest.ledger.settled_tokens).toBeNull();
    const paused = assessCallBudget(fixture.policy, sent.ledger, { action: 'permission_expand' });
    expect(paused).toMatchObject({
      allowed: false,
      auto_replay: false,
      code: 'PERMISSION_PAUSED',
      authorization: 'required',
    });
    expect(paused.ledger).toEqual(sent.ledger);
  });

  it('rejects every fixture bypass without a second call or a zero bill', () => {
    const sent = assessCallBudget(fixture.policy, fixture.empty_ledger, { action: 'dispatch' });
    expect(fixture.bypass_attempts.length).toBeGreaterThan(0);
    for (const attempt of fixture.bypass_attempts) {
      const decision = assessCallBudget(fixture.policy, sent.ledger, attempt);
      expect(decision.allowed).toBe(false);
      expect(decision.auto_replay).toBe(false);
      expect(decision.ledger.calls_used).toBe(1);
      expect(decision.ledger.steps_used).toBe(1);
      expect(decision.ledger.settled_tokens).toBeNull();
      expect(decision.ledger.remote_cost).not.toBe('settled');
      if (attempt.action === 'cancel') expect(decision.ledger.remote_cost).toBe('unknown');
      if (attempt.action === 'retry') {
        expect(decision.code).toBe('REPLAY_BLOCKED');
        expect(decision.ledger.remote_cost).toBe('unknown');
        expect(decision.ledger.retry_attempts).toBe(1);
      }
    }
  });
});
