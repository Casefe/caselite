import {
  TASK_FILTER_MAX_DEPTH,
  TASK_FILTER_MAX_NODES,
  taskFilterExpressionEnvelopeSchema,
  type TaskFilterCondition,
  type TaskFilterExpression,
  type TaskFilterExpressionEnvelope,
  type TaskFilterField,
} from '@caselite/contracts';

export type TaskFilterSubject = {
  status: 'todo' | 'in_progress' | 'done' | 'canceled';
  priority: number;
  assignee: string | null | undefined;
  due_date: string | null | undefined;
  planned_date: string | null | undefined;
};

const INJECTION_PATTERN =
  /(?:\b(?:select|insert|update|delete|drop|union|exec|script)\b|--|\/\*|<\s*script|;\s*(?:select|drop))/i;

function collectMetrics(
  node: TaskFilterExpression,
  depth: number,
): { depth: number; nodes: number; error?: string } {
  if (depth > TASK_FILTER_MAX_DEPTH) {
    return { depth, nodes: 0, error: '组合条件深度超过上限' };
  }
  if (node.kind === 'condition') {
    return { depth, nodes: 1 };
  }
  let nodes = 1;
  let maxDepth = depth;
  for (const child of node.children) {
    const nested = collectMetrics(child, depth + 1);
    if (nested.error) return nested;
    nodes += nested.nodes;
    if (nodes > TASK_FILTER_MAX_NODES) {
      return { depth: Math.max(maxDepth, nested.depth), nodes, error: '组合条件节点数超过上限' };
    }
    maxDepth = Math.max(maxDepth, nested.depth);
  }
  return { depth: maxDepth, nodes };
}

function stringLooksInjected(value: string): boolean {
  return INJECTION_PATTERN.test(value) || value.includes('\0');
}

function conditionHasInjection(node: TaskFilterCondition): boolean {
  if (
    node.field === 'assignee' &&
    typeof node.value === 'string' &&
    stringLooksInjected(node.value)
  ) {
    return true;
  }
  return false;
}

function walkInjection(node: TaskFilterExpression): boolean {
  if (node.kind === 'condition') return conditionHasInjection(node);
  return node.children.some(walkInjection);
}

export type TaskFilterValidationResult =
  | { ok: true; expression: TaskFilterExpressionEnvelope }
  | { ok: false; code: 'INVALID_REQUEST'; message: string };

/** Application 入口：在 Zod 合同之上校验深度/节点与注入特征，不扩大查询范围或直写 SQL。 */
export function validateTaskFilterExpression(input: unknown): TaskFilterValidationResult {
  const parsed = taskFilterExpressionEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: '筛选表达式格式无效，请检查字段、运算符与版本。',
    };
  }
  if (typeof input === 'object' && input !== null) {
    const forbidden = Object.keys(input as Record<string, unknown>).filter(
      (key) => key !== 'protocol_version' && key !== 'root',
    );
    if (forbidden.length > 0) {
      return { ok: false, code: 'INVALID_REQUEST', message: '筛选表达式包含未授权字段。' };
    }
  }
  const metrics = collectMetrics(parsed.data.root, 1);
  if (metrics.error) {
    return { ok: false, code: 'INVALID_REQUEST', message: metrics.error };
  }
  if (walkInjection(parsed.data.root)) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: '筛选表达式包含不允许的脚本或查询片段。',
    };
  }
  return { ok: true, expression: parsed.data };
}

function readField(subject: TaskFilterSubject, field: TaskFilterField): unknown {
  switch (field) {
    case 'status':
      return subject.status;
    case 'priority':
      return subject.priority;
    case 'assignee':
      return subject.assignee ?? null;
    case 'due_date':
      return subject.due_date ?? null;
    case 'planned_date':
      return subject.planned_date ?? null;
  }
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function evaluateCondition(node: TaskFilterCondition, subject: TaskFilterSubject): boolean {
  const current = readField(subject, node.field);
  switch (node.operator) {
    case 'eq':
      return current === node.value;
    case 'ne':
      return current !== node.value;
    case 'in':
      return Array.isArray(node.value) && node.value.some((item) => item === current);
    case 'gte':
      return typeof current === 'number' && typeof node.value === 'number'
        ? current >= node.value
        : typeof current === 'string' && typeof node.value === 'string'
          ? current >= node.value
          : false;
    case 'lte':
      return typeof current === 'number' && typeof node.value === 'number'
        ? current <= node.value
        : typeof current === 'string' && typeof node.value === 'string'
          ? current <= node.value
          : false;
    case 'is_empty':
      return isEmptyValue(current);
    case 'is_not_empty':
      return !isEmptyValue(current);
  }
}

/** 纯内存求值，供合同测试与后续查询适配复用；不触碰 SQLite 或文件。 */
export function evaluateTaskFilterExpression(
  envelope: TaskFilterExpressionEnvelope,
  subject: TaskFilterSubject,
): boolean {
  const walk = (node: TaskFilterExpression): boolean => {
    if (node.kind === 'condition') return evaluateCondition(node, subject);
    const outcomes = node.children.map(walk);
    return node.logic === 'and' ? outcomes.every(Boolean) : outcomes.some(Boolean);
  };
  return walk(envelope.root);
}
