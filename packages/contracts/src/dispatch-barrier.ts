import { z } from 'zod';
import { agentRunSchema } from './agent';

// DEV-1759 派发屏障负向回归的观测合同：只描述从既有 Agent Application 与 Pi Runtime 外部可观测的结果；
// 不是第二 Runtime，不授予工具、派发或外发能力，也不代表产品验收。
export const dispatchBarrierCaseSchema = z.enum([
  'stop_before_dispatch',
  'stop_mid_tool',
  'unknown_tool',
  'late_event_new_run',
]);
export type DispatchBarrierCase = z.infer<typeof dispatchBarrierCaseSchema>;

const runState = z.union([z.literal('not_registered'), agentRunSchema.shape.status]);
const count = z.number().int().nonnegative();

export const dispatchBarrierObservationSchema = z.strictObject({
  case: dispatchBarrierCaseSchema,
  // 被阻断运行实际到达模型流的次数；预处理停止必须为0，其余不得出现续跑或重试。
  provider_dispatches: count,
  // 任何工具副作用的执行次数（含获准 set_theme 的本地写入）。
  tool_effects: count,
  barrier_run: runState,
  // 停止或拒绝之后，被阻断运行的状态、输出或序号是否仍被改动。
  barrier_run_mutated_after_stop: z.boolean(),
  // 同一窗口随后的新运行：用于证明迟到事件和停止标记不泄漏到新 Run。
  next_run_dispatches: count,
  next_run_status: runState,
  next_run_output_is_own: z.boolean(),
});
export type DispatchBarrierObservation = z.infer<typeof dispatchBarrierObservationSchema>;

const nextRunUnaffected = {
  next_run_dispatches: 1,
  next_run_status: 'succeeded',
  next_run_output_is_own: true,
} as const;

export const DISPATCH_BARRIER_EXPECTED: Readonly<
  Record<DispatchBarrierCase, Omit<DispatchBarrierObservation, 'case'>>
> = {
  stop_before_dispatch: {
    provider_dispatches: 0,
    tool_effects: 0,
    barrier_run: 'not_registered',
    barrier_run_mutated_after_stop: false,
    ...nextRunUnaffected,
  },
  stop_mid_tool: {
    provider_dispatches: 1,
    tool_effects: 0,
    barrier_run: 'cancelled',
    barrier_run_mutated_after_stop: false,
    ...nextRunUnaffected,
  },
  unknown_tool: {
    provider_dispatches: 1,
    tool_effects: 0,
    barrier_run: 'failed',
    barrier_run_mutated_after_stop: false,
    ...nextRunUnaffected,
  },
  late_event_new_run: {
    provider_dispatches: 1,
    tool_effects: 0,
    barrier_run: 'cancelled',
    barrier_run_mutated_after_stop: false,
    ...nextRunUnaffected,
  },
};

export function dispatchBarrierViolations(input: unknown): string[] {
  const parsed = dispatchBarrierObservationSchema.safeParse(input);
  if (!parsed.success) return ['INVALID_OBSERVATION'];
  const { case: id, ...actual } = parsed.data;
  return Object.entries(DISPATCH_BARRIER_EXPECTED[id])
    .filter(([field, expected]) => actual[field as keyof typeof actual] !== expected)
    .map(
      ([field, expected]) =>
        `${id}.${field}: expected ${String(expected)}, got ${String(actual[field as keyof typeof actual])}`,
    );
}
