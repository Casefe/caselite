import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  deliveryExportSchema,
  deliveryConverters,
  configuredDeliveryConverters,
  exportConfigurationSchema,
  exportConfigurationContent,
  type ExportConfiguration,
  type DeliveryExportFormat,
  taskResponseSchema,
  type DeliveryExport,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
const columns =
  'id,snapshot_id,format,converter,status,sha256,bytes,created_at,configuration_json,configuration_fingerprint';
const digest = ({ request_id, ...content }: Request) => {
  void request_id;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
};
export function createDeliveryExportStore(db: Database.Database, workspace: string) {
  const parse = (value: unknown): DeliveryExport => {
    const { configuration_json, configuration_fingerprint, ...row } = value as Record<
      string,
      unknown
    >;
    const configuration =
      configuration_json === null
        ? undefined
        : exportConfigurationSchema.parse(JSON.parse(String(configuration_json)));
    if (
      configuration_fingerprint !== (configuration?.fingerprint ?? '') ||
      (configuration &&
        createHash('sha256').update(exportConfigurationContent(configuration)).digest('hex') !==
          configuration.fingerprint)
    )
      throw new Error('Export configuration mismatch');
    return deliveryExportSchema.parse({ ...row, ...(configuration ? { configuration } : {}) });
  };
  const read = (
    snapshot: string,
    format: DeliveryExportFormat = 'docx',
    exportId?: string,
    configurationFingerprint?: string,
  ): DeliveryExport | undefined => {
    const selected = configurationFingerprint !== undefined;
    const row = db
      .prepare(
        `SELECT ${columns} FROM delivery_exports WHERE workspace_id=? AND snapshot_id=? AND format=? ${exportId ? 'AND id=?' : selected ? 'AND converter=? AND configuration_fingerprint=? LIMIT 1' : "AND configuration_fingerprint='' ORDER BY (status='ready') DESC,(converter=?) DESC,created_at DESC LIMIT 1"}`,
      )
      .get(
        ...(exportId
          ? [workspace, snapshot, format, exportId]
          : selected
            ? [
                workspace,
                snapshot,
                format,
                configuredDeliveryConverters[format],
                configurationFingerprint!,
              ]
            : [workspace, snapshot, format, deliveryConverters[format]]),
      );
    return row ? parse(row) : undefined;
  };
  const readIntent = (request: Request): DeliveryExport | undefined => {
    const previous = db
      .prepare('SELECT digest FROM task_receipts WHERE workspace_id=? AND key=?')
      .get(workspace, request.idempotency_key) as { digest: string } | undefined;
    const intent = db
      .prepare(
        'SELECT digest,export_id FROM delivery_export_intents WHERE workspace_id=? AND key=?',
      )
      .get(workspace, request.idempotency_key) as { digest: string; export_id: string } | undefined;
    if (
      (previous && previous.digest !== digest(request)) ||
      (intent && intent.digest !== digest(request))
    )
      throw new Error('IDEMPOTENCY_CONFLICT');
    if (!intent) {
      if (previous) throw new Error('Missing export intent');
      return undefined;
    }
    const row = read(request.snapshot_id, request.format, intent.export_id);
    if (!row) throw new Error('Missing export intent');
    return row;
  };
  return {
    read,
    readIntent,
    list(snapshot: string, format: DeliveryExportFormat): DeliveryExport[] {
      return db
        .prepare(
          `SELECT ${columns} FROM delivery_exports WHERE workspace_id=? AND snapshot_id=? AND format=? ORDER BY created_at DESC,id DESC LIMIT 20`,
        )
        .all(workspace, snapshot, format)
        .map(parse);
    },
    reserve(request: Request, incomingConfiguration?: ExportConfiguration): DeliveryExport {
      const configuration = incomingConfiguration
        ? exportConfigurationSchema.parse(incomingConfiguration)
        : undefined;
      if (
        Boolean(request.export_style) !== Boolean(configuration) ||
        (configuration &&
          (createHash('sha256').update(exportConfigurationContent(configuration)).digest('hex') !==
            configuration.fingerprint ||
            JSON.stringify(configuration.style) !== JSON.stringify(request.export_style)))
      )
        throw new Error('Export configuration mismatch');
      const converter = configuration
        ? configuredDeliveryConverters[request.format]
        : deliveryConverters[request.format];
      return db
        .transaction(() => {
          // 原键继续指向原转换器；只有新提交身份才能选择新的有效配置。
          let row = readIntent(request);
          if (!row) {
            const current = db
              .prepare(
                `SELECT ${columns} FROM delivery_exports WHERE workspace_id=? AND snapshot_id=? AND format=? AND converter=? AND configuration_fingerprint=?`,
              )
              .get(
                workspace,
                request.snapshot_id,
                request.format,
                converter,
                configuration?.fingerprint ?? '',
              );
            row = current ? parse(current) : undefined;
          }
          if (!row) {
            row = {
              id: randomUUID(),
              snapshot_id: request.snapshot_id,
              format: request.format,
              converter,
              ...(configuration ? { configuration } : {}),
              status: 'pending',
              sha256: null,
              bytes: null,
              created_at: new Date().toISOString(),
            };
            db.prepare(
              `INSERT INTO delivery_exports(workspace_id,${columns}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
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
              configuration ? JSON.stringify(configuration) : null,
              configuration?.fingerprint ?? '',
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
