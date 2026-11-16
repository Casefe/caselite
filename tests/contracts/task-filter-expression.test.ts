import { describe, expect, it } from 'vitest';
import { taskListQuerySchema } from '../../packages/contracts/src/task';
import {
  TASK_FILTER_EXPRESSION_PROTOCOL_VERSION,
  taskFilterExpressionEnvelopeSchema,
  taskListQueryWithFilterSchema,
  stripTaskListFilterExpression,
} from '../../packages/contracts/src/task-filter-expression';

const baseQuery = {
  scope: { type: 'workspace' as const },
  text: '',
  status: null,
  priority: null,
  dates: 'all' as const,
  from: null,
  to: null,
  body: 'all' as const,
  sort: 'updated' as const,
  offset: 0,
};

describe('DEV-1892 bounded task filter expression contract', () => {
  it('keeps legacy task list queries valid while optionally attaching filter_expression', () => {
    expect(taskListQuerySchema.parse(baseQuery)).toEqual(baseQuery);
    const withFilter = taskListQueryWithFilterSchema.parse({
      ...baseQuery,
      filter_expression: {
        protocol_version: TASK_FILTER_EXPRESSION_PROTOCOL_VERSION,
        root: { kind: 'condition', field: 'status', operator: 'eq', value: 'todo' },
      },
    });
    expect(stripTaskListFilterExpression(withFilter)).toEqual(baseQuery);
  });

  it.each([
    { field: 'status', operator: 'eq', value: 'hacked' },
    { field: 'priority', operator: 'gte', value: -1 },
    { field: 'assignee', operator: 'eq' },
    { field: 'due_date', operator: 'gte', value: '2026-13-40' },
    { field: 'planned_date', operator: 'is_not_empty', value: '2026-01-01' },
    { kind: 'group', logic: 'xor', children: [] },
    { kind: 'condition', field: 'status', operator: 'exec', value: 'todo' },
  ])('rejects unknown operators, values or privileged fields: %j', (root) => {
    expect(
      taskFilterExpressionEnvelopeSchema.safeParse({
        protocol_version: TASK_FILTER_EXPRESSION_PROTOCOL_VERSION,
        root,
      }).success,
    ).toBe(false);
  });
});
