import {
  CREATION_ATTACHMENT_LIMIT,
  type CreationDraftRecord,
  type MaterialRequest,
  type MaterialResponse,
} from '@caselite/contracts';
import type { MaterialFilesPort, MaterialStage, CreationDraftStorePort } from './material-ports';

export function createMaterialCreationDrafts(ports: {
  store: Partial<CreationDraftStorePort> & {
    stage(id: string): MaterialStage | undefined;
    putStage(file: MaterialStage): void;
  };
  files: MaterialFilesPort;
  taskExists(id: string): boolean;
  scopeWritable?(id: string): boolean;
}) {
  const { store, files } = ports;
  const find = (id: string) => store.creationDraft?.(id);
  const fail = (message: string): MaterialResponse => ({
    ok: false,
    code: 'CREATION_DRAFT',
    message,
  });
  const result = (draft?: CreationDraftRecord, warning?: string): MaterialResponse => ({
    ok: true,
    materials: [],
    ...(warning ? { creation_warning: warning } : {}),
    creation_draft: draft
      ? {
          ...draft,
          files: draft.tokens.map((token) => {
            const file = store.stage(token);
            if (!file || file.state === 'cancelled' || file.scope !== (draft.task_id ?? draft.id))
              throw Error('Attachment draft identity mismatch');
            return { token, name: file.name, bytes: file.bytes, saved: file.state === 'committed' };
          }),
        }
      : null,
  });
  let locked = false;
  return {
    find,
    async stage(path: string, scope: string): Promise<MaterialResponse> {
      const draft = find(scope);
      if (!draft || draft.state !== 'open' || locked) return fail('请先完成当前附件操作。');
      if (draft.tokens.length >= CREATION_ATTACHMENT_LIMIT)
        return fail(`最多添加 ${CREATION_ATTACHMENT_LIMIT} 份附件。`);
      locked = true;
      try {
        const file = await files.stage(path, scope);
        const current = find(scope);
        if (!current || current.state !== 'open') {
          await files.discard(file.token);
          return fail('创建草稿已关闭，请重新选择。');
        }
        // 文件字节沿原 Port 暂存；token 清单和暂存登记由同一 SQLite 事务更新。
        store.putCreationDraft!(
          { ...current, tokens: [...current.tokens, file.token] },
          { ...file, creation_draft_id: scope },
        );
        return result(find(scope));
      } catch {
        return fail('附件未暂存，请核对文件格式、大小和本机存储后重试。');
      } finally {
        locked = false;
      }
    },
    async execute(request: MaterialRequest): Promise<MaterialResponse> {
      if (!store.putCreationDraft || !store.bindCreationDraft || !store.pendingCreationDraft)
        return fail('此版本尚未接入创建前附件。');
      if (!('scope' in request)) return fail('创建草稿范围无效。');
      if (request.operation === 'creation_resume') return result(store.pendingCreationDraft());
      if (request.scope === 'home') return fail('创建草稿不能使用首页材料范围。');
      if (request.operation === 'creation_open') {
        const existing = find(request.scope);
        if (existing) return result(existing);
        if (ports.taskExists(request.scope) || store.stage(request.scope))
          return fail('草稿身份不可复用。');
        const pending = store.pendingCreationDraft();
        if (pending) return result(pending);
        const draft: CreationDraftRecord = { id: request.scope, state: 'open', tokens: [] };
        try {
          store.putCreationDraft(draft);
        } catch {
          return fail('草稿身份已被占用，请重新选择。');
        }
        return result(draft);
      }
      const draft = find(request.scope);
      if (!draft || draft.state === 'discarded') return fail('创建草稿已不存在或已取消。');
      if (request.operation === 'creation_read') return result(draft);
      if (locked) return fail('正在处理附件，请稍后核对。');
      locked = true;
      let cleanupWarning: string | undefined;
      try {
        if (request.operation === 'creation_bind') {
          if (draft.state === 'bound' || draft.state === 'finished')
            return draft.task_id === request.task_id
              ? result(draft)
              : fail('附件已属于另一任务，不能重新绑定。');
          return fail('附件须由原任务创建事务绑定，请核对原创建结果。');
        } else if (request.operation === 'creation_finish') {
          if (
            !draft.task_id ||
            draft.tokens.some((token) => store.stage(token)?.state !== 'committed')
          )
            return fail('仍有附件未保存，请继续原提交。');
          store.putCreationDraft({ ...draft, state: 'finished' });
        } else if (
          request.operation === 'creation_remove' ||
          request.operation === 'creation_discard'
        ) {
          if (draft.state !== 'open') return fail('任务已创建，请继续保存附件，不能取消原任务。');
          const tokens = request.operation === 'creation_remove' ? [request.token] : draft.tokens;
          if (tokens.some((token) => !draft.tokens.includes(token)))
            return fail('附件不属于当前创建草稿。');
          for (const token of tokens) {
            const file = store.stage(token);
            if (!file || file.scope !== draft.id || file.state === 'committed')
              return fail('附件状态已变化，暂存已保留。');
            // 先原子撤销可提交身份，再清理 staging；清理失败只留可识别残留，不留下缺字节的有效附件。
            store.putCreationDraft(
              { ...find(draft.id)!, tokens: find(draft.id)!.tokens.filter((id) => id !== token) },
              { ...file, state: 'cancelled' },
            );
            try {
              await files.discard(token);
            } catch {
              cleanupWarning = '附件已移除，未提交暂存的清理尚未完成；原件不受影响。';
            }
          }
          if (request.operation === 'creation_discard')
            store.putCreationDraft({ ...draft, tokens: [], state: 'discarded' });
        } else return fail('创建草稿操作无效。');
        return result(find(draft.id), cleanupWarning);
      } catch {
        return fail('附件操作未完成，输入与未确认暂存保留，请核对原草稿。');
      } finally {
        locked = false;
      }
    },
  };
}
