import { z } from 'zod';
import { ordinaryDateSchema, taskPrioritySchema, taskStatusSchema } from './task';

/**
 * DEV-1892：任务组合筛选的有界表达式合同（仅数据，不含 SQL/脚本）。
 * 表达式只描述“字段 + 运算符 + 值”，范围（工作区/项目）仍由 taskListQuerySchema.scope 独立传入，
 * 不得由表达式扩大。SavedView 的持久化 Owner 仍是 DEV-1607，本文件不保存任何视图。
 */
export const TASK_FILTER_EXPRESSION_VERSION = 1;
export const TASK_FILTER_MAX_DEPTH = 3;
export const TASK_FILTER_MAX_NODES = 20;
export const TASK_FILTER_MAX_GROUP_CHILDREN = 10;
export const TASK_FILTER_MAX_IN_VALUES = 5;

export const taskFilterFields = [
  'status',
  'priority',
  'assignee',
  'due_date',
  'start_date',
] as const;
export type TaskFilterField = (typeof taskFilterFields)[number];

const assigneeValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  // 值只作为数据绑定到查询参数；控制字符（含 NUL）一律拒绝，避免日志/存储层歧义。
  .refine((v) => ![...v].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f));
const dateRangeSchema = z
  .strictObject({ from: ordinaryDateSchema, to: ordinaryDateSchema })
  .refine((v) => v.from <= v.to);

const dateConditionSchema = (field: 'due_date' | 'start_date') =>
  z.union([
    z.strictObject({
      field: z.literal(field),
      op: z.enum(['eq', 'before', 'after', 'on_or_before', 'on_or_after']),
      value: ordinaryDateSchema,
    }),
    z.strictObject({ field: z.literal(field), op: z.literal('between'), value: dateRangeSchema }),
    z.strictObject({ field: z.literal(field), op: z.enum(['is_empty', 'is_not_empty']) }),
  ]);

export const taskFilterConditionSchema = z.union([
  z.strictObject({
    field: z.literal('status'),
    op: z.enum(['eq', 'ne']),
    value: taskStatusSchema,
  }),
  z.strictObject({
    field: z.literal('status'),
    op: z.literal('in'),
    value: z.array(taskStatusSchema).min(1).max(TASK_FILTER_MAX_IN_VALUES),
  }),
  z.strictObject({
    field: z.literal('priority'),
    op: z.enum(['eq', 'ne', 'gte', 'lte']),
    value: taskPrioritySchema,
  }),
  z.strictObject({
    field: z.literal('priority'),
    op: z.literal('in'),
    value: z.array(taskPrioritySchema).min(1).max(TASK_FILTER_MAX_IN_VALUES),
  }),
  z.strictObject({
    field: z.literal('assignee'),
    op: z.enum(['eq', 'ne']),
    value: assigneeValueSchema,
  }),
  z.strictObject({ field: z.literal('assignee'), op: z.enum(['is_empty', 'is_not_empty']) }),
  dateConditionSchema('due_date'),
  dateConditionSchema('start_date'),
]);
export type TaskFilterCondition = z.infer<typeof taskFilterConditionSchema>;

export type TaskFilterNode =
  TaskFilterCondition | { logic: 'and' | 'or'; children: TaskFilterNode[] };

const taskFilterNodeSchema: z.ZodType<TaskFilterNode> = z.lazy(() =>
  z.union([
    taskFilterConditionSchema,
    z.strictObject({
      logic: z.enum(['and', 'or']),
      children: z.array(taskFilterNodeSchema).min(1).max(TASK_FILTER_MAX_GROUP_CHILDREN),
    }),
  ]),
);

export type TaskFilterLimitViolation = 'depth' | 'nodes' | 'children';

/**
 * 在交给递归 Zod 解析之前，用显式栈迭代统计深度/节点数/子节点数，
 * 使超深或超量的恶意输入不会触发递归栈耗尽，且能给出确定的拒绝原因。
 */
export function inspectTaskFilterShape(root: unknown): TaskFilterLimitViolation | null {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 1 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    nodes += 1;
    if (nodes > TASK_FILTER_MAX_NODES) return 'nodes';
    if (depth > TASK_FILTER_MAX_DEPTH) return 'depth';
    if (typeof node !== 'object' || node === null || Array.isArray(node)) continue;
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children)) continue;
    if (children.length > TASK_FILTER_MAX_GROUP_CHILDREN) return 'children';
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }
  return null;
}

export const taskFilterExpressionSchema = z.strictObject({
  version: z.literal(TASK_FILTER_EXPRESSION_VERSION),
  root: taskFilterNodeSchema,
});
export type TaskFilterExpression = z.infer<typeof taskFilterExpressionSchema>;

export type TaskFilterParseResult =
  | { success: true; data: TaskFilterExpression }
  | { success: false; reason: 'limit'; limit: TaskFilterLimitViolation }
  | { success: false; reason: 'invalid'; error: z.ZodError };

/** 唯一推荐入口：先做迭代式限额检查，再做完整的白名单结构校验。 */
export function parseTaskFilterExpression(input: unknown): TaskFilterParseResult {
  const root =
    typeof input === 'object' && input !== null ? (input as { root?: unknown }).root : undefined;
  const limit = inspectTaskFilterShape(root);
  if (limit) return { success: false, reason: 'limit', limit };
  const parsed = taskFilterExpressionSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, reason: 'invalid', error: parsed.error };
}
