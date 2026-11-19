import { z } from 'zod';
import {
  ordinaryDateSchema,
  taskAssigneeNameSchema,
  taskPrioritySchema,
  taskStatusSchema,
  type TaskStatus,
} from './task';

/**
 * 有界任务筛选表达式（DEV-1892）。
 * 只描述状态、优先级、负责人、普通日期的白名单比较；范围、排序和分页仍由 TaskListQuery 持有。
 * 保存视图的持久化归 DEV-1607，这里不新增存储。表达式不是 SQL，也不被当作脚本执行。
 */
export const TASK_FILTER_EXPRESSION_VERSION = 1;
export const TASK_FILTER_MAX_DEPTH = 3;
export const TASK_FILTER_MAX_NODES = 16;
export const TASK_FILTER_MAX_CHILDREN = 8;

export const TASK_FILTER_FIELDS = [
  'status',
  'priority',
  'assignee',
  'due_date',
  'start_date',
] as const;
export type TaskFilterField = (typeof TASK_FILTER_FIELDS)[number];

const STATUS_OPS = ['eq', 'neq', 'in', 'not_in'] as const;
const PRIORITY_OPS = ['eq', 'neq', 'in', 'not_in', 'lt', 'gt'] as const;
const ASSIGNEE_OPS = ['eq', 'neq', 'is_null', 'is_not_null'] as const;
const DATE_OPS = [
  'eq',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'is_null',
  'is_not_null',
] as const;
const GROUP_OPS = ['and', 'or'] as const;

const FIELD_OPS: Record<TaskFilterField, readonly string[]> = {
  status: STATUS_OPS,
  priority: PRIORITY_OPS,
  assignee: ASSIGNEE_OPS,
  due_date: DATE_OPS,
  start_date: DATE_OPS,
};

export type TaskFilterReason =
  | 'invalid_shape'
  | 'unsupported_version'
  | 'unknown_field'
  | 'unknown_operator'
  | 'invalid_value'
  | 'injection'
  | 'scope_widening'
  | 'query_control'
  | 'over_depth'
  | 'too_many_nodes'
  | 'too_many_children'
  | 'empty_group'
  | 'nested_all';

export const TASK_FILTER_REASON_MESSAGE: Record<TaskFilterReason, string> = {
  invalid_shape: '筛选表达式结构无效。',
  unsupported_version: '筛选表达式版本不受支持，已不能执行。',
  unknown_field: '筛选字段不在允许范围内。',
  unknown_operator: '该字段不允许使用这个运算符。',
  invalid_value: '筛选值无效。',
  injection: '筛选条件包含不允许的脚本或数据库文本。',
  scope_widening: '筛选表达式不能改变工作区或项目范围。',
  query_control: '排序、分页和全文条件不能写进筛选表达式。',
  over_depth: '条件嵌套超过允许深度。',
  too_many_nodes: '筛选条件数量超过上限。',
  too_many_children: '同一组内的条件数量超过上限。',
  empty_group: '条件组不能为空。',
  nested_all: '“全部匹配”只能作为整个表达式的根。',
};

const SCOPE_KEYS = new Set([
  'scope',
  'workspace',
  'workspace_id',
  'project',
  'project_id',
  'matter_id',
]);
const CONTROL_KEYS = new Set(['sort', 'offset', 'limit', 'text', 'body', 'view', 'page', 'order']);
const INJECTION_KEYS = new Set([
  'sql',
  'script',
  'query',
  'where',
  'select',
  'from',
  'join',
  'table',
  'eval',
  'function',
  'constructor',
  '__proto__',
  'prototype',
  'process',
  'require',
]);

// 拒绝可执行文本。人名里的撇号仍允许；比较和枚举值另有白名单。
const HOSTILE_LITERAL =
  /(?:--|\/\*|\*\/|<\s*script\b|javascript\s*:|onerror\s*=|\$\{|`|\0|[<>;])|\b(?:select|insert|update|delete|drop|union|alter|exec|execute)\b/i;

export type TaskFilterCondition =
  | { kind: 'condition'; field: 'status'; op: 'eq' | 'neq'; value: TaskStatus }
  | { kind: 'condition'; field: 'status'; op: 'in' | 'not_in'; value: TaskStatus[] }
  | {
      kind: 'condition';
      field: 'priority';
      op: 'eq' | 'neq' | 'lt' | 'gt';
      value: number;
    }
  | { kind: 'condition'; field: 'priority'; op: 'in' | 'not_in'; value: number[] }
  | { kind: 'condition'; field: 'assignee'; op: 'eq' | 'neq'; value: string }
  | { kind: 'condition'; field: 'assignee'; op: 'is_null' | 'is_not_null' }
  | {
      kind: 'condition';
      field: 'due_date' | 'start_date';
      op: 'eq' | 'before' | 'after' | 'on_or_before' | 'on_or_after';
      value: string;
    }
  | {
      kind: 'condition';
      field: 'due_date' | 'start_date';
      op: 'is_null' | 'is_not_null';
    };

export interface TaskFilterGroup {
  kind: 'group';
  op: 'and' | 'or';
  items: TaskFilterNode[];
}

export interface TaskFilterAll {
  kind: 'all';
}

export type TaskFilterNode = TaskFilterCondition | TaskFilterGroup | TaskFilterAll;

export interface TaskFilterExpression {
  version: typeof TASK_FILTER_EXPRESSION_VERSION;
  node: TaskFilterNode;
}

export type TaskFilterParseResult =
  | { ok: true; expression: TaskFilterExpression }
  | { ok: false; code: 'INVALID_FILTER'; reason: TaskFilterReason; message: string };

function reject(reason: TaskFilterReason): TaskFilterParseResult {
  return { ok: false, code: 'INVALID_FILTER', reason, message: TASK_FILTER_REASON_MESSAGE[reason] };
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function keyReason(key: string): TaskFilterReason | null {
  if (SCOPE_KEYS.has(key)) return 'scope_widening';
  if (CONTROL_KEYS.has(key)) return 'query_control';
  if (INJECTION_KEYS.has(key) || HOSTILE_LITERAL.test(key)) return 'injection';
  return null;
}

function scanLiteral(value: unknown, depth: number): TaskFilterReason | null {
  if (depth > 4) return 'invalid_shape';
  if (typeof value === 'string') {
    if (value.length > 200) return 'invalid_value';
    return HOSTILE_LITERAL.test(value) ? 'injection' : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'invalid_value';
  if (Array.isArray(value)) {
    if (value.length > 8) return 'invalid_value';
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return 'invalid_shape';
      const reason = scanLiteral(value[index], depth + 1);
      if (reason) return reason;
    }
    return null;
  }
  return 'invalid_value';
}

function allowedKeys(
  node: Record<string, unknown>,
  keys: readonly string[],
): TaskFilterReason | null {
  for (const key of Object.keys(node)) {
    const forbidden = keyReason(key);
    if (forbidden) return forbidden;
    if (!keys.includes(key)) return 'invalid_shape';
  }
  return null;
}

interface WalkState {
  nodes: number;
  seen: Set<object>;
}

function walkNode(node: unknown, groupDepth: number, state: WalkState): TaskFilterReason | null {
  if (!isPlain(node)) return 'invalid_shape';
  if (state.seen.has(node)) return 'invalid_shape';
  state.seen.add(node);
  state.nodes += 1;
  if (state.nodes > TASK_FILTER_MAX_NODES) return 'too_many_nodes';
  if (Object.keys(node).length > 6) return 'invalid_shape';

  const kind = node.kind;
  if (kind === 'all') {
    if (groupDepth !== 0) return 'nested_all';
    return allowedKeys(node, ['kind']);
  }
  if (kind === 'group') {
    const keyIssue = allowedKeys(node, ['kind', 'op', 'items']);
    if (keyIssue) return keyIssue;
    const nextDepth = groupDepth + 1;
    if (nextDepth > TASK_FILTER_MAX_DEPTH) return 'over_depth';
    if (typeof node.op !== 'string') return 'unknown_operator';
    if (!GROUP_OPS.includes(node.op as (typeof GROUP_OPS)[number])) {
      return /^[a-z_]+$/.test(node.op) ? 'unknown_operator' : 'injection';
    }
    if (!Array.isArray(node.items)) return 'invalid_shape';
    if (node.items.length === 0) return 'empty_group';
    if (node.items.length > TASK_FILTER_MAX_CHILDREN) return 'too_many_children';
    for (let index = 0; index < node.items.length; index += 1) {
      if (!Object.hasOwn(node.items, index)) return 'invalid_shape';
      const reason = walkNode(node.items[index], nextDepth, state);
      if (reason) return reason;
    }
    return null;
  }
  if (kind !== 'condition') {
    return typeof kind === 'string' && HOSTILE_LITERAL.test(kind) ? 'injection' : 'invalid_shape';
  }

  const keyIssue = allowedKeys(node, ['kind', 'field', 'op', 'value']);
  if (keyIssue) return keyIssue;
  if (typeof node.field !== 'string') return 'unknown_field';
  if (HOSTILE_LITERAL.test(node.field) || !/^[a-z_]+$/.test(node.field)) return 'injection';
  if (!TASK_FILTER_FIELDS.includes(node.field as TaskFilterField)) return 'unknown_field';
  const field = node.field as TaskFilterField;
  if (typeof node.op !== 'string') return 'unknown_operator';
  if (HOSTILE_LITERAL.test(node.op) || !/^[a-z_]+$/.test(node.op)) return 'injection';
  if (!FIELD_OPS[field].includes(node.op)) return 'unknown_operator';
  const nullary = node.op === 'is_null' || node.op === 'is_not_null';
  if (nullary) return Object.hasOwn(node, 'value') ? 'invalid_value' : null;
  if (!Object.hasOwn(node, 'value')) return 'invalid_value';
  return scanLiteral(node.value, 0);
}

function guard(input: unknown): TaskFilterReason | null {
  if (!isPlain(input)) return 'invalid_shape';
  for (const key of Object.keys(input)) {
    const forbidden = keyReason(key);
    if (forbidden) return forbidden;
    if (key !== 'version' && key !== 'node') return 'invalid_shape';
  }
  if (!Object.hasOwn(input, 'version')) return 'invalid_shape';
  if (input.version !== TASK_FILTER_EXPRESSION_VERSION) return 'unsupported_version';
  if (!Object.hasOwn(input, 'node')) return 'invalid_shape';
  return walkNode(input.node, 0, { nodes: 0, seen: new Set() });
}

function withValue(field: TaskFilterField, ops: readonly [string, ...string[]], value: z.ZodType) {
  return z.strictObject({
    kind: z.literal('condition'),
    field: z.literal(field),
    op: z.enum(ops),
    value,
  });
}

function nullaryCondition<Field extends 'assignee' | 'due_date' | 'start_date'>(
  field: Field,
  ops: readonly [string, ...string[]],
) {
  return z.strictObject({
    kind: z.literal('condition'),
    field: z.literal(field),
    op: z.enum(ops),
  });
}

const conditionSchema = z.union([
  withValue('status', ['eq', 'neq'], taskStatusSchema),
  withValue('status', ['in', 'not_in'], z.array(taskStatusSchema).min(1).max(4)),
  withValue('priority', ['eq', 'neq', 'lt', 'gt'], taskPrioritySchema),
  withValue('priority', ['in', 'not_in'], z.array(taskPrioritySchema).min(1).max(5)),
  withValue('assignee', ['eq', 'neq'], taskAssigneeNameSchema),
  nullaryCondition('assignee', ['is_null', 'is_not_null']),
  withValue(
    'due_date',
    ['eq', 'before', 'after', 'on_or_before', 'on_or_after'],
    ordinaryDateSchema,
  ),
  nullaryCondition('due_date', ['is_null', 'is_not_null']),
  withValue(
    'start_date',
    ['eq', 'before', 'after', 'on_or_before', 'on_or_after'],
    ordinaryDateSchema,
  ),
  nullaryCondition('start_date', ['is_null', 'is_not_null']),
]);

const allSchema = z.strictObject({ kind: z.literal('all') });

function nodeUnion() {
  return z.union([
    allSchema,
    z.strictObject({
      kind: z.literal('group'),
      op: z.enum(GROUP_OPS),
      items: z.array(taskFilterNodeSchema).min(1).max(TASK_FILTER_MAX_CHILDREN),
    }),
    conditionSchema,
  ]);
}

const taskFilterNodeSchema: z.ZodType = z.lazy(nodeUnion);

export const taskFilterExpressionSchema = z.strictObject({
  version: z.literal(TASK_FILTER_EXPRESSION_VERSION),
  node: taskFilterNodeSchema,
});

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function normalizeCondition(node: unknown): TaskFilterCondition | null {
  if (!isPlain(node) || !conditionSchema.safeParse(node).success) return null;
  const { field, op } = node;
  if (field === 'status' && oneOf(op, ['eq', 'neq'])) {
    const value = taskStatusSchema.safeParse(node.value);
    return value.success ? { kind: 'condition', field, op, value: value.data } : null;
  }
  if (field === 'status' && oneOf(op, ['in', 'not_in'])) {
    const value = z.array(taskStatusSchema).min(1).max(4).safeParse(node.value);
    return value.success ? { kind: 'condition', field, op, value: [...value.data] } : null;
  }
  if (field === 'priority' && oneOf(op, ['eq', 'neq', 'lt', 'gt'])) {
    const value = taskPrioritySchema.safeParse(node.value);
    return value.success ? { kind: 'condition', field, op, value: value.data } : null;
  }
  if (field === 'priority' && oneOf(op, ['in', 'not_in'])) {
    const value = z.array(taskPrioritySchema).min(1).max(5).safeParse(node.value);
    return value.success ? { kind: 'condition', field, op, value: [...value.data] } : null;
  }
  if (field === 'assignee' && oneOf(op, ['eq', 'neq'])) {
    const value = taskAssigneeNameSchema.safeParse(node.value);
    return value.success ? { kind: 'condition', field, op, value: value.data } : null;
  }
  if (field === 'assignee' && oneOf(op, ['is_null', 'is_not_null'])) {
    return { kind: 'condition', field, op };
  }
  if (
    (field === 'due_date' || field === 'start_date') &&
    oneOf(op, ['eq', 'before', 'after', 'on_or_before', 'on_or_after'])
  ) {
    const value = ordinaryDateSchema.safeParse(node.value);
    return value.success ? { kind: 'condition', field, op, value: value.data } : null;
  }
  if ((field === 'due_date' || field === 'start_date') && oneOf(op, ['is_null', 'is_not_null'])) {
    return { kind: 'condition', field, op };
  }
  return null;
}

function normalizeNode(node: unknown): TaskFilterNode | null {
  if (!isPlain(node)) return null;
  if (node.kind === 'all') return allSchema.safeParse(node).success ? { kind: 'all' } : null;
  if (node.kind === 'group') {
    const parsed = z
      .strictObject({
        kind: z.literal('group'),
        op: z.enum(GROUP_OPS),
        items: z.array(z.unknown()).min(1).max(TASK_FILTER_MAX_CHILDREN),
      })
      .safeParse(node);
    if (!parsed.success) return null;
    const items: TaskFilterNode[] = [];
    for (const child of parsed.data.items) {
      const normalized = normalizeNode(child);
      if (!normalized || normalized.kind === 'all') return null;
      items.push(normalized);
    }
    return { kind: 'group', op: parsed.data.op, items };
  }
  return normalizeCondition(node);
}

function zodReason(error: z.ZodError): TaskFilterReason {
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') return 'invalid_shape';
    const last = issue.path[issue.path.length - 1];
    if (last === 'field') return 'unknown_field';
    if (last === 'op') return 'unknown_operator';
    if (issue.code === 'too_big' && issue.path.includes('items')) return 'too_many_children';
  }
  return 'invalid_value';
}

export function taskFilterBounds(node: TaskFilterNode): {
  nodes: number;
  groupDepth: number;
  maxChildren: number;
  nestedAll: boolean;
} {
  let nodes = 0;
  let groupDepth = 0;
  let maxChildren = 0;
  let nestedAll = false;
  const walk = (current: TaskFilterNode, depth: number) => {
    nodes += 1;
    if (current.kind === 'all' && depth !== 0) nestedAll = true;
    if (current.kind !== 'group') return;
    groupDepth = Math.max(groupDepth, depth + 1);
    maxChildren = Math.max(maxChildren, current.items.length);
    for (const child of current.items) walk(child, depth + 1);
  };
  walk(node, 0);
  return { nodes, groupDepth, maxChildren, nestedAll };
}

/**
 * Zod 校验字段、运算符和值；遍历另拒绝超深、超量、范围扩大和可执行文本。
 * 成功结果是新对象，调用方之后修改输入不会改变已接受的表达式。
 */
export function parseTaskFilterExpression(input: unknown): TaskFilterParseResult {
  const guarded = guard(input);
  if (guarded) return reject(guarded);
  const parsed = taskFilterExpressionSchema.safeParse(input);
  if (!parsed.success) return reject(zodReason(parsed.error));
  const node = normalizeNode(parsed.data.node);
  if (!node) return reject('invalid_value');
  const bounds = taskFilterBounds(node);
  if (bounds.nestedAll) return reject('nested_all');
  if (bounds.groupDepth > TASK_FILTER_MAX_DEPTH) return reject('over_depth');
  if (bounds.nodes > TASK_FILTER_MAX_NODES) return reject('too_many_nodes');
  if (bounds.maxChildren > TASK_FILTER_MAX_CHILDREN) return reject('too_many_children');
  return { ok: true, expression: { version: TASK_FILTER_EXPRESSION_VERSION, node } };
}
