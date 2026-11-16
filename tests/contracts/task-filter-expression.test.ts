import { describe, expect, it } from 'vitest';
import {
  TASK_FILTER_MAX_DEPTH,
  TASK_FILTER_MAX_NODES,
  parseTaskFilterExpression,
  taskListQuerySchema,
} from '../../packages/contracts/src/index';
import {
  matchesTaskFilter,
  validateTaskFilterExpression,
} from '../../packages/application/src/task-filter-expression';

const expr = (root: unknown) => ({ version: 1, root });
const status = (value: string) => ({ field: 'status', op: 'eq', value });
const group = (logic: 'and' | 'or', ...children: unknown[]) => ({ logic, children });
const nested = (depth: number): unknown =>
  depth <= 1 ? status('todo') : group('and', nested(depth - 1));

describe('task filter expression contract', () => {
  it('accepts whitelisted fields, operators and bounded AND/OR groups', () => {
    const result = parseTaskFilterExpression(
      expr(
        group(
          'and',
          { field: 'status', op: 'in', value: ['todo', 'in_progress'] },
          group(
            'or',
            { field: 'priority', op: 'gte', value: 3 },
            { field: 'assignee', op: 'is_empty' },
            { field: 'due_date', op: 'between', value: { from: '2026-11-01', to: '2026-11-30' } },
          ),
        ),
      ),
    );
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields, operators, versions, extra keys and operator/value mismatches', () => {
    for (const root of [
      { field: 'title; DROP TABLE tasks', op: 'eq', value: 'x' },
      { field: 'status', op: "eq' OR '1'='1", value: 'todo' },
      { field: 'status', op: 'eq', value: 'archived' },
      { field: 'status', op: 'eq', value: 'todo', sql: '1=1' },
      { field: 'priority', op: 'gte', value: 9 },
      { field: 'priority', op: 'in', value: [] },
      { field: 'due_date', op: 'before', value: '2026-13-40' },
      { field: 'due_date', op: 'before', value: '0000-01-01' },
      { field: 'due_date', op: 'between', value: { from: '2026-12-01', to: '2026-11-01' } },
      { field: 'due_date', op: 'is_empty', value: '2026-11-01' },
      { field: 'tags', op: 'eq', value: 'x' },
      { field: 'matter_id', op: 'eq', value: 'x' },
      { logic: 'not', children: [status('todo')] },
      { logic: 'and', children: [] },
      { logic: 'and', children: [status('todo')], expression: 'task.status == 1' },
      { $where: 'function(){return true}' },
      '(status = todo)',
      null,
    ]) {
      expect(parseTaskFilterExpression(expr(root)).success, JSON.stringify(root)).toBe(false);
    }
    expect(parseTaskFilterExpression({ version: 2, root: status('todo') }).success).toBe(false);
    expect(parseTaskFilterExpression({ root: status('todo') }).success).toBe(false);
    expect(
      parseTaskFilterExpression({ version: 1, root: status('todo'), scope: 'all' }).success,
    ).toBe(false);
    expect(parseTaskFilterExpression(undefined).success).toBe(false);
  });

  it('rejects control characters in assignee values and treats other text as inert data', () => {
    for (const value of ['a\0b', 'a\nb', '\u007f', '   ']) {
      expect(parseTaskFilterExpression(expr({ field: 'assignee', op: 'eq', value })).success).toBe(
        false,
      );
    }
    const injection = parseTaskFilterExpression(
      expr({ field: 'assignee', op: 'eq', value: "x'; DROP TABLE tasks;--" }),
    );
    expect(injection.success).toBe(true);
    if (injection.success)
      expect(
        matchesTaskFilter(injection.data, { status: 'todo', priority: 0, assignee: 'someone' }),
      ).toBe(false);
  });

  it('enforces depth, node and fan-out limits with a deterministic reason', () => {
    expect(parseTaskFilterExpression(expr(nested(TASK_FILTER_MAX_DEPTH))).success).toBe(true);
    expect(parseTaskFilterExpression(expr(nested(TASK_FILTER_MAX_DEPTH + 1)))).toMatchObject({
      success: false,
      reason: 'limit',
      limit: 'depth',
    });
    expect(
      parseTaskFilterExpression(
        expr(
          group(
            'or',
            ...Array.from({ length: TASK_FILTER_MAX_NODES }, () => group('and', status('todo'))),
          ),
        ),
      ),
    ).toMatchObject({ success: false, reason: 'limit' });
    expect(
      parseTaskFilterExpression(
        expr(group('and', ...Array.from({ length: 11 }, () => status('todo')))),
      ),
    ).toMatchObject({ success: false, reason: 'limit', limit: 'children' });
  });

  it('survives extremely deep input without recursing', () => {
    let root: unknown = status('todo');
    for (let i = 0; i < 100_000; i += 1) root = { logic: 'and', children: [root] };
    expect(parseTaskFilterExpression(expr(root))).toMatchObject({ success: false, limit: 'depth' });
  });

  it('keeps the legacy simple query shape valid and independent of the expression', () => {
    const legacy = {
      scope: { type: 'workspace' },
      text: '',
      status: null,
      priority: null,
      dates: 'all',
      from: null,
      to: null,
      body: 'all',
      sort: 'updated',
      offset: 0,
    };
    expect(taskListQuerySchema.safeParse(legacy).success).toBe(true);
    expect(taskListQuerySchema.safeParse({ ...legacy, filter: expr(status('todo')) }).success).toBe(
      false,
    );
  });
});

describe('task filter expression application', () => {
  const build = (root: unknown) => {
    const result = validateTaskFilterExpression(expr(root));
    if (!result.ok) throw new Error(result.code);
    return result.expression;
  };
  const task = { status: 'todo', priority: 2, assignee: null, due_date: '2026-11-15' };
  const T = { field: 'priority', op: 'eq', value: 2 };
  const F = { field: 'priority', op: 'eq', value: 3 };

  it('evaluates the AND/OR truth table', () => {
    const cases: Array<['and' | 'or', unknown[], boolean]> = [
      ['and', [T, T], true],
      ['and', [T, F], false],
      ['and', [F, F], false],
      ['or', [T, F], true],
      ['or', [F, F], false],
      ['or', [T, T], true],
    ];
    for (const [logic, children, expected] of cases)
      expect(matchesTaskFilter(build(group(logic, ...children)), task)).toBe(expected);
    expect(matchesTaskFilter(build(group('and', T, group('or', F, T))), task)).toBe(true);
    expect(matchesTaskFilter(build(group('and', T, group('or', F, F))), task)).toBe(false);
  });

  it('treats empty values as non-matching for comparisons and explicit for is_empty', () => {
    expect(matchesTaskFilter(build({ field: 'assignee', op: 'is_empty' }), task)).toBe(true);
    expect(matchesTaskFilter(build({ field: 'assignee', op: 'ne', value: 'a' }), task)).toBe(false);
    expect(matchesTaskFilter(build({ field: 'assignee', op: 'eq', value: 'a' }), task)).toBe(false);
    expect(
      matchesTaskFilter(build({ field: 'start_date', op: 'before', value: '2026-12-01' }), task),
    ).toBe(false);
    expect(matchesTaskFilter(build({ field: 'start_date', op: 'is_empty' }), task)).toBe(true);
    expect(matchesTaskFilter(build({ field: 'due_date', op: 'is_not_empty' }), task)).toBe(true);
  });

  it('compares calendar dates inclusively without timezone conversion', () => {
    const d = (op: string, value: unknown) =>
      matchesTaskFilter(build({ field: 'due_date', op, value }), task);
    expect(d('eq', '2026-11-15')).toBe(true);
    expect(d('before', '2026-11-15')).toBe(false);
    expect(d('on_or_before', '2026-11-15')).toBe(true);
    expect(d('after', '2026-11-14')).toBe(true);
    expect(d('on_or_after', '2026-11-16')).toBe(false);
    expect(d('between', { from: '2026-11-15', to: '2026-11-15' })).toBe(true);
    expect(d('between', { from: '2026-11-16', to: '2026-11-20' })).toBe(false);
  });

  it('returns a closed error code instead of degrading to an unfiltered query', () => {
    expect(validateTaskFilterExpression(expr(nested(TASK_FILTER_MAX_DEPTH + 1)))).toEqual({
      ok: false,
      code: 'filter_limit_exceeded',
    });
    expect(validateTaskFilterExpression(expr({ field: 'sql', op: 'eq', value: 1 }))).toEqual({
      ok: false,
      code: 'filter_invalid',
    });
    expect(validateTaskFilterExpression(undefined)).toEqual({ ok: false, code: 'filter_invalid' });
  });
});
