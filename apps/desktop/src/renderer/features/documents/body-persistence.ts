import type {
  CatalogDocument,
  CatalogRequest,
  CatalogResponse,
  Task,
  TaskRequest,
  TaskResponse,
} from '../../../preload/caselite-api';
import { mutation } from '../../shared/data/taskCommand';

type SavedCallback<T> = (value: T, state: number[]) => void | string | Promise<void | string>;
export type BodyOwnerProps =
  | { task: Task; document?: never; onSaved: SavedCallback<Task> }
  | { task?: never; document: CatalogDocument; onSaved: SavedCallback<CatalogDocument> };
export type BodyRequest =
  | Extract<TaskRequest, { operation: 'save' }>
  | Extract<CatalogRequest, { operation: 'save_document_body' }>;
export type BodyResponse = TaskResponse | CatalogResponse;

// 两种 Owner 只适配持久化边界；编辑实例、冻结提交和未知回执恢复共用同一个状态机。
export function bodyPersistence(owner: BodyOwnerProps) {
  const task = owner.task;
  const identity = owner.task
    ? {
        documentId: owner.task.document_id,
        bodyId: owner.task.body_id,
        revision: owner.task.body_revision,
        schema: owner.task.editor_schema,
        title: owner.task.title,
        archivedAt: owner.task.document_archived_at,
      }
    : {
        documentId: owner.document.id,
        bodyId: owner.document.body_id,
        revision: owner.document.body_revision,
        schema: owner.document.editor_schema,
        title: owner.document.title,
        archivedAt: owner.document.archived_at,
      };
  return {
    identity,
    request(revision: number, schema: 1 | 2, state: number[]): BodyRequest {
      const common = {
        ...mutation(),
        document_id: identity.documentId,
        body_id: identity.bodyId,
        expected_revision: revision,
        editor_schema: schema,
        state,
      };
      return task
        ? { ...common, operation: 'save', task_id: task.id }
        : { ...common, operation: 'save_document_body' };
    },
    submit(request: BodyRequest): Promise<BodyResponse> {
      return request.operation === 'save'
        ? window.caselite.task(request)
        : window.caselite.catalog(request);
    },
    status(request: BodyRequest): Promise<BodyResponse> {
      const status = {
        protocol_version: 1 as const,
        operation: 'status' as const,
        idempotency_key: request.idempotency_key,
      };
      return request.operation === 'save'
        ? window.caselite.task(status)
        : window.caselite.catalog(status);
    },
    accept(response: BodyResponse, request: BodyRequest) {
      if (!response.ok) throw new Error(response.message);
      const mismatch = () => new Error('保存回执与原提交不一致，请保留输入并核对保存结果。');
      if (response.receipt !== request.idempotency_key) throw mismatch();
      if (owner.task && request.operation === 'save' && 'tasks' in response) {
        const saved = response.tasks[0];
        if (
          saved?.id !== request.task_id ||
          saved.document_id !== request.document_id ||
          saved.body_id !== request.body_id ||
          saved.body_revision !== request.expected_revision + 1 ||
          saved.editor_schema !== request.editor_schema
        )
          throw mismatch();
        return {
          revision: saved.body_revision,
          schema: saved.editor_schema,
          publish: (state: number[]) => owner.onSaved(saved, state),
        };
      }
      if (!owner.task && request.operation === 'save_document_body' && 'documents' in response) {
        const saved = response.documents.find((item) => item.id === request.document_id);
        if (
          response.target_id !== request.document_id ||
          saved?.owner_kind !== 'personal' ||
          saved.task_id !== null ||
          saved.body_id !== request.body_id ||
          saved.body_revision !== request.expected_revision + 1 ||
          saved.editor_schema !== request.editor_schema
        )
          throw mismatch();
        return {
          revision: saved.body_revision,
          schema: saved.editor_schema,
          publish: (state: number[]) => owner.onSaved(saved, state),
        };
      }
      throw mismatch();
    },
  };
}
