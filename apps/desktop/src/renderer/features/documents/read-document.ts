import type { CatalogDocument, Task } from '../../../preload/caselite-api';

export type EditableDocument =
  | { kind: 'task'; task: Task; state: number[] | null }
  | { kind: 'personal'; document: CatalogDocument; state: number[] | null };

export async function readDocument(document: CatalogDocument): Promise<EditableDocument> {
  if (document.owner_kind === 'personal') {
    const result = await window.caselite.catalog({
      protocol_version: 1,
      operation: 'read_document',
      id: document.id,
    });
    if (!result.ok) throw new Error(result.message);
    const current = result.documents.find((item) => item.id === document.id);
    if (
      result.target_id !== document.id ||
      current?.owner_kind !== 'personal' ||
      current.task_id !== null ||
      current.body_id !== document.body_id ||
      current.matter_id !== document.matter_id ||
      current.body_revision !== document.body_revision ||
      Boolean(current.archived_at) !== Boolean(document.archived_at)
    )
      throw new Error('文档版本或归属已变化，请先刷新目录。');
    return { kind: 'personal', document: current, state: result.state };
  }
  if (!document.task_id) throw new Error('文档归属不可读取，请刷新目录。');
  const result = await window.caselite.task({
    protocol_version: 1,
    operation: 'read',
    task_id: document.task_id,
  });
  if (!result.ok) throw new Error(result.message);
  const task = result.tasks[0];
  if (
    task?.id !== document.task_id ||
    task.document_id !== document.id ||
    task.body_id !== document.body_id ||
    task.matter_id !== document.matter_id ||
    task.body_revision !== document.body_revision ||
    Boolean(task.document_archived_at) !== Boolean(document.archived_at)
  )
    throw new Error('文档版本或归属已变化，请先刷新目录。');
  return { kind: 'task', task, state: result.state };
}
