import type Database from 'better-sqlite3';
import type { ReviewRange, Task, TaskRequest, TaskResponse } from '@caselite/contracts';
import { validateBody, reviewBodyRange } from './body-schema';

// 复用任务存储的连接、工作区与回执查询；不创建连接，也不在此写修订。
export function createDocumentReviewReader(
  db: Database.Database,
  workspace: string,
  get: (id: string) => Task | null,
) {
  return {
    reviewDocumentExists(documentId: string) {
      return Boolean(
        db
          .prepare(
            'SELECT d.id FROM documents d JOIN task_items t ON t.id=d.task_id WHERE d.id=? AND t.workspace_id=?',
          )
          .get(documentId, workspace),
      );
    },
    reviewSaved(
      range: ReviewRange,
      receipt: string,
      execute: (request: TaskRequest) => TaskResponse,
    ) {
      const result = execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: receipt,
      });
      if (!result.ok) return;
      const task = result.tasks[0];
      if (
        !task ||
        task.id !== range.task_id ||
        task.document_id !== range.document_id ||
        task.body_id !== range.body_id ||
        task.body_revision !== range.revision + 1
      )
        throw new Error('Unexpected review receipt');
      const row = db
        .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
        .get(task.body_id, task.body_revision) as { state: Buffer } | undefined;
      if (!row) throw new Error('Missing review revision');
      validateBody(row.state, true);
      return { task, state: Array.from(row.state) };
    },
    reviewState(range: ReviewRange, replacement?: string) {
      const task = get(range.task_id);
      if (
        !task ||
        task.document_archived_at ||
        task.document_id !== range.document_id ||
        task.body_id !== range.body_id ||
        task.body_revision !== range.revision ||
        task.editor_schema !== 1
      )
        return;
      const row = db
        .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
        .get(task.body_id, range.revision) as { state: Buffer } | undefined;
      if (!row) return;
      validateBody(row.state, true);
      return reviewBodyRange(row.state, range, replacement);
    },
  };
}
