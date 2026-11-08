import {
  taskRequestSchema,
  type DeliveryExport,
  type DeliverySnapshot,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
export interface DeliveryExportStorePort {
  read(snapshot: string): DeliveryExport | undefined;
  reserve(request: Request): DeliveryExport;
  stage(row: DeliveryExport, hash: string, bytes: number): DeliveryExport;
  complete(request: Request, row: DeliveryExport): TaskResponse;
}
export interface DeliveryExportFilesPort {
  verify(row: DeliveryExport): Promise<boolean>;
  put(row: DeliveryExport, bytes: Uint8Array): Promise<void>;
  open(row: DeliveryExport): Promise<void>;
}
export function createDeliveryExportApplication(ports: {
  task: { execute(input: unknown): TaskResponse };
  store: DeliveryExportStorePort;
  files: DeliveryExportFilesPort;
  render(snapshot: DeliverySnapshot, state: number[]): Promise<Uint8Array>;
  hash(bytes: Uint8Array): string;
}) {
  // 同一进程串行处理交付效果；SQLite唯一身份和受管文件负责跨重启恢复。
  let tail: Promise<unknown> = Promise.resolve();
  async function execute(input: unknown): Promise<TaskResponse> {
    const parsed = taskRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: '交付请求无效。' };
    const request = parsed.data;
    if (
      request.operation !== 'export_snapshot' &&
      request.operation !== 'open_export' &&
      request.operation !== 'read_export'
    )
      return ports.task.execute(request);
    const failure = (
      code: 'WRITE_FAILED' | 'READ_FAILED' | 'CONFLICT',
      message: string,
    ): TaskResponse => ({ ok: false, code, message });
    try {
      const fixed = ports.task.execute({
        protocol_version: 1,
        operation: 'read_snapshot',
        task_id: request.task_id,
        document_id: request.document_id,
        snapshot_id: request.snapshot_id,
      });
      if (!fixed.ok) return fixed;
      const snapshot = fixed.snapshots?.[0];
      if (!snapshot || !fixed.state) throw new Error('Missing fixed snapshot');
      if (request.operation === 'read_export') {
        const row = ports.store.read(snapshot.id);
        if (row?.status === 'ready' && !(await ports.files.verify(row)))
          return failure(
            'READ_FAILED',
            '已保存Word文件缺失，未重新生成或覆盖，请保留记录并检查存储。',
          );
        return { ok: true, tasks: [], state: null, receipt: null, exports: row ? [row] : [] };
      }
      if (request.operation === 'open_export') {
        const row = ports.store.read(snapshot.id);
        if (!row || row.id !== request.export_id || row.status !== 'ready')
          return failure('READ_FAILED', '所选Word尚未确认保存。');
        await ports.files.open(row);
        return {
          ok: true,
          tasks: [],
          state: null,
          receipt: null,
          exports: [row],
          export_opened: true,
        };
      }
      let row = ports.store.reserve(request);
      const placed = await ports.files.verify(row);
      if (!placed) {
        if (row.status === 'ready')
          return failure('READ_FAILED', '已保存Word文件缺失，未重新生成或覆盖，请检查存储。');
        const bytes = await ports.render(snapshot, fixed.state);
        if (!bytes.length || bytes.length > 20_000_000) throw new Error('Export size limit');
        row = ports.store.stage(row, ports.hash(bytes), bytes.length);
        await ports.files.put(row, bytes);
      }
      if (!(await ports.files.verify(row))) throw new Error('Export not durable');
      return ports.store.complete(request, row);
    } catch (error) {
      if (error instanceof Error && error.message === 'UNSUPPORTED_WORD_CONTENT')
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message:
            '此固定版本含暂不支持的Word格式或超出生成规模限制，未生成交付文件；请保留快照并核对工作稿。',
        };
      if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT')
        return failure('CONFLICT', '该提交身份与原导出不同，请核对原提交。');
      return failure(
        request.operation === 'export_snapshot' ? 'WRITE_FAILED' : 'READ_FAILED',
        request.operation === 'open_export'
          ? 'Word工作副本未能打开；固定产物保持不变，请检查文件或关联应用。'
          : '未能确认Word导出。原快照与请求已保留；可核对原提交后重试。',
      );
    }
  }
  return {
    execute(input: unknown): Promise<TaskResponse> {
      const parsed = taskRequestSchema.safeParse(input);
      if (
        parsed.success &&
        !['export_snapshot', 'read_export', 'open_export'].includes(parsed.data.operation)
      )
        return Promise.resolve(ports.task.execute(input));
      const result = tail.then(() => execute(input));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
