import {
  ordinaryDateSchema,
  parseTaskFilterExpression,
  taskAssigneeNameSchema,
  taskFilterBounds,
  taskFilterExpressionSchema,
  taskListQuerySchema,
  taskPrioritySchema,
  taskStatusSchema,
  TASK_FILTER_MAX_CHILDREN,
  TASK_FILTER_MAX_DEPTH,
  TASK_FILTER_MAX_NODES,
  TASK_FILTER_REASON_MESSAGE,
  type TaskFilterCondition,
  type TaskFilterExpression,
  type TaskFilterNode,
  type TaskFilterParseResult,
  type TaskFilterReason,
  type TaskListQuery,
  type TaskStatus,
} from '@caselite/contracts';

/**
 * 表达式只在调用方已持有的字段快照上求值，不拼 SQL、不访问数据库。
 * 工作区和项目范围仍由 TaskListQuery 单独传入。保存视图归 DEV-1607；
 * 无法还原或被拒绝的表达式退回原查询，不覆盖已保存筛选。
 */
export type FilterTruth = 'true' | 'false' | 'unknown';

export interface TaskFilterSnapshot {
  status?: TaskStatus | null;
  priority?: number | null;
  assignee?: string | null;
  due_date?: string | null;
  start_date?: string | null;
}

export type TaskFilterViewReason =
  TaskFilterReason | 'unsupported_combination' | 'expression_conflict';

export type TaskListFilterRestore =
  | {
      ok: true;
      degraded: false;
      expression: TaskFilterExpression;
      query: TaskListQuery;
    }
  | {
      ok: true;
      degraded: true;
      reason: TaskFilterViewReason;
      message: string;
      expression: TaskFilterExpression;
      query: TaskListQuery;
    }
  | TaskFilterFailure;

const VIEW_MESSAGE: Record<'unsupported_combination' | 'expression_conflict', string> = {
  unsupported_combination: '该条件组合不能还原为当前保存视图，已退回原筛选。',
  expression_conflict: '表达式与已保存筛选不一致，已保留原筛选。',
};

type TaskFilterFailure = Extract<TaskFilterParseResult, { ok: false }>;

function fail(reason: TaskFilterReason): TaskFilterFailure {
  return {
    ok: false,
    code: 'INVALID_FILTER',
    reason,
    message: TASK_FILTER_REASON_MESSAGE[reason],
  };
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 合同解析之后再做一次 Zod 与深度/数量复核，失败时不返回可执行表达式。 */
export function acceptTaskFilterExpression(input: unknown): TaskFilterParseResult {
  const parsed = parseTaskFilterExpression(input);
  if (!parsed.ok) return parsed;
  const again = taskFilterExpressionSchema.safeParse(parsed.expression);
  if (!again.success) return fail('invalid_value');
  const bounds = taskFilterBounds(parsed.expression.node);
  if (bounds.nestedAll) return fail('nested_all');
  if (bounds.groupDepth > TASK_FILTER_MAX_DEPTH) return fail('over_depth');
  if (bounds.nodes > TASK_FILTER_MAX_NODES) return fail('too_many_nodes');
  if (bounds.maxChildren > TASK_FILTER_MAX_CHILDREN) return fail('too_many_children');
  return { ok: true, expression: parsed.expression };
}

function knownStatus(value: TaskStatus | null | undefined): TaskStatus | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = taskStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function knownPriority(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = taskPrioritySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function knownAssignee(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = taskAssigneeNameSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function knownDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = ordinaryDateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function listed<T>(value: T, expected: readonly T[], negate: boolean): FilterTruth {
  const found = expected.includes(value);
  return (negate ? !found : found) ? 'true' : 'false';
}

function compareDate(
  actual: string,
  op: 'eq' | 'before' | 'after' | 'on_or_before' | 'on_or_after',
  expected: string,
): boolean {
  // 普通日期是零填充的日历字面量。字典序与日历顺序一致，不解析时区或时刻。
  if (op === 'eq') return actual === expected;
  if (op === 'before') return actual < expected;
  if (op === 'after') return actual > expected;
  if (op === 'on_or_before') return actual <= expected;
  return actual >= expected;
}

function conditionTruth(condition: TaskFilterCondition, snapshot: TaskFilterSnapshot): FilterTruth {
  if (condition.field === 'status') {
    const actual = knownStatus(snapshot.status);
    if (actual === undefined) return 'unknown';
    if (Array.isArray(condition.value))
      return listed(actual, condition.value, condition.op === 'not_in');
    return (condition.op === 'neq' ? actual !== condition.value : actual === condition.value)
      ? 'true'
      : 'false';
  }
  if (condition.field === 'priority') {
    const actual = knownPriority(snapshot.priority);
    if (actual === undefined) return 'unknown';
    if (Array.isArray(condition.value))
      return listed(actual, condition.value, condition.op === 'not_in');
    if (condition.op === 'lt') return actual < condition.value ? 'true' : 'false';
    if (condition.op === 'gt') return actual > condition.value ? 'true' : 'false';
    return (condition.op === 'neq' ? actual !== condition.value : actual === condition.value)
      ? 'true'
      : 'false';
  }
  if (condition.field === 'assignee') {
    const actual = knownAssignee(snapshot.assignee);
    if (actual === undefined) return 'unknown';
    if (!('value' in condition)) {
      return condition.op === 'is_null'
        ? actual === null
          ? 'true'
          : 'false'
        : actual === null
          ? 'false'
          : 'true';
    }
    if (actual === null) return condition.op === 'neq' ? 'true' : 'false';
    return (condition.op === 'eq' ? actual === condition.value : actual !== condition.value)
      ? 'true'
      : 'false';
  }
  const actual = knownDate(snapshot[condition.field]);
  if (actual === undefined) return 'unknown';
  if (!('value' in condition)) {
    return condition.op === 'is_null'
      ? actual === null
        ? 'true'
        : 'false'
      : actual === null
        ? 'false'
        : 'true';
  }
  if (actual === null) return 'false';
  return compareDate(actual, condition.op, condition.value) ? 'true' : 'false';
}

function combine(op: 'and' | 'or', truths: readonly FilterTruth[]): FilterTruth {
  if (op === 'and') {
    if (truths.some((truth) => truth === 'false')) return 'false';
    if (truths.some((truth) => truth === 'unknown')) return 'unknown';
    return 'true';
  }
  if (truths.some((truth) => truth === 'true')) return 'true';
  if (truths.some((truth) => truth === 'unknown')) return 'unknown';
  return 'false';
}

function evaluate(node: TaskFilterNode, snapshot: TaskFilterSnapshot): FilterTruth {
  if (node.kind === 'all') return 'true';
  if (node.kind === 'condition') return conditionTruth(node, snapshot);
  return combine(
    node.op,
    node.items.map((item) => evaluate(item, snapshot)),
  );
}

function readSnapshot(input: unknown): TaskFilterSnapshot | null {
  if (!isPlain(input)) return null;
  const snapshot: TaskFilterSnapshot = {};
  for (const field of ['status', 'priority', 'assignee', 'due_date', 'start_date'] as const) {
    if (Object.hasOwn(input, field)) snapshot[field] = input[field] as never;
  }
  return snapshot;
}

/** 非法表达式或无法读取的快照按未知处理，未知不会被当成匹配。 */
export function filterTruth(expression: unknown, snapshot: unknown): FilterTruth {
  const accepted = acceptTaskFilterExpression(expression);
  const row = readSnapshot(snapshot);
  if (!accepted.ok || !row) return 'unknown';
  return evaluate(accepted.expression.node, row);
}

export function taskMatchesFilter(expression: unknown, snapshot: unknown): boolean {
  return filterTruth(expression, snapshot) === 'true';
}

export function filterSnapshotsInOrder<T extends TaskFilterSnapshot>(
  expression: unknown,
  rows: readonly T[],
): { ok: true; matches: T[] } | TaskFilterFailure {
  if (!Array.isArray(rows) || rows.some((row) => !isPlain(row))) return fail('invalid_shape');
  const accepted = acceptTaskFilterExpression(expression);
  if (!accepted.ok) return accepted;
  return {
    ok: true,
    matches: rows.filter((row) => evaluate(accepted.expression.node, row) === 'true'),
  };
}

interface SimpleFields {
  status: TaskStatus | null;
  priority: number | null;
  assignee: string | null | undefined;
  dates: 'all' | 'dated' | 'undated';
  from: string | null;
  to: string | null;
}

function simpleFromQuery(query: TaskListQuery): SimpleFields {
  return {
    status: query.status,
    priority: query.priority,
    assignee: query.assignee,
    dates: query.dates,
    from: query.from,
    to: query.to,
  };
}

function sameSimple(left: SimpleFields, right: SimpleFields): boolean {
  return (
    left.status === right.status &&
    left.priority === right.priority &&
    left.dates === right.dates &&
    left.from === right.from &&
    left.to === right.to &&
    left.assignee === right.assignee
  );
}

function buildExpression(simple: SimpleFields): TaskFilterExpression {
  const items: TaskFilterCondition[] = [];
  if (simple.status !== null)
    items.push({ kind: 'condition', field: 'status', op: 'eq', value: simple.status });
  if (simple.priority !== null)
    items.push({ kind: 'condition', field: 'priority', op: 'eq', value: simple.priority });
  if (simple.assignee !== undefined) {
    items.push(
      simple.assignee === null
        ? { kind: 'condition', field: 'assignee', op: 'is_null' }
        : { kind: 'condition', field: 'assignee', op: 'eq', value: simple.assignee },
    );
  }
  if (simple.dates === 'undated')
    items.push({ kind: 'condition', field: 'due_date', op: 'is_null' });
  if (simple.dates === 'dated')
    items.push({ kind: 'condition', field: 'due_date', op: 'is_not_null' });
  if (simple.from)
    items.push({
      kind: 'condition',
      field: 'due_date',
      op: 'on_or_after',
      value: simple.from,
    });
  if (simple.to)
    items.push({ kind: 'condition', field: 'due_date', op: 'on_or_before', value: simple.to });
  const [only] = items;
  if (items.length === 0) return { version: 1, node: { kind: 'all' } };
  if (items.length === 1 && only) return { version: 1, node: only };
  return { version: 1, node: { kind: 'group', op: 'and', items } };
}

function projectSimple(node: TaskFilterNode): SimpleFields | null {
  if (node.kind === 'all') {
    return {
      status: null,
      priority: null,
      assignee: undefined,
      dates: 'all',
      from: null,
      to: null,
    };
  }
  const conditions =
    node.kind === 'condition'
      ? [node]
      : node.op === 'and' && node.items.every((item) => item.kind === 'condition')
        ? node.items
        : null;
  if (!conditions) return null;
  const simple: SimpleFields = {
    status: null,
    priority: null,
    assignee: undefined,
    dates: 'all',
    from: null,
    to: null,
  };
  let assigneeSet = false;
  for (const condition of conditions) {
    if (condition.field === 'status' && condition.op === 'eq') {
      if (simple.status !== null) return null;
      simple.status = condition.value;
      continue;
    }
    if (condition.field === 'priority' && condition.op === 'eq') {
      if (simple.priority !== null) return null;
      simple.priority = condition.value;
      continue;
    }
    if (condition.field === 'assignee' && condition.op === 'eq') {
      if (assigneeSet) return null;
      assigneeSet = true;
      simple.assignee = condition.value;
      continue;
    }
    if (condition.field === 'assignee' && condition.op === 'is_null') {
      if (assigneeSet) return null;
      assigneeSet = true;
      simple.assignee = null;
      continue;
    }
    if (condition.field === 'due_date' && condition.op === 'is_null') {
      if (simple.dates !== 'all' || simple.from || simple.to) return null;
      simple.dates = 'undated';
      continue;
    }
    if (condition.field === 'due_date' && condition.op === 'is_not_null') {
      if (simple.dates !== 'all') return null;
      simple.dates = 'dated';
      continue;
    }
    if (condition.field === 'due_date' && condition.op === 'on_or_after') {
      if (simple.dates === 'undated' || simple.from) return null;
      simple.from = condition.value;
      continue;
    }
    if (condition.field === 'due_date' && condition.op === 'on_or_before') {
      if (simple.dates === 'undated' || simple.to) return null;
      simple.to = condition.value;
      continue;
    }
    return null;
  }
  if (simple.from && simple.to && simple.from > simple.to) return null;
  return simple;
}

export function expressionForTaskListQuery(query: TaskListQuery): TaskFilterParseResult {
  return acceptTaskFilterExpression(buildExpression(simpleFromQuery(query)));
}

/**
 * 原查询是视图语义的所有者。表达式只有在能投影成同一组白名单字段时才视为未降级；
 * 超深、注入、版本不符或更丰富的组合都退回原查询，且不改 scope、排序和分页。
 */
export function restoreTaskListFilter(
  queryInput: unknown,
  expressionInput?: unknown,
): TaskListFilterRestore {
  const queryParsed = taskListQuerySchema.safeParse(queryInput);
  if (!queryParsed.success) return fail('invalid_value');
  const query = queryParsed.data;
  const built = expressionForTaskListQuery(query);
  if (!built.ok) return built;
  const expression = built.expression;
  if (expressionInput === undefined) return { ok: true, degraded: false, expression, query };
  const accepted = acceptTaskFilterExpression(expressionInput);
  if (!accepted.ok) {
    return {
      ok: true,
      degraded: true,
      reason: accepted.reason,
      message: accepted.message,
      expression,
      query,
    };
  }
  const projected = projectSimple(accepted.expression.node);
  if (!projected) {
    return {
      ok: true,
      degraded: true,
      reason: 'unsupported_combination',
      message: VIEW_MESSAGE.unsupported_combination,
      expression,
      query,
    };
  }
  if (!sameSimple(projected, simpleFromQuery(query))) {
    return {
      ok: true,
      degraded: true,
      reason: 'expression_conflict',
      message: VIEW_MESSAGE.expression_conflict,
      expression,
      query,
    };
  }
  return { ok: true, degraded: false, expression, query };
}
