import { z } from 'zod';
import {
  ordinaryDateSchema,
  taskAssigneeSchema,
  taskListQuerySchema,
  taskPrioritySchema,
  taskStatusSchema,
  type TaskListQuery,
} from './task';

/** DEV-1892：有界组合条件合同版本；保存视图 Owner 仍归 DEV-1607，此处仅定义可序列化语义。 */
export const TASK_FILTER_EXPRESSION_PROTOCOL_VERSION = 1 as const;
export const TASK_FILTER_MAX_DEPTH = 3;
export const TASK_FILTER_MAX_NODES = 16;
export const TASK_FILTER_MAX_GROUP_CHILDREN = 8;

export const taskFilterFieldSchema = z.enum([
  'status',
  'priority',
  'assignee',
  'due_date',
  'planned_date',
]);
export type TaskFilterField = z.infer<typeof taskFilterFieldSchema>;

const statusConditionSchema = z
  .strictObject({
    kind: z.literal('condition'),
    field: z.literal('status'),
    operator: z.enum(['eq', 'ne', 'in']),
    value: z.union([taskStatusSchema, z.array(taskStatusSchema).min(1).max(4)]),
  })
  .superRefine((node, ctx) => {
    if (node.operator === 'in' && !Array.isArray(node.value)) {
      ctx.addIssue({ code: 'custom', message: 'in 需要状态数组' });
    }
    if (node.operator !== 'in' && Array.isArray(node.value)) {
      ctx.addIssue({ code: 'custom', message: 'eq/ne 需要单个状态' });
    }
  });

const priorityConditionSchema = z
  .strictObject({
    kind: z.literal('condition'),
    field: z.literal('priority'),
    operator: z.enum(['eq', 'ne', 'in', 'gte', 'lte']),
    value: z.union([taskPrioritySchema, z.array(taskPrioritySchema).min(1).max(5)]),
  })
  .superRefine((node, ctx) => {
    if (node.operator === 'in' && !Array.isArray(node.value)) {
      ctx.addIssue({ code: 'custom', message: 'in 需要优先级数组' });
    }
    if ((node.operator === 'eq' || node.operator === 'ne') && Array.isArray(node.value)) {
      ctx.addIssue({ code: 'custom', message: 'eq/ne 需要单个优先级' });
    }
    if ((node.operator === 'gte' || node.operator === 'lte') && Array.isArray(node.value)) {
      ctx.addIssue({ code: 'custom', message: '比较运算需要单个优先级' });
    }
  });

const assigneeConditionSchema = z
  .strictObject({
    kind: z.literal('condition'),
    field: z.literal('assignee'),
    operator: z.enum(['eq', 'ne', 'is_empty', 'is_not_empty']),
    value: taskAssigneeSchema.optional(),
  })
  .superRefine((node, ctx) => {
    const needsValue = node.operator === 'eq' || node.operator === 'ne';
    const forbidsValue = node.operator === 'is_empty' || node.operator === 'is_not_empty';
    if (needsValue && node.value === undefined) {
      ctx.addIssue({ code: 'custom', message: '负责人条件缺少值' });
    }
    if (forbidsValue && node.value !== undefined) {
      ctx.addIssue({ code: 'custom', message: '空值运算符不接受负责人值' });
    }
  });

const dateConditionSchema = (field: 'due_date' | 'planned_date') =>
  z
    .strictObject({
      kind: z.literal('condition'),
      field: z.literal(field),
      operator: z.enum(['eq', 'ne', 'is_empty', 'is_not_empty', 'gte', 'lte']),
      value: ordinaryDateSchema.optional(),
    })
    .superRefine((node, ctx) => {
      const needsValue =
        node.operator === 'eq' ||
        node.operator === 'ne' ||
        node.operator === 'gte' ||
        node.operator === 'lte';
      const forbidsValue = node.operator === 'is_empty' || node.operator === 'is_not_empty';
      if (needsValue && node.value === undefined) {
        ctx.addIssue({ code: 'custom', message: '日期条件缺少值' });
      }
      if (forbidsValue && node.value !== undefined) {
        ctx.addIssue({ code: 'custom', message: '空值运算符不接受日期值' });
      }
    });

const taskFilterConditionSchema = z.discriminatedUnion('field', [
  statusConditionSchema,
  priorityConditionSchema,
  assigneeConditionSchema,
  dateConditionSchema('due_date'),
  dateConditionSchema('planned_date'),
]);
export type TaskFilterCondition = z.infer<typeof taskFilterConditionSchema>;

export type TaskFilterGroup = {
  kind: 'group';
  logic: 'and' | 'or';
  children: TaskFilterExpression[];
};

export type TaskFilterExpression = TaskFilterCondition | TaskFilterGroup;

export const taskFilterExpressionSchema: z.ZodType<TaskFilterExpression> = z.lazy(() =>
  z.union([
    z.strictObject({
      kind: z.literal('group'),
      logic: z.enum(['and', 'or']),
      children: z.array(taskFilterExpressionSchema).min(1).max(TASK_FILTER_MAX_GROUP_CHILDREN),
    }),
    taskFilterConditionSchema,
  ]),
);

export const taskFilterExpressionEnvelopeSchema = z.strictObject({
  protocol_version: z.literal(TASK_FILTER_EXPRESSION_PROTOCOL_VERSION),
  root: taskFilterExpressionSchema,
});
export type TaskFilterExpressionEnvelope = z.infer<typeof taskFilterExpressionEnvelopeSchema>;

/** 与 taskListQuery 并行的可选表达式挂载点；范围/分页仍由 TaskListQuery 其它字段限定，表达式不扩大 scope。 */
export const taskListQueryWithFilterSchema = taskListQuerySchema.safeExtend({
  filter_expression: taskFilterExpressionEnvelopeSchema.optional(),
});
export type TaskListQueryWithFilter = z.infer<typeof taskListQueryWithFilterSchema>;

export function stripTaskListFilterExpression(query: TaskListQueryWithFilter): TaskListQuery {
  const { filter_expression: _removed, ...base } = query;
  void _removed;
  return base;
}
