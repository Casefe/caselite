import {
  MATERIAL_BATCH_MAX_BYTES,
  MATERIAL_BATCH_MAX_FILES,
  materialBatchRequestSchema,
  type MaterialBatch,
  type MaterialBatchResponse,
  type MaterialScope,
} from '@caselite/contracts';
import type {
  createMaterialApplication,
  MaterialStage,
  MaterialFileIdentity,
} from './material-application';

export type MaterialBatchEntry = {
  path?: string;
  relative_name: string;
  bytes: number;
  message?: string;
  expected?: MaterialFileIdentity;
};
export interface MaterialBatchStorePort {
  activeBatch(scope: MaterialScope): MaterialBatch | undefined;
  putBatch(batch: MaterialBatch): void;
  stage(token: string): MaterialStage | undefined;
  pending(scope: MaterialScope): MaterialStage | undefined;
  task(scope: MaterialScope): string | undefined;
}
class MaterialBatchStepError extends Error {}
export function createMaterialBatchApplication(ports: {
  store: MaterialBatchStorePort;
  materials: ReturnType<typeof createMaterialApplication>;
  id(): string;
  taskExists(id: string): boolean;
  validatePath(path: string): Promise<void>;
}) {
  const { store, materials } = ports;
  // 原选择路径只在本机内存中作为本轮能力保存；重启后需重新选择未暂存项。
  const paths = new Map<string, MaterialBatchEntry>();
  let running: string | undefined;
  let paused = false;
  const fail = (code: string, message: string): MaterialBatchResponse => ({
    ok: false,
    code,
    message,
  });
  const allowed = (scope: MaterialScope) => scope === 'home' || ports.taskExists(scope);
  function current(scope: MaterialScope) {
    const batch = store.activeBatch(scope);
    if (!batch) return;
    let changed = false;
    for (const item of batch.items) {
      const staged = store.stage(item.token);
      if (staged?.scope !== scope || staged.batch_id !== batch.id) continue;
      if (staged.state === 'committed' && !staged.restored_source_id) {
        if (item.state !== 'saved' || !batch.task_id) changed = true;
        item.state = 'saved';
        item.message = '原件已保存';
        batch.task_id ??= staged.task_id;
      } else if (staged.state === 'staged' && item.state === 'pending') {
        item.state = 'staged';
        changed = true;
      }
    }
    if (batch.state === 'running' && running !== batch.id) {
      batch.state = 'paused';
      changed = true;
    }
    if (changed) store.putBatch(batch);
    return batch;
  }
  const result = (scope: MaterialScope): MaterialBatchResponse => ({
    ok: true,
    batch: current(scope) ?? null,
  });
  return {
    async create(
      scope: MaterialScope,
      title: string,
      entries: MaterialBatchEntry[],
    ): Promise<MaterialBatchResponse> {
      if (!allowed(scope)) return fail('SCOPE', '任务不存在。');
      if (current(scope) || store.pending(scope))
        return fail('BUSY', '请先处理当前未完成的材料导入。');
      if (
        !entries.length ||
        entries.length > MATERIAL_BATCH_MAX_FILES ||
        entries.filter((item) => !item.message).reduce((sum, item) => sum + item.bytes, 0) >
          MATERIAL_BATCH_MAX_BYTES
      )
        return fail('LIMIT', '每批最多16项、合计320 MB，请缩小选择范围。');
      const batch: MaterialBatch = {
        id: ports.id(),
        scope,
        task_id: store.task(scope),
        title,
        state: 'ready',
        items: entries.map((entry) => {
          const token = ports.id();
          if (entry.path && !entry.message) paths.set(token, entry);
          return {
            token,
            relative_name: entry.relative_name,
            bytes: entry.bytes,
            state: entry.message ? 'skipped' : 'pending',
            message: entry.message ?? '待保存',
          };
        }),
      };
      store.putBatch(batch);
      return result(scope);
    },
    async execute(input: unknown): Promise<MaterialBatchResponse> {
      const parsed = materialBatchRequestSchema.safeParse(input);
      if (!parsed.success) return fail('INVALID_REQUEST', '批次请求无效。');
      const r = parsed.data;
      if (!allowed(r.scope)) return fail('SCOPE', '任务不存在。');
      const batch = current(r.scope);
      if (r.operation === 'list') return result(r.scope);
      if (r.operation === 'pick') return fail('INVALID_REQUEST', '请通过桌面文件选择器添加材料。');
      if (!batch || batch.id !== r.batch_id) return fail('NOT_FOUND', '批次不存在或范围已变化。');
      if (r.operation === 'pause') {
        if (running === batch.id) paused = true;
        return result(r.scope);
      }
      if (running) return fail('BUSY', '请等待当前文件完成或暂停批次。');
      if (batch.task_id && store.task(r.scope) !== batch.task_id)
        return fail('SCOPE', '目标任务已变化，未继续导入。');
      if (
        r.operation === 'dismiss' &&
        batch.items.some((item) => !['saved', 'skipped', 'cancelled'].includes(item.state))
      )
        return fail('PENDING', '仍有未完成项，请继续保存或移除未完成项。');
      running = batch.id;
      paused = false;
      try {
        if (r.operation === 'discard' || r.operation === 'dismiss') {
          for (const item of batch.items) {
            if (!['saved', 'skipped', 'cancelled'].includes(item.state)) {
              const discarded = await materials.discardBatchStage(r.scope, batch.id, item.token);
              if (!discarded.ok) return fail(discarded.code, discarded.message);
              item.state = 'cancelled';
              item.message = '已移除未完成导入';
            }
            paths.delete(item.token);
          }
          batch.state = 'dismissed';
          store.putBatch(batch);
          return result(r.scope);
        }
        batch.state = 'running';
        store.putBatch(batch);
        for (const item of batch.items) {
          if (paused) break;
          if (['saved', 'skipped', 'cancelled'].includes(item.state)) continue;
          try {
            if (!allowed(r.scope) || (batch.task_id && store.task(r.scope) !== batch.task_id))
              throw new MaterialBatchStepError('目标任务已变化，未保存。');
            if (!store.stage(item.token)) {
              const entry = paths.get(item.token);
              if (!entry?.path)
                throw new MaterialBatchStepError(
                  '尚未暂存，请移除未完成项后重新选择原文件；已保存项保留。',
                );
              try {
                await ports.validatePath(entry.path);
              } catch {
                throw new MaterialBatchStepError('文件位置或权限已变化，请重新选择原文件。');
              }
              const staged = await materials.stage(entry.path, r.scope, {
                id: batch.id,
                token: item.token,
                expected: entry.expected,
              });
              if (!staged.ok) throw new MaterialBatchStepError(staged.message);
              item.state = 'staged';
              store.putBatch(batch);
            }
            const saved = await materials.execute({
              protocol_version: 1,
              scope: r.scope,
              operation: 'commit',
              token: item.token,
            });
            if (!saved.ok) throw new MaterialBatchStepError(saved.message);
            const source = saved.materials.find((source) => source.id === item.token);
            if (!source) throw new MaterialBatchStepError('保存回执尚未确认，请重试原项核对。');
            batch.task_id ??= source.task_id;
            item.state = 'saved';
            item.message = '原件已保存';
            paths.delete(item.token);
          } catch (error) {
            item.state = 'failed';
            item.message =
              error instanceof MaterialBatchStepError
                ? error.message
                : '保存未完成，请核对原项后重试。';
          }
          // 每项独立确认；后项失败不能撤销前项原件，未知回执沿原token重放。
          store.putBatch(batch);
        }
        batch.state = batch.items.some((item) =>
          ['pending', 'staged', 'failed'].includes(item.state),
        )
          ? 'paused'
          : 'finished';
        store.putBatch(batch);
        return result(r.scope);
      } finally {
        running = undefined;
      }
    },
  };
}
