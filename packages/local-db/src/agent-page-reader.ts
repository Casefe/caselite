import type Database from 'better-sqlite3';
import type { Task } from '@caselite/contracts';
import { bodyPlainText } from './body-schema';

// 页面引用只派生当前对象的已保存内容；不读子任务、评论、附件或聊天记录。
export function createAgentPageReader(
  db: Database.Database,
  workspace: string,
  getTask: (id: string) => Task | null,
) {
  const body = (id: string, revision: number, editorSchema = 1) => {
    if (!revision) return '';
    const row = db
      .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
      .get(id, revision) as { state: Buffer } | undefined;
    if (!row) throw new Error('Missing committed page body');
    return bodyPlainText(row.state, true, editorSchema);
  };
  return {
    read(scope: string) {
      if (scope.startsWith('contact:')) {
        const row = db
          .prepare('SELECT name,kind,version FROM contacts WHERE workspace_id=? AND id=?')
          .get(workspace, scope.slice(8)) as
          { name: string; kind: string; version: number } | undefined;
        // 客户页只引用界面可见的名称/分类；联系方式、联系记录及关联材料不自动进入模型。
        return row
          ? {
              title: row.name,
              version: String(row.version),
              archived: false,
              text: JSON.stringify({ name: row.name, kind: row.kind }),
            }
          : undefined;
      }
      if (scope.startsWith('project:')) {
        const row = db
          .prepare(
            `SELECT title,version,body_id,body_revision,archived_at,status,priority,target_date,assignee,tags,professional_fields
          FROM matters WHERE id=? AND workspace_id=?`,
          )
          .get(scope.slice(8), workspace) as
          | {
              title: string;
              version: number;
              body_id: string;
              body_revision: number;
              archived_at: string | null;
              [key: string]: unknown;
            }
          | undefined;
        if (!row) return;
        const { title, version, body_id, body_revision, archived_at, ...fields } = row;
        return {
          title,
          version: `${version}:${body_revision}`,
          archived: !!archived_at,
          text: [title, body(body_id, body_revision), JSON.stringify(fields)]
            .filter(Boolean)
            .join('\n\n'),
        };
      }
      const document = scope.startsWith('document:');
      const target = document
        ? (db
            .prepare(
              `SELECT t.id FROM task_items t JOIN documents d ON d.task_id=t.id
        WHERE d.id=? AND t.workspace_id=?`,
            )
            .get(scope.slice(9), workspace) as { id: string } | undefined)
        : undefined;
      const task = getTask(document ? (target?.id ?? '') : scope);
      if (!task) return;
      return {
        title: task.title,
        version: document
          ? `${task.body_revision}:${task.document_metadata_version}`
          : String(task.version),
        archived: !!task.document_archived_at,
        text: document
          ? [task.title, body(task.body_id, task.body_revision, task.editor_schema)]
              .filter(Boolean)
              .join('\n\n')
          : [
              task.title,
              task.objective,
              JSON.stringify({
                status: task.status,
                priority: task.priority,
                due_date: task.due_date,
                assignee: task.assignee,
                tags: task.tags,
              }),
            ]
              .filter(Boolean)
              .join('\n\n'),
      };
    },
  };
}
