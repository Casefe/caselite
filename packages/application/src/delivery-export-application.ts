import {
  taskRequestSchema,
  type DeliveryExport,
  type DeliveryExportFormat,
  type DeliverySnapshot,
  type TaskRequest,
  type TaskResponse,
  exportConfigurationSchema,
  type ExportConfiguration,
  type ExportStyle,
} from '@caselite/contracts';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
export interface DeliveryExportStorePort {
  read(
    snapshot: string,
    format?: DeliveryExportFormat,
    exportId?: string,
    configurationFingerprint?: string,
  ): DeliveryExport | undefined;
  readIntent?(request: Request): DeliveryExport | undefined;
  list?(snapshot: string, format: DeliveryExportFormat): DeliveryExport[];
  reserve(request: Request, configuration?: ExportConfiguration): DeliveryExport;
  stage(row: DeliveryExport, hash: string, bytes: number): DeliveryExport;
  complete(request: Request, row: DeliveryExport): TaskResponse;
}
export interface DeliveryExportFilesPort {
  verify(row: DeliveryExport): Promise<boolean>;
  put(row: DeliveryExport, bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  open(row: DeliveryExport, signal?: AbortSignal): Promise<void>;
  save?(row: DeliveryExport, signal?: AbortSignal): Promise<boolean>;
  read?(row: DeliveryExport): Promise<Uint8Array>;
}
export function createDeliveryExportApplication(ports: {
  task: { execute(input: unknown): TaskResponse };
  store: DeliveryExportStorePort;
  files: DeliveryExportFilesPort;
  configuration?: { resolve(style: ExportStyle): Promise<ExportConfiguration> };
  render(
    snapshot: DeliverySnapshot,
    state: number[],
    format: DeliveryExportFormat,
    signal?: AbortSignal,
    converter?: DeliveryExport['converter'],
    configuration?: ExportConfiguration,
  ): Promise<Uint8Array>;
  hash(bytes: Uint8Array): string;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  const active = new Map<
    string,
    { request: Request; controller: AbortController; promise: Promise<TaskResponse> }
  >();
  const success = (extra: object = {}): TaskResponse => ({
    ok: true,
    tasks: [],
    state: null,
    receipt: null,
    ...extra,
  });
  const failure = (
    code: 'WRITE_FAILED' | 'READ_FAILED' | 'CONFLICT' | 'CANCELLED',
    message: string,
  ): TaskResponse => ({ ok: false, code, message });
  const same = (a: Request, b: Request) => {
    const { request_id: x, ...left } = a,
      { request_id: y, ...right } = b;
    void x;
    void y;
    return JSON.stringify(left) === JSON.stringify(right);
  };
  function fixed(request: { task_id: string; document_id: string; snapshot_id: string }) {
    return ports.task.execute({
      protocol_version: 1,
      operation: 'read_snapshot',
      task_id: request.task_id,
      document_id: request.document_id,
      snapshot_id: request.snapshot_id,
    });
  }
  async function execute(input: unknown, signal?: AbortSignal): Promise<TaskResponse> {
    if (signal?.aborted) return failure('CANCELLED', '窗口已失效，未执行排队中的操作。');
    const parsed = taskRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: '交付请求无效。' };
    const request = parsed.data;
    if (
      request.operation !== 'export_snapshot' &&
      request.operation !== 'open_export' &&
      request.operation !== 'read_export' &&
      request.operation !== 'save_export' &&
      request.operation !== 'preview_export'
    )
      return ports.task.execute(request);
    const format = request.format ?? 'docx',
      label = format === 'pdf' ? 'PDF' : 'Word';
    try {
      const original = fixed(request);
      if (!original.ok) return original;
      const snapshot = original.snapshots?.[0];
      if (!snapshot || !original.state) throw new Error('Missing fixed snapshot');
      signal?.throwIfAborted();
      if (request.operation === 'export_snapshot') {
        // 先核原请求摘要和已落盘字节；已保存产物的恢复不依赖当前字体仍然可用。
        const prior = ports.store.readIntent?.(request);
        if (prior) {
          const placed = await ports.files.verify(prior);
          signal?.throwIfAborted();
          if (placed) return ports.store.complete(request, prior);
          if (prior.status === 'ready')
            return failure('READ_FAILED', `已保存${label}文件缺失，未重新生成或覆盖，请检查存储。`);
        }
      }
      const style = 'export_style' in request ? request.export_style : undefined;
      if (style && !ports.configuration)
        return { ok: false, code: 'INVALID_REQUEST', message: '此版本尚未接通可配置导出。' };
      const configuration = style
        ? exportConfigurationSchema.parse(await ports.configuration!.resolve(style))
        : undefined;
      signal?.throwIfAborted();
      if (request.operation === 'read_export') {
        const row = ports.store.read(snapshot.id, format, undefined, configuration?.fingerprint);
        if (row?.status === 'ready' && !(await ports.files.verify(row)))
          return failure(
            'READ_FAILED',
            `已保存${label}文件缺失，未重新生成或覆盖，请保留记录并检查存储。`,
          );
        return success({
          exports: row ? [row] : [],
          ...(request.include_history
            ? { export_history: ports.store.list?.(snapshot.id, format) ?? [] }
            : {}),
        });
      }
      if (
        request.operation === 'open_export' ||
        request.operation === 'save_export' ||
        request.operation === 'preview_export'
      ) {
        const row = ports.store.read(snapshot.id, format, request.export_id);
        if (!row || row.id !== request.export_id || row.status !== 'ready')
          return failure('READ_FAILED', `所选${label}尚未确认保存。`);
        if (request.operation === 'preview_export') {
          if (!ports.files.read) throw new Error('Preview not available');
          return success({ exports: [row], export_data: await ports.files.read(row) });
        }
        if (request.operation === 'save_export') {
          if (!ports.files.save) throw new Error('Save not available');
          return success({ exports: [row], export_saved: await ports.files.save(row, signal) });
        }
        await ports.files.open(row, signal);
        return success({ exports: [row], export_opened: true });
      }
      let row = ports.store.reserve(request, configuration);
      const placed = await ports.files.verify(row);
      signal?.throwIfAborted();
      if (!placed) {
        if (row.status === 'ready')
          return failure('READ_FAILED', `已保存${label}文件缺失，未重新生成或覆盖，请检查存储。`);
        // 原键仍绑定原字体；资源变化不能让恢复中的旧身份悄悄生成另一份文件。
        if (row.configuration && row.configuration.fingerprint !== configuration?.fingerprint)
          throw new Error('EXPORT_FONT_CHANGED');
        const bytes = await ports.render(
          snapshot,
          original.state,
          format,
          signal,
          row.converter,
          row.configuration,
        );
        signal?.throwIfAborted();
        if (!bytes.length || bytes.length > 20_000_000) throw new Error('Export size limit');
        row = ports.store.stage(row, ports.hash(bytes), bytes.length);
        await ports.files.put(row, bytes, signal);
      }
      signal?.throwIfAborted();
      if (!(await ports.files.verify(row))) throw new Error('Export not durable');
      signal?.throwIfAborted();
      // 此后的同步事务不可被取消插入；一旦ACK已提交，迟到的取消只能查询原成功回执。
      return ports.store.complete(request, row);
    } catch (error) {
      if (signal?.aborted)
        return failure('CANCELLED', `${label}生成已取消，原快照与已保存文件保留。`);
      if (
        error instanceof Error &&
        [
          'UNSUPPORTED_WORD_CONTENT',
          'UNSUPPORTED_PDF_CONTENT',
          'PDF_FONT_UNAVAILABLE',
          'PDF_GLYPH_UNAVAILABLE',
          'EXPORT_FONT_CHANGED',
        ].includes(error.message)
      )
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message:
            error.message === 'PDF_GLYPH_UNAVAILABLE'
              ? '所选字体不支持文稿中的部分字符，未生成 PDF。请保留原稿并检查稀有字或符号。'
              : error.message === 'EXPORT_FONT_CHANGED'
                ? '字体资源已变化，未按旧配置重建；请保留原产物并发起新的导出。'
                : error.message === 'PDF_FONT_UNAVAILABLE'
                  ? '本机中文字体不可用，未保存PDF；请检查字体后重试。'
                  : `此固定版本含暂不支持的${label}格式或超出生成规模限制，未生成交付文件；请保留快照并核对工作稿。`,
        };
      if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT')
        return failure('CONFLICT', '该提交身份与原导出不同，请核对原提交。');
      return failure(
        request.operation === 'export_snapshot' ? 'WRITE_FAILED' : 'READ_FAILED',
        request.operation === 'save_export'
          ? `${label}副本未能另存；已有目标和受管产物保持不变，请选择新文件名或检查存储。`
          : request.operation === 'open_export'
            ? `${label}工作副本未能打开；固定产物保持不变，请检查文件或关联应用。`
            : `未能确认${label}导出。原快照与请求已保留；可核对原提交后重试。`,
      );
    }
  }
  return {
    execute(input: unknown, signal?: AbortSignal): Promise<TaskResponse> {
      if (signal?.aborted)
        return Promise.resolve(failure('CANCELLED', '窗口已失效，未执行此操作。'));
      const parsed = taskRequestSchema.safeParse(input);
      if (parsed.success && parsed.data.operation === 'cancel_export') {
        const request = parsed.data,
          original = fixed(request);
        if (!original.ok) return Promise.resolve(original);
        // 已提交ACK优先于取消：重放中的旧请求不能把已保存产物伪装成取消成功。
        const receipt = ports.task.execute({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: request.idempotency_key,
        });
        if (receipt.ok) {
          if (
            receipt.receipt !== request.idempotency_key ||
            receipt.exports?.[0]?.snapshot_id !== request.snapshot_id ||
            receipt.exports[0].status !== 'ready'
          )
            return Promise.resolve(failure('CONFLICT', '该提交回执不属于当前版本的导出。'));
          return Promise.resolve(receipt);
        }
        if (receipt.code !== 'NOT_FOUND') return Promise.resolve(receipt);
        const job = active.get(request.idempotency_key);
        if (job) {
          if (
            job.request.task_id !== request.task_id ||
            job.request.document_id !== request.document_id ||
            job.request.snapshot_id !== request.snapshot_id
          )
            return Promise.resolve(failure('CONFLICT', '该取消身份不属于当前固定版本。'));
          job.controller.abort();
          return job.promise;
        }
        return Promise.resolve(receipt);
      }
      if (
        parsed.success &&
        ![
          'export_snapshot',
          'read_export',
          'open_export',
          'save_export',
          'preview_export',
        ].includes(parsed.data.operation)
      )
        return Promise.resolve(ports.task.execute(input));
      if (parsed.success && parsed.data.operation === 'export_snapshot') {
        const request = parsed.data,
          previous = active.get(request.idempotency_key);
        if (previous)
          return same(previous.request, request)
            ? previous.promise
            : Promise.resolve(failure('CONFLICT', '该提交身份正在执行其他导出，请核对原提交。'));
        const controller = new AbortController();
        const activeSignal = signal
          ? AbortSignal.any([controller.signal, signal])
          : controller.signal;
        const promise = tail
          .then(() => execute(request, activeSignal))
          .finally(() => active.delete(request.idempotency_key));
        active.set(request.idempotency_key, { request, controller, promise });
        tail = promise.catch(() => undefined);
        return promise;
      }
      const result = tail.then(() => execute(input, signal));
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
