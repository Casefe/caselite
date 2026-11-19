import {
  parseTaskFilterExpression,
  type TaskFilterCondition,
  type TaskFilterExpression,
  type TaskFilterNode,
} from '@caselite/contracts';

/** 评估所需的最小任务投影；不依赖存储，也不携带正文/附件。 */
export interface TaskFilterSubject {
  status: string;
  priority: number;
  assignee?: string | null;
  due_date?: string | null;
  start_date?: string | null;
}

export type TaskFilterValidation =
  | { ok: true; expression: TaskFilterExpression }
  | { ok: false; code: 'filter_limit_exceeded' | 'filter_invalid' };

/**
 * Application 入口：旧请求没有表达式时由调用方继续走简单筛选；
 * 只要带了表达式就必须通过版本、白名单及深度/数量上限，失败时不降级为“不筛选”，
 * 以免过期或被篡改的视图悄悄扩大结果集。
 */
export function validateTaskFilterExpression(input: unknown): TaskFilterValidation {
  const parsed = parseTaskFilterExpression(input);
  if (parsed.success) return { ok: true, expression: parsed.data };
  return {
    ok: false,
    code: parsed.reason === 'limit' ? 'filter_limit_exceeded' : 'filter_invalid',
  };
}

function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function matchesCondition(condition: TaskFilterCondition, task: TaskFilterSubject): boolean {
  switch (condition.field) {
    case 'status': {
      if (condition.op === 'in') return condition.value.includes(task.status as never);
      return condition.op === 'eq'
        ? task.status === condition.value
        : task.status !== condition.value;
    }
    case 'priority': {
      switch (condition.op) {
        case 'in':
          return condition.value.includes(task.priority);
        case 'eq':
          return task.priority === condition.value;
        case 'ne':
          return task.priority !== condition.value;
        case 'gte':
          return task.priority >= condition.value;
        case 'lte':
          return task.priority <= condition.value;
      }
      return false;
    }
    case 'assignee': {
      const empty = isEmpty(task.assignee);
      if (condition.op === 'is_empty') return empty;
      if (condition.op === 'is_not_empty') return !empty;
      // 空值对 eq/ne 都不命中：未分配必须显式用 is_empty，避免三值逻辑里“未知”被当成真。
      if (empty || !('value' in condition)) return false;
      return condition.op === 'eq'
        ? task.assignee === condition.value
        : task.assignee !== condition.value;
    }
    case 'due_date':
    case 'start_date': {
      const date = task[condition.field];
      const empty = isEmpty(date);
      if (condition.op === 'is_empty') return empty;
      if (condition.op === 'is_not_empty') return !empty;
      if (empty) return false;
      // 普通日期是无时区的 YYYY-MM-DD 日历日期，字典序即日期序；不做时区换算。
      switch (condition.op) {
        case 'eq':
          return date === condition.value;
        case 'before':
          return date! < condition.value;
        case 'after':
          return date! > condition.value;
        case 'on_or_before':
          return date! <= condition.value;
        case 'on_or_after':
          return date! >= condition.value;
        case 'between':
          return date! >= condition.value.from && date! <= condition.value.to;
      }
      return false;
    }
  }
}

function matchesNode(node: TaskFilterNode, task: TaskFilterSubject): boolean {
  if ('logic' in node) {
    return node.logic === 'and'
      ? node.children.every((child) => matchesNode(child, task))
      : node.children.some((child) => matchesNode(child, task));
  }
  return matchesCondition(node, task);
}

/** 仅接受已校验的表达式；深度已被合同限制，递归安全。 */
export function matchesTaskFilter(
  expression: TaskFilterExpression,
  task: TaskFilterSubject,
): boolean {
  return matchesNode(expression.root, task);
}
