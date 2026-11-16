import { expect, it } from 'vitest';
import {
  parseTaskFilterExpression,
  taskFilterExpressionSchema,
  taskListQuerySchema,
  TASK_FILTER_MAX_CHILDREN,
  TASK_FILTER_MAX_DEPTH,
  TASK_FILTER_MAX_NODES,
  type TaskListQuery,
} from '@caselite/contracts';
import {
  acceptTaskFilterExpression,
  expressionForTaskListQuery,
  filterSnapshotsInOrder,
  filterTruth,
  restoreTaskListFilter,
  taskMatchesFilter,
} from '@caselite/application';

const query = {
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
} satisfies TaskListQuery;

function expression(node: unknown, version: unknown = 1) {
  return { version, node };
}

function condition(field: string, op: string, value?: unknown) {
  return value === undefined
    ? { kind: 'condition', field, op }
    : { kind: 'condition', field, op, value };
}

function nest(depth: number) {
  let node: unknown = condition('status', 'eq', 'todo');
  for (let index = 0; index < depth; index += 1) node = { kind: 'group', op: 'and', items: [node] };
  return expression(node);
}

it('accepts whitelist fields and operators and evaluates AND, OR, null, and unknown', () => {
  const and = expression({
    kind: 'group',
    op: 'and',
    items: [condition('status', 'eq', 'todo'), condition('priority', 'eq', 1)],
  });
  expect(parseTaskFilterExpression(and).ok).toBe(true);
  expect(taskFilterExpressionSchema.safeParse(and).success).toBe(true);
  expect(acceptTaskFilterExpression(and).ok).toBe(true);
  expect(filterTruth(and, { status: 'todo', priority: 1 })).toBe('true');
  expect(filterTruth(and, { status: 'done', priority: 1 })).toBe('false');
  expect(filterTruth(and, { status: 'todo' })).toBe('unknown');
  expect(filterTruth(and, { status: 'done' })).toBe('false');
  expect(filterTruth(and, {})).toBe('unknown');
  expect(taskMatchesFilter(and, { status: 'todo' })).toBe(false);

  const or = expression({
    kind: 'group',
    op: 'or',
    items: [condition('status', 'eq', 'todo'), condition('priority', 'eq', 1)],
  });
  expect(filterTruth(or, { status: 'done', priority: 1 })).toBe('true');
  expect(filterTruth(or, { status: 'done', priority: 2 })).toBe('false');
  expect(filterTruth(or, { priority: 2 })).toBe('unknown');
  expect(filterTruth(or, { status: 'done' })).toBe('unknown');

  expect(filterTruth(expression(condition('assignee', 'is_null')), { assignee: null })).toBe(
    'true',
  );
  expect(filterTruth(expression(condition('assignee', 'eq', "O'Brien")), { assignee: null })).toBe(
    'false',
  );
  expect(filterTruth(expression(condition('assignee', 'neq', "O'Brien")), { assignee: null })).toBe(
    'true',
  );
  expect(filterTruth(expression(condition('assignee', 'eq', "O'Brien")), {})).toBe('unknown');
  expect(filterTruth(expression(condition('status', 'neq', 'done')), { status: null })).toBe(
    'unknown',
  );
  expect(
    filterTruth(expression(condition('status', 'not_in', ['done', 'canceled'])), {
      status: 'todo',
    }),
  ).toBe('true');
  expect(filterTruth(expression(condition('priority', 'lt', 2)), { priority: 1 })).toBe('true');
  expect(filterTruth(expression(condition('priority', 'in', [1, 2])), { priority: 0 })).toBe(
    'false',
  );
  expect(
    filterTruth(expression(condition('start_date', 'eq', '2026-04-01')), {
      start_date: '2026-04-01',
    }),
  ).toBe('true');
});

it('compares ordinary dates as calendar literals and rejects offsets', () => {
  const before = expression(condition('due_date', 'before', '2026-03-01'));
  expect(filterTruth(before, { due_date: '2026-02-28' })).toBe('true');
  expect(filterTruth(before, { due_date: '2026-03-01' })).toBe('false');
  expect(filterTruth(before, { due_date: '2026-10-02' })).toBe('false');
  expect(filterTruth(before, { due_date: null })).toBe('false');
  expect(filterTruth(before, {})).toBe('unknown');
  expect(filterTruth(expression(condition('due_date', 'is_null')), { due_date: null })).toBe(
    'true',
  );
  expect(
    filterTruth(expression(condition('due_date', 'on_or_after', '2026-03-01')), {
      due_date: '2026-03-01',
    }),
  ).toBe('true');
  for (const value of ['2026-03-01T00:00:00+08:00', '2026-02-30', '2026-03-01Z'])
    expect(parseTaskFilterExpression(expression(condition('due_date', 'eq', value))).ok).toBe(
      false,
    );
  expect(
    parseTaskFilterExpression({
      version: 1,
      node: { ...condition('due_date', 'eq', '2026-03-01'), timezone: 'Asia/Shanghai' },
    }),
  ).toMatchObject({ ok: false, reason: 'invalid_shape' });
});

it('rejects SQL, script, unknown fields, scope widening, and query controls', () => {
  expect(
    parseTaskFilterExpression(expression(condition('status; DROP TABLE tasks', 'eq', 'todo'))),
  ).toMatchObject({ ok: false, code: 'INVALID_FILTER', reason: 'injection' });
  expect(
    parseTaskFilterExpression(expression(condition('status', 'eq OR 1=1', 'todo'))),
  ).toMatchObject({ ok: false, reason: 'injection' });
  expect(
    parseTaskFilterExpression(
      expression(condition('assignee', 'eq', "Robert'); DROP TABLE tasks;--")),
    ),
  ).toMatchObject({ ok: false, reason: 'injection' });
  expect(
    parseTaskFilterExpression(expression(condition('assignee', 'eq', '<script>alert(1)</script>'))),
  ).toMatchObject({ ok: false, reason: 'injection' });
  expect(
    parseTaskFilterExpression(expression({ kind: 'all', sql: 'SELECT * FROM task_items' })),
  ).toMatchObject({ ok: false, reason: 'injection' });
  expect(
    parseTaskFilterExpression(
      expression({ kind: 'condition', field: 'status', op: 'eq', value: 'todo', script: '1' }),
    ),
  ).toMatchObject({ ok: false, reason: 'injection' });
  expect(
    parseTaskFilterExpression(expression({ kind: 'all', scope: { type: 'workspace' } })),
  ).toMatchObject({ ok: false, reason: 'scope_widening' });
  expect(
    parseTaskFilterExpression(expression({ kind: 'all', sort: 'title', offset: 0 })),
  ).toMatchObject({ ok: false, reason: 'query_control' });
  expect(parseTaskFilterExpression(expression(condition('tags', 'eq', 'x')))).toMatchObject({
    ok: false,
    reason: 'unknown_field',
  });
  expect(parseTaskFilterExpression(expression(condition('status', 'lt', 'todo')))).toMatchObject({
    ok: false,
    reason: 'unknown_operator',
  });
  expect(parseTaskFilterExpression(expression(condition('status', 'like', 'todo')))).toMatchObject({
    ok: false,
    reason: 'unknown_operator',
  });
  const poisoned = JSON.parse('{"version":1,"node":{"kind":"all","__proto__":{"admin":true}}}');
  expect(parseTaskFilterExpression(poisoned)).toMatchObject({ ok: false, reason: 'injection' });
  expect(filterTruth(poisoned, { status: 'todo' })).toBe('unknown');
  expect(
    taskListQuerySchema.safeParse({ ...query, expression: expression({ kind: 'all' }) }).success,
  ).toBe(false);
});

it('rejects over-depth, too many nodes, empty groups, and cycles before evaluation', () => {
  expect(parseTaskFilterExpression(nest(TASK_FILTER_MAX_DEPTH)).ok).toBe(true);
  expect(parseTaskFilterExpression(nest(TASK_FILTER_MAX_DEPTH + 1))).toMatchObject({
    ok: false,
    reason: 'over_depth',
  });
  const children = (count: number) =>
    expression({
      kind: 'group',
      op: 'or',
      items: Array.from({ length: count }, () => condition('status', 'eq', 'todo')),
    });
  expect(parseTaskFilterExpression(children(TASK_FILTER_MAX_CHILDREN)).ok).toBe(true);
  expect(parseTaskFilterExpression(children(TASK_FILTER_MAX_CHILDREN + 1))).toMatchObject({
    ok: false,
    reason: 'too_many_children',
  });
  const full = expression({
    kind: 'group',
    op: 'and',
    items: [
      ...Array.from({ length: 7 }, () => condition('priority', 'eq', 1)),
      {
        kind: 'group',
        op: 'or',
        items: Array.from({ length: 7 }, () => condition('status', 'eq', 'done')),
      },
    ],
  });
  expect(parseTaskFilterExpression(full).ok).toBe(true);
  const overflow = expression({
    kind: 'group',
    op: 'and',
    items: [
      ...Array.from({ length: 7 }, () => condition('priority', 'eq', 1)),
      {
        kind: 'group',
        op: 'or',
        items: Array.from({ length: 8 }, () => condition('status', 'eq', 'done')),
      },
    ],
  });
  expect(parseTaskFilterExpression(overflow)).toMatchObject({
    ok: false,
    reason: 'too_many_nodes',
  });
  expect(TASK_FILTER_MAX_NODES).toBe(16);
  expect(
    parseTaskFilterExpression(expression({ kind: 'group', op: 'and', items: [] })),
  ).toMatchObject({ ok: false, reason: 'empty_group' });
  expect(
    parseTaskFilterExpression(expression({ kind: 'group', op: 'and', items: [{ kind: 'all' }] })),
  ).toMatchObject({ ok: false, reason: 'nested_all' });
  const cyclic: { kind: 'group'; op: 'and'; items: unknown[] } = {
    kind: 'group',
    op: 'and',
    items: [],
  };
  cyclic.items.push(cyclic);
  expect(parseTaskFilterExpression(expression(cyclic))).toMatchObject({
    ok: false,
    reason: 'invalid_shape',
  });
  expect(parseTaskFilterExpression({ node: { kind: 'all' } })).toMatchObject({
    ok: false,
    reason: 'invalid_shape',
  });
  expect(parseTaskFilterExpression(expression({ kind: 'all' }, 2))).toMatchObject({
    ok: false,
    reason: 'unsupported_version',
  });
});

it('round-trips simple list filters and degrades expressions a saved view cannot own', () => {
  const stored = {
    ...query,
    scope: { type: 'project', id: '11111111-1111-4111-8111-111111111111' },
    status: 'todo',
    priority: 2,
    assignee: "O'Brien",
    dates: 'dated',
    from: '2026-03-01',
    to: '2026-03-31',
    sort: 'due_date',
    offset: 40,
  } satisfies TaskListQuery;
  const projected = expressionForTaskListQuery(stored);
  expect(projected.ok).toBe(true);
  if (!projected.ok) return;
  const restored = restoreTaskListFilter(stored, projected.expression);
  expect(restored).toMatchObject({
    ok: true,
    degraded: false,
    query: stored,
    expression: projected.expression,
  });
  expect(
    taskMatchesFilter(projected.expression, {
      status: 'todo',
      priority: 2,
      assignee: "O'Brien",
      due_date: '2026-03-15',
    }),
  ).toBe(true);
  expect(
    taskMatchesFilter(projected.expression, {
      status: 'todo',
      priority: 2,
      assignee: "O'Brien",
      due_date: null,
    }),
  ).toBe(false);

  const rich = expression({
    kind: 'group',
    op: 'or',
    items: [condition('status', 'eq', 'todo'), condition('status', 'eq', 'done')],
  });
  expect(restoreTaskListFilter(stored, rich)).toMatchObject({
    ok: true,
    degraded: true,
    reason: 'unsupported_combination',
    query: stored,
    expression: projected.expression,
  });
  expect(
    restoreTaskListFilter(stored, expression(condition('status', 'eq', 'done'))),
  ).toMatchObject({
    ok: true,
    degraded: true,
    reason: 'expression_conflict',
    query: stored,
  });
  expect(
    restoreTaskListFilter(stored, expression(condition('assignee', 'eq', '<script>'))),
  ).toMatchObject({
    ok: true,
    degraded: true,
    reason: 'injection',
    query: stored,
    expression: projected.expression,
  });
  expect(restoreTaskListFilter(stored, expression({ kind: 'all' }, 0))).toMatchObject({
    ok: true,
    degraded: true,
    reason: 'unsupported_version',
    query: stored,
  });
  expect(restoreTaskListFilter({ ...stored, sort: 'SQL' })).toMatchObject({
    ok: false,
    reason: 'invalid_value',
  });
  expect(expressionForTaskListQuery({ ...query, assignee: 'Union' })).toMatchObject({
    ok: false,
    reason: 'injection',
  });

  const rows = [
    { id: 'later', status: 'done' as const },
    { id: 'first', status: 'todo' as const },
    { id: 'second', status: 'todo' as const },
  ];
  const matched = filterSnapshotsInOrder(expression(condition('status', 'eq', 'todo')), rows);
  expect(matched).toEqual({ ok: true, matches: [rows[1], rows[2]] });
  expect(filterSnapshotsInOrder(rich, rows)).toEqual({ ok: true, matches: rows });
  expect(filterSnapshotsInOrder(expression({ kind: 'all' }), rows)).toEqual({
    ok: true,
    matches: rows,
  });
  expect(filterSnapshotsInOrder(expression(condition('status', 'eq', 'todo')), null)).toMatchObject(
    {
      ok: false,
      reason: 'invalid_shape',
    },
  );
});
