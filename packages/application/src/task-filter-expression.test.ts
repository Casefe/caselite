import { describe, expect, it } from 'vitest';
import {
  TASK_FILTER_EXPRESSION_PROTOCOL_VERSION,
  type TaskFilterExpressionEnvelope,
} from '@caselite/contracts';
import {
  evaluateTaskFilterExpression,
  validateTaskFilterExpression,
} from './task-filter-expression';

const envelope = (root: TaskFilterExpressionEnvelope['root']): TaskFilterExpressionEnvelope => ({
  protocol_version: TASK_FILTER_EXPRESSION_PROTOCOL_VERSION,
  root,
});

const subject = {
  status: 'in_progress' as const,
  priority: 2,
  assignee: '王律师',
  due_date: '2026-12-01',
  planned_date: null,
};

describe('DEV-1892 task filter expression application', () => {
  it('evaluates AND/OR truth tables and empty assignee', () => {
    const valid = validateTaskFilterExpression(
      envelope({
        kind: 'group',
        logic: 'and',
        children: [
          { kind: 'condition', field: 'status', operator: 'eq', value: 'in_progress' },
          {
            kind: 'group',
            logic: 'or',
            children: [
              { kind: 'condition', field: 'priority', operator: 'gte', value: 2 },
              { kind: 'condition', field: 'assignee', operator: 'is_empty' },
            ],
          },
        ],
      }),
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(evaluateTaskFilterExpression(valid.expression, subject)).toBe(true);
    expect(evaluateTaskFilterExpression(valid.expression, { ...subject, status: 'todo' })).toBe(
      false,
    );
    expect(
      evaluateTaskFilterExpression(valid.expression, {
        ...subject,
        priority: 0,
        assignee: null,
      }),
    ).toBe(true);
  });

  it.each([
    {
      root: {
        kind: 'group',
        logic: 'and',
        children: [
          {
            kind: 'group',
            logic: 'and',
            children: [
              {
                kind: 'group',
                logic: 'and',
                children: [{ kind: 'condition', field: 'status', operator: 'eq', value: 'todo' }],
              },
            ],
          },
        ],
      },
      reason: 'depth',
    },
    {
      root: {
        kind: 'group',
        logic: 'or',
        children: Array.from({ length: 17 }, () => ({
          kind: 'condition' as const,
          field: 'status' as const,
          operator: 'eq' as const,
          value: 'todo' as const,
        })),
      },
      reason: 'nodes',
    },
    {
      protocol_version: 2,
      root: { kind: 'condition', field: 'status', operator: 'eq', value: 'todo' },
    },
    {
      root: {
        kind: 'condition',
        field: 'assignee',
        operator: 'eq',
        value: "王律师'; DROP TABLE tasks;--",
      },
    },
    { sql: 'SELECT *', protocol_version: TASK_FILTER_EXPRESSION_PROTOCOL_VERSION },
    {
      root: {
        kind: 'condition',
        field: 'due_date',
        operator: 'eq',
        value: undefined,
      },
    },
  ])('rejects unsafe or over-limit expression: %#', (input) => {
    const result = validateTaskFilterExpression(
      'protocol_version' in input && input.protocol_version === 2
        ? input
        : 'sql' in input
          ? input
          : envelope(input.root as TaskFilterExpressionEnvelope['root']),
    );
    expect(result).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('treats unknown due dates as empty only for empty operators', () => {
    const parsed = validateTaskFilterExpression(
      envelope({ kind: 'condition', field: 'due_date', operator: 'is_empty' }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(evaluateTaskFilterExpression(parsed.expression, { ...subject, due_date: null })).toBe(
      true,
    );
    expect(evaluateTaskFilterExpression(parsed.expression, subject)).toBe(false);
  });
});
