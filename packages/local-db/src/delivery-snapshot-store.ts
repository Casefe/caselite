import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  deliverySnapshotSchema,
  type DeliverySnapshot,
  type Task,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';
import { validateBody } from './body-schema';

type Create = Extract<TaskRequest, { operation: 'create_snapshot' }>;
type Query = Extract<TaskRequest, { operation: 'list_snapshots' | 'read_snapshot' }>;
type Failure = Extract<TaskResponse, { ok: false }>;
type Row = Omit<DeliverySnapshot, 'tags' | 'source_refs'> & { tags: string; source_refs: string };
const columns =
  'id,document_id,task_id,body_id,body_revision,editor_schema,metadata_version,task_version,title,collection,tags,note,content_sha256,created_at,created_by,kind,source_refs';
const decode = (row: Row) =>
  deliverySnapshotSchema.parse({
    ...row,
    tags: JSON.parse(row.tags),
    source_refs: JSON.parse(row.source_refs),
  });
const fail = (code: Failure['code'], message: string): Failure => ({ ok: false, code, message });

export function createDeliverySnapshotStore(
  db: Database.Database,
  workspace: string,
  getTask: (id: string) => Task | null,
) {
  function body(snapshot: Pick<DeliverySnapshot, 'body_id' | 'body_revision'>) {
    const row = db
      .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
      .get(snapshot.body_id, snapshot.body_revision) as { state: Buffer } | undefined;
    if (!row) throw new Error('Missing fixed body revision');
    validateBody(row.state, true);
    return row.state;
  }
  return {
    // 由task:v1的原幂等事务调用，禁止在此另开连接或提前写成功回执。
    create(
      request: Create,
      task: Task,
    ): { ok: true; snapshot: DeliverySnapshot; created: boolean } | Failure {
      if (task.document_id !== request.document_id || task.body_id !== request.body_id)
        return fail('FORBIDDEN', '所选文档与当前任务不匹配。');
      if (task.editor_schema === 2)
        return fail(
          'CONFLICT',
          '含高亮或批注的正文暂不支持新建固定交付版本；已有固定版本仍可查看和导出。',
        );
      if (
        task.document_archived_at ||
        task.body_revision !== request.expected_revision ||
        task.editor_schema !== 1 ||
        task.document_metadata_version !== request.expected_metadata_version ||
        task.version !== request.expected_task_version
      )
        return fail('CONFLICT', '工作稿或文档属性已变化，请返回工作稿重新读取后核对。');
      const existing = db
        .prepare(
          `SELECT ${columns} FROM deliverable_snapshots WHERE workspace_id=? AND document_id=? AND body_revision=? AND metadata_version=? AND task_version=?`,
        )
        .get(
          workspace,
          task.document_id,
          task.body_revision,
          task.document_metadata_version,
          task.version,
        ) as Row | undefined;
      if (existing) return { ok: true, snapshot: decode(existing), created: false };
      const metadata = db
        .prepare('SELECT collection,tags FROM documents WHERE id=?')
        .get(task.document_id) as { collection: string; tags: string };
      const state = body({ body_id: task.body_id, body_revision: task.body_revision });
      const snapshot = deliverySnapshotSchema.parse({
        id: randomUUID(),
        document_id: task.document_id,
        task_id: task.id,
        body_id: task.body_id,
        body_revision: task.body_revision,
        editor_schema: 1,
        metadata_version: task.document_metadata_version,
        task_version: task.version,
        title: task.title,
        collection: metadata.collection,
        tags: JSON.parse(metadata.tags),
        note: request.note,
        content_sha256: createHash('sha256').update(state).digest('hex'),
        created_at: new Date().toISOString(),
        created_by: 'local',
        kind: 'draft',
        source_refs: [],
      });
      db.prepare(
        `INSERT INTO deliverable_snapshots(workspace_id,${columns}) VALUES(${Array(18).fill('?').join(',')})`,
      ).run(
        workspace,
        snapshot.id,
        snapshot.document_id,
        snapshot.task_id,
        snapshot.body_id,
        snapshot.body_revision,
        snapshot.editor_schema,
        snapshot.metadata_version,
        snapshot.task_version,
        snapshot.title,
        snapshot.collection,
        metadata.tags,
        snapshot.note,
        snapshot.content_sha256,
        snapshot.created_at,
        snapshot.created_by,
        snapshot.kind,
        '[]',
      );
      return { ok: true, snapshot, created: true };
    },
    query(request: Query): TaskResponse {
      const task = getTask(request.task_id);
      if (!task || task.document_id !== request.document_id)
        return fail('NOT_FOUND', '文档不存在或不在当前工作区。');
      if (request.operation === 'list_snapshots') {
        const rows = db
          .prepare(
            `SELECT ${columns} FROM deliverable_snapshots WHERE workspace_id=? AND document_id=? AND task_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`,
          )
          .all(workspace, request.document_id, task.id, request.offset) as Row[];
        const { total } = db
          .prepare(
            'SELECT count(*) AS total FROM deliverable_snapshots WHERE workspace_id=? AND document_id=? AND task_id=?',
          )
          .get(workspace, request.document_id, task.id) as { total: number };
        return {
          ok: true,
          tasks: [task],
          state: null,
          receipt: null,
          snapshots: rows.map(decode),
          page: { offset: request.offset, total, has_more: request.offset + rows.length < total },
        };
      }
      const row = db
        .prepare(
          `SELECT ${columns} FROM deliverable_snapshots WHERE workspace_id=? AND document_id=? AND task_id=? AND id=?`,
        )
        .get(workspace, request.document_id, task.id, request.snapshot_id) as Row | undefined;
      if (!row) return fail('NOT_FOUND', '固定版本不存在或不属于当前文档。');
      const snapshot = decode(row),
        state = body(snapshot);
      if (createHash('sha256').update(state).digest('hex') !== snapshot.content_sha256)
        return fail('READ_FAILED', '固定版本校验失败，原数据已保留，请检查备份。');
      return {
        ok: true,
        tasks: [task],
        state: Array.from(state),
        receipt: null,
        snapshots: [snapshot],
      };
    },
  };
}
