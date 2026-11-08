import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  deliveryExportSchema,
  deliveryConverters,
  type DeliveryExportFormat,
  taskResponseSchema,
  type DeliveryExport,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
const columns = 'id,snapshot_id,format,converter,status,sha256,bytes,created_at';
const digest = ({ request_id, ...content }: Request) => {
  void request_id;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
};
export function createDeliveryExportStore(db: Database.Database, workspace: string) {
  const read = (
    snapshot: string,
    format: DeliveryExportFormat = 'docx',
    exportId?: string,
  ): DeliveryExport | undefined => {
    const row = db
      .prepare(
        `SELECT ${columns} FROM delivery_exports WHERE workspace_id=? AND snapshot_id=? AND format=? ${exportId ? 'AND id=?' : "ORDER BY (status='ready') DESC,(converter=?) DESC,created_at DESC LIMIT 1"}`,
      )
      .get(workspace, snapshot, format, exportId ?? deliveryConverters[format]);
    return row ? deliveryExportSchema.parse(row) : undefined;
  };
  return {
    read,
    reserve(request: Request): DeliveryExport {
      return db
        .transaction(() => {
          const previous = db
            .prepare('SELECT digest FROM task_receipts WHERE workspace_id=? AND key=?')
            .get(workspace, request.idempotency_key) as { digest: string } | undefined;
          const intent = db
            .prepare(
              'SELECT digest,export_id FROM delivery_export_intents WHERE workspace_id=? AND key=?',
            )
            .get(workspace, request.idempotency_key) as
            { digest: string; export_id: string } | undefined;
          if (
            (previous && previous.digest !== digest(request)) ||
            (intent && intent.digest !== digest(request))
          )
            throw new Error('IDEMPOTENCY_CONFLICT');
          // 原键继续指向原转换器；只有新的提交身份才能创建新版产物，不能重写旧文件或回执。
          const current = intent
            ? undefined
            : db
                .prepare(
                  `SELECT ${columns} FROM delivery_exports WHERE workspace_id=? AND snapshot_id=? AND format=? AND converter=?`,
                )
                .get(
                  workspace,
                  request.snapshot_id,
                  request.format,
                  deliveryConverters[request.format],
                );
          let row = intent
            ? read(request.snapshot_id, request.format, intent.export_id)
            : current
              ? deliveryExportSchema.parse(current)
              : undefined;
          if (intent && !row) throw new Error('Missing export intent');
          if (!row) {
            row = {
              id: randomUUID(),
              snapshot_id: request.snapshot_id,
              format: request.format,
              converter: deliveryConverters[request.format],
              status: 'pending',
              sha256: null,
              bytes: null,
              created_at: new Date().toISOString(),
            };
            db.prepare(
              `INSERT INTO delivery_exports(workspace_id,${columns}) VALUES(?,?,?,?,?,?,?,?,?)`,
            ).run(
              workspace,
              row.id,
              row.snapshot_id,
              row.format,
              row.converter,
              row.status,
              null,
              null,
              row.created_at,
            );
          }
          db.prepare(
            'INSERT OR IGNORE INTO delivery_export_intents(workspace_id,key,digest,export_id) VALUES(?,?,?,?)',
          ).run(workspace, request.idempotency_key, digest(request), row.id);
          return row;
        })
        .immediate();
    },
    stage(row: DeliveryExport, hash: string, bytes: number): DeliveryExport {
      const staged = deliveryExportSchema.parse({ ...row, sha256: hash, bytes });
      if (
        db
          .prepare(
            "UPDATE delivery_exports SET sha256=?,bytes=? WHERE id=? AND workspace_id=? AND status='pending'",
          )
          .run(hash, bytes, row.id, workspace).changes !== 1
      )
        throw new Error('Export state changed');
      return staged;
    },
    complete(request: Request, row: DeliveryExport): TaskResponse {
      // 产物已落盘并复核后，ready、成功活动和原回执才可在同一连接提交。
      return db
        .transaction(() => {
          const old = db
            .prepare('SELECT digest,result FROM task_receipts WHERE workspace_id=? AND key=?')
            .get(workspace, request.idempotency_key) as
            { digest: string; result: string } | undefined;
          if (old) {
            if (old.digest !== digest(request)) throw new Error('IDEMPOTENCY_CONFLICT');
            return taskResponseSchema.parse(JSON.parse(old.result));
          }
          const current = read(row.snapshot_id, row.format, row.id);
          if (
            !current ||
            current.id !== row.id ||
            !current.sha256 ||
            !current.bytes ||
            current.sha256 !== row.sha256 ||
            current.bytes !== row.bytes
          )
            throw new Error('Export not staged');
          const created = current.status === 'pending';
          if (created) {
            db.prepare(
              "UPDATE delivery_exports SET status='ready' WHERE id=? AND workspace_id=?",
            ).run(row.id, workspace);
            db.prepare(
              'INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)',
            ).run(randomUUID(), request.task_id, 'export_snapshot', new Date().toISOString());
          }
          const response: TaskResponse = {
            ok: true,
            tasks: [],
            state: null,
            receipt: request.idempotency_key,
            exports: [{ ...current, status: 'ready' }],
            export_created: created,
          };
          db.prepare(
            'INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
          ).run(workspace, request.idempotency_key, digest(request), JSON.stringify(response));
          return response;
        })
        .immediate();
    },
  };
}
