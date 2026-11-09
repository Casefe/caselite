import type Database from 'better-sqlite3';
import { calendarTypes } from './task-calendar';
import {
  agentRunSchema,
  dateConfirmationSchema,
  type DateConfirmation,
  type DateConfirmRequest,
  type Task,
  type TaskCalendar,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';

export function createImportantDateStore(
  db: Database.Database,
  workspace: string,
  get: (id: string) => Task | null,
  execute: (r: TaskRequest) => TaskResponse,
) {
  const available = () =>
    !!db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='task_date_confirmations'",
      )
      .get();
  const receipt = (task: string, key: string) => {
    if (!available()) return;
    const row = db
      .prepare(
        'SELECT payload FROM task_date_confirmations WHERE workspace_id=? AND task_id=? AND receipt_key=?',
      )
      .get(workspace, task, key) as { payload: string } | undefined;
    if (!row) return;
    const confirmation = dateConfirmationSchema.parse(JSON.parse(row.payload));
    const result = execute({ protocol_version: 1, operation: 'status', idempotency_key: key });
    if (
      !result.ok ||
      result.receipt !== key ||
      result.tasks[0]?.id !== task ||
      result.tasks[0].version !== confirmation.task_version
    )
      throw Error('Invalid date confirmation receipt');
    return { task: result.tasks[0], confirmation, receipt: key };
  };
  return {
    types: () => calendarTypes(db, workspace),
    task: get,
    run(id: string, scope: string) {
      const row = db
        .prepare('SELECT payload FROM agent_runs WHERE workspace_id=? AND id=? AND scope=?')
        .get(workspace, id, scope) as { payload: string } | undefined;
      return row ? agentRunSchema.parse(JSON.parse(row.payload)) : undefined;
    },
    confirmations(task: string) {
      if (!get(task) || !available()) return [];
      return (
        db
          .prepare(
            'SELECT payload FROM task_date_confirmations WHERE workspace_id=? AND task_id=? ORDER BY task_version DESC LIMIT 100',
          )
          .all(workspace, task) as { payload: string }[]
      ).map((r) => dateConfirmationSchema.parse(JSON.parse(r.payload)));
    },
    receipt,
    commit(
      request: DateConfirmRequest,
      build: () =>
        | { calendar: TaskCalendar; confirmation: DateConfirmation }
        | { code: string; message: string },
    ) {
      if (!available()) return { code: 'CONFLICT', message: '此工作区尚未升级日期确认格式' };
      return db
        .transaction(() => {
          const old = receipt(request.scope, request.idempotency_key);
          if (old)
            return JSON.stringify(old.confirmation.request) === JSON.stringify(request)
              ? old
              : { code: 'CONFLICT', message: '同键确认内容不同' };
          const existing = execute({
            protocol_version: 1,
            operation: 'status',
            idempotency_key: request.idempotency_key,
          });
          if (existing.ok) return { code: 'CONFLICT', message: '原键已用于其他任务动作' };
          const proposed = build();
          if ('code' in proposed) return proposed;
          const confirmation = dateConfirmationSchema.parse(proposed.confirmation);
          const saved = execute({
            protocol_version: 1,
            operation: 'update_calendar',
            task_id: request.scope,
            expected_version: request.expected_version,
            request_id: request.idempotency_key,
            idempotency_key: request.idempotency_key,
            calendar: proposed.calendar,
          });
          if (!saved.ok) return saved;
          db.prepare(
            'INSERT INTO task_date_confirmations(workspace_id,receipt_key,task_id,run_id,task_version,payload) VALUES(?,?,?,?,?,?)',
          ).run(
            workspace,
            request.idempotency_key,
            request.scope,
            request.run_id,
            confirmation.task_version,
            JSON.stringify(confirmation),
          );
          return { task: saved.tasks[0], confirmation, receipt: request.idempotency_key };
        })
        .immediate();
    },
  };
}
