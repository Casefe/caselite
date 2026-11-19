import { z } from 'zod';

// DEV-1760：调用预算与续跑差异。utf8-byte-proxy-v1 只估算单次请求的可见字节，
// 不计数步骤、调用、压缩、重试，也不区分预留与结算。本模块只冻结该差异。
// 当前默认仍是单次派发。多步、自动压缩、自动重试保持不可执行的条件候选。
// agent:v1 与 Pi runtime 不消费本 DTO：不新增第二 Runtime，也不改产品 IPC。

export const CALL_BUDGET_POLICY_ID = 'single-dispatch-difference-v1' as const;
export const INPUT_BYTE_BUDGET_POLICY_ID = 'utf8-byte-proxy-v1' as const;

const tokenReserveSchema = z.strictObject({
  // null 表示本政策没有精确输入 token 预留。0 会被误读成已结算零费用，因此不能当作预留。
  input: z.union([z.number().int().positive(), z.null()]),
  output: z.literal(2048),
});

export const callBudgetPolicySchema = z.strictObject({
  policy: z.literal(CALL_BUDGET_POLICY_ID),
  // 字面量锁住当前单次默认。多步/多次不是本政策能放行的续跑。
  max_steps: z.literal(1),
  max_calls: z.literal(1),
  token_reserve: tokenReserveSchema,
  deadline_ms: z.literal(60_000),
  compress_count: z.literal(0),
  retry_count: z.literal(0),
});
export type CallBudgetPolicy = z.infer<typeof callBudgetPolicySchema>;

export const callBudgetLedgerSchema = z
  .strictObject({
    steps_used: z.number().int().nonnegative(),
    calls_used: z.number().int().nonnegative(),
    elapsed_ms: z.number().int().nonnegative(),
    compress_attempts: z.number().int().nonnegative(),
    retry_attempts: z.number().int().nonnegative(),
    settled_tokens: z
      .strictObject({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
      })
      .nullable(),
    remote_cost: z.enum(['unobserved', 'unknown', 'settled']),
  })
  .superRefine((ledger, context) => {
    const bill = ledger.settled_tokens;
    if (ledger.remote_cost === 'settled' && !bill) {
      context.addIssue({ code: 'custom', message: 'Settled cost requires observed tokens' });
    }
    if (ledger.remote_cost !== 'settled' && bill) {
      context.addIssue({ code: 'custom', message: 'Unsettled cost cannot carry a token bill' });
    }
    if (bill && bill.input === 0 && bill.output === 0) {
      context.addIssue({ code: 'custom', message: 'A zero token bill is not a settlement' });
    }
  });
export type CallBudgetLedger = z.infer<typeof callBudgetLedgerSchema>;

const bypassFlags = {
  // 敌对夹具可以声称“不计数”或“压缩后预算清零”；政策必须忽略这两项。
  reset_budget: z.boolean().optional(),
  counts_as_call: z.boolean().optional(),
};

export const callBudgetAttemptSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('dispatch') }),
  z.strictObject({ action: z.literal('tool_continue'), ...bypassFlags }),
  z.strictObject({ action: z.literal('compress'), ...bypassFlags }),
  z.strictObject({
    action: z.literal('retry'),
    reason: z.enum(['401', '429', 'unknown', 'deadline', 'other']),
    ...bypassFlags,
  }),
  z.strictObject({
    action: z.literal('cancel'),
    remote_cost_claim: z.enum(['zero', 'unknown']),
  }),
  z.strictObject({ action: z.literal('permission_expand') }),
  z.strictObject({
    action: z.literal('settle'),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
]);
export type CallBudgetAttempt = z.infer<typeof callBudgetAttemptSchema>;

export const callBudgetCandidateSchema = z.strictObject({
  status: z.literal('conditional_candidate'),
  kind: z.enum(['multi_step', 'auto_compress', 'auto_retry']),
  executable: z.literal(false),
});
export type CallBudgetCandidate = z.infer<typeof callBudgetCandidateSchema>;

export const callBudgetDecisionSchema = z.strictObject({
  allowed: z.boolean(),
  auto_replay: z.literal(false),
  code: z.enum([
    'DISPATCH',
    'BUDGET_EXHAUSTED',
    'DEADLINE',
    'CONTINUE_BLOCKED',
    'COMPRESS_BLOCKED',
    'REPLAY_BLOCKED',
    'CANCEL_COST_UNKNOWN',
    'ZERO_COST_REJECTED',
    'PERMISSION_PAUSED',
    'SETTLED',
    'SETTLE_BLOCKED',
  ]),
  authorization: z.enum(['unchanged', 'required']),
  ledger: callBudgetLedgerSchema,
});
export type CallBudgetDecision = z.infer<typeof callBudgetDecisionSchema>;

export const defaultCallBudgetPolicy = callBudgetPolicySchema.parse({
  policy: CALL_BUDGET_POLICY_ID,
  max_steps: 1,
  max_calls: 1,
  token_reserve: { input: null, output: 2048 },
  deadline_ms: 60_000,
  compress_count: 0,
  retry_count: 0,
});

export const emptyCallBudgetLedger = callBudgetLedgerSchema.parse({
  steps_used: 0,
  calls_used: 0,
  elapsed_ms: 0,
  compress_attempts: 0,
  retry_attempts: 0,
  settled_tokens: null,
  remote_cost: 'unobserved',
});

// 条件候选只说明尚未授权，不能变成一次派发、压缩或重试。
export function candidateAuthorizesRun(candidate: CallBudgetCandidate) {
  callBudgetCandidateSchema.parse(candidate);
  return false as const;
}

function unknownCost(ledger: CallBudgetLedger): CallBudgetLedger {
  if (ledger.remote_cost === 'settled') return ledger;
  return { ...ledger, remote_cost: 'unknown', settled_tokens: null };
}

function decide(
  policy: CallBudgetPolicy,
  ledger: CallBudgetLedger,
  attempt: CallBudgetAttempt,
): CallBudgetDecision {
  const base = {
    auto_replay: false as const,
    authorization: 'unchanged' as const,
  };
  const refuse = (code: CallBudgetDecision['code'], next: CallBudgetLedger = ledger) => ({
    ...base,
    allowed: false,
    code,
    ledger: next,
  });

  switch (attempt.action) {
    case 'dispatch': {
      if (ledger.elapsed_ms >= policy.deadline_ms) {
        return refuse('DEADLINE', ledger.calls_used > 0 ? unknownCost(ledger) : ledger);
      }
      const room =
        ledger.steps_used < policy.max_steps &&
        ledger.calls_used < policy.max_calls &&
        ledger.remote_cost === 'unobserved' &&
        ledger.settled_tokens === null;
      if (!room) return refuse('BUDGET_EXHAUSTED');
      return {
        ...base,
        allowed: true,
        code: 'DISPATCH',
        ledger: {
          ...ledger,
          steps_used: ledger.steps_used + 1,
          calls_used: ledger.calls_used + 1,
        },
      };
    }
    case 'tool_continue':
      // reset_budget / counts_as_call 不能把工具续跑记成预算外的新调用。
      return refuse('CONTINUE_BLOCKED');
    case 'compress':
      return refuse('COMPRESS_BLOCKED', {
        ...ledger,
        compress_attempts: ledger.compress_attempts + 1,
      });
    case 'retry': {
      const attempted = { ...ledger, retry_attempts: ledger.retry_attempts + 1 };
      const providerMayHaveCharged =
        ledger.calls_used > 0 ||
        attempt.reason === '401' ||
        attempt.reason === '429' ||
        attempt.reason === 'unknown' ||
        attempt.reason === 'deadline';
      return refuse('REPLAY_BLOCKED', providerMayHaveCharged ? unknownCost(attempted) : attempted);
    }
    case 'cancel': {
      if (attempt.remote_cost_claim === 'zero')
        return refuse('ZERO_COST_REJECTED', unknownCost(ledger));
      return {
        ...base,
        allowed: true,
        code: 'CANCEL_COST_UNKNOWN',
        ledger: ledger.remote_cost === 'settled' ? ledger : unknownCost(ledger),
      };
    }
    case 'permission_expand':
      return { ...refuse('PERMISSION_PAUSED'), authorization: 'required' };
    case 'settle': {
      const observed =
        ledger.calls_used === policy.max_calls &&
        ledger.remote_cost === 'unobserved' &&
        ledger.settled_tokens === null;
      if (attempt.input_tokens === 0 && attempt.output_tokens === 0) {
        return refuse('ZERO_COST_REJECTED', ledger.calls_used > 0 ? unknownCost(ledger) : ledger);
      }
      if (!observed || attempt.output_tokens > policy.token_reserve.output) {
        return refuse('SETTLE_BLOCKED');
      }
      return {
        ...base,
        allowed: true,
        code: 'SETTLED',
        ledger: {
          ...ledger,
          remote_cost: 'settled',
          settled_tokens: { input: attempt.input_tokens, output: attempt.output_tokens },
        },
      };
    }
    default: {
      const unreachable: never = attempt;
      return unreachable;
    }
  }
}

function assertCounters(
  before: CallBudgetLedger,
  policy: CallBudgetPolicy,
  decision: CallBudgetDecision,
) {
  const after = decision.ledger;
  if (decision.auto_replay !== false) throw new Error('自动重放已被本政策禁止');
  if (after.calls_used < before.calls_used || after.steps_used < before.steps_used)
    throw new Error('调用预算计数不可回退');
  if (after.calls_used > policy.max_calls || after.steps_used > policy.max_steps)
    throw new Error('调用预算不可被续跑或压缩突破');
  if (
    after.compress_attempts < before.compress_attempts ||
    after.retry_attempts < before.retry_attempts
  )
    throw new Error('压缩或重试计数不可清零');
  callBudgetLedgerSchema.parse(after);
}

// 预留不是结算。工具续跑、压缩、401/429/未知和取消都不能另开一次收费调用，
// 也不能把未观察到的远端费用记成 0。
export function assessCallBudget(
  policyInput: unknown,
  ledgerInput: unknown,
  attemptInput: unknown,
): CallBudgetDecision {
  const policy = callBudgetPolicySchema.parse(policyInput);
  const ledger = callBudgetLedgerSchema.parse(ledgerInput);
  const attempt = callBudgetAttemptSchema.parse(attemptInput);
  const decision = callBudgetDecisionSchema.parse(decide(policy, ledger, attempt));
  assertCounters(ledger, policy, decision);
  return decision;
}
