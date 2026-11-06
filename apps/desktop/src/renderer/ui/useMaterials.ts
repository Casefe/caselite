import { useEffect, useRef, useState } from 'react';
import type {
  Material,
  MaterialScope,
  MaterialRequest,
  MaterialPreview,
  AgentModel,
} from '../../preload/caselite-api';

// 这里只存输入框选择，原件与版本始终由 Application/SQLite 拥有。
// 面板卸载不能丢失正在导入的附件，或让下一次发送绕过它。
type DraftFiles = {
  ids: Set<string>;
  upload?: Promise<void>;
  staged?: { token: string; name: string; bytes: number; restore_source_id?: string };
  error: string;
  importError?: string;
  name?: string;
};
const drafts = new Map<string, DraftFiles>();
export function pageRange(value: string, count: number): number[] | null {
  if (!value.trim()) return Array.from({ length: count }, (_, i) => i + 1);
  const result = new Set<number>();
  for (const part of value.split(/[,，]/)) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]),
      to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > count) return null;
    for (let n = from; n <= to; n++) result.add(n);
  }
  return [...result].sort((a, b) => a - b);
}
function getDraft(scope: string) {
  if (!drafts.has(scope)) drafts.set(scope, { ids: new Set(), error: '' });
  return drafts.get(scope)!;
}
export function useMaterials(scope: MaterialScope) {
  const draft = getDraft(scope);
  const [items, setItems] = useState<Material[]>([]);
  const [, update] = useState(0);
  const [reading, setReading] = useState<{ id: string; name: string; bytes: Uint8Array } | null>(
    null,
  );
  const alive = useRef(true);
  const available = typeof window.caselite?.material === 'function';
  const render = () => {
    if (alive.current) update((n) => n + 1);
  };
  async function command(
    request: Omit<MaterialRequest, 'protocol_version' | 'scope'>,
    readScope = scope,
  ) {
    const result = await window.caselite.material({
      protocol_version: 1,
      scope: readScope,
      ...request,
    } as MaterialRequest);
    if (!result.ok) throw new Error(result.message);
    if (alive.current && readScope === scope) setItems(result.materials);
    return result;
  }
  useEffect(() => {
    const draft = getDraft(scope);
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!available) return;
      try {
        const result = await window.caselite.material({
          protocol_version: 1,
          operation: 'list',
          scope,
        });
        if (stopped) return;
        if (result.ok) {
          setItems(result.materials);
          if (!draft.upload && result.staged) draft.staged = result.staged;
          update((n) => n + 1);
        }
      } catch {
        /* 轮询失败不覆盖输入或导入回执；发送时重新核对。 */
      }
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    }
    void poll();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [scope, available]);
  async function importFile(file?: File, retry = false) {
    if (draft.upload) return draft.upload;
    draft.error = '';
    draft.importError = '';
    draft.name = file?.name ?? draft.staged?.name;
    const work = (async () => {
      try {
        let staged = draft.staged;
        if (!retry && staged) throw new Error('上次附件尚未完成，请重试或移除后添加。');
        if (!staged) {
          const result = await (file
            ? window.caselite.dropPdf(file, scope)
            : window.caselite.pickPdf(scope));
          if (!result.ok) throw new Error(result.message);
          staged = result.staged ?? undefined;
          if (!staged) return;
          draft.staged = staged;
          draft.name = staged.name;
          render();
        }
        const result = await command({
          operation: staged.restore_source_id ? 'restore' : 'commit',
          token: staged.token,
          ...(staged.restore_source_id ? { source_id: staged.restore_source_id } : {}),
        } as Omit<MaterialRequest, 'scope' | 'protocol_version'>);
        if (
          !result.materials.some((item) => item.id === (staged!.restore_source_id ?? staged!.token))
        )
          throw new Error('尚未确认附件导入，请重试原附件。');
        if (!staged.restore_source_id) draft.ids.add(staged.token);
        draft.staged = undefined;
        window.dispatchEvent(new Event('caselite:material-task-saved'));
      } catch (error) {
        draft.error = error instanceof Error ? error.message : '附件未导入，请重试。';
        draft.importError = draft.error;
      }
    })().finally(() => {
      draft.upload = undefined;
      draft.name = undefined;
      render();
    });
    draft.upload = work;
    render();
    return work;
  }
  return {
    available,
    items,
    reading,
    busy: Boolean(draft.upload),
    staged: draft.staged,
    uploadingName: draft.name,
    error: draft.error,
    selected: Object.fromEntries([...draft.ids].map((id) => [id, ''])),
    clearReading: () => setReading(null),
    async cancelPreparation() {
      await command({ operation: 'cancel_prepare' });
    },
    errorMessage(message: string) {
      draft.error = message;
      render();
    },
    add: (file?: File) => importFile(file),
    retry: () => importFile(undefined, true),
    async discard() {
      if (draft.upload) return;
      try {
        if (draft.staged)
          await command({ operation: 'discard', token: draft.staged.token } as Omit<
            MaterialRequest,
            'scope' | 'protocol_version'
          >);
        draft.staged = undefined;
        draft.error = '';
        draft.importError = '';
        render();
      } catch (error) {
        draft.error = String(error);
        render();
      }
    },
    select(id: string, selected: boolean) {
      if (selected) draft.ids.add(id);
      else draft.ids.delete(id);
      render();
    },
    acknowledge(ids: string[]) {
      ids.forEach((id) => draft.ids.delete(id));
      render();
    },
    async localText(item: Material) {
      try {
        await command({
          operation: 'process',
          source_id: item.id,
          ocr: true,
          force: item.status === 'ready',
        } as Omit<MaterialRequest, 'scope' | 'protocol_version'>);
      } catch (error) {
        draft.error = error instanceof Error ? error.message : '暂不能提取文字。';
        render();
      }
    },
    async stopLocalText(item: Material) {
      try {
        await command({ operation: 'cancel', source_id: item.id } as Omit<
          MaterialRequest,
          'scope' | 'protocol_version'
        >);
      } catch (error) {
        draft.error = error instanceof Error ? error.message : '取消结果尚未确认。';
        render();
      }
    },
    async restore(item: Material) {
      if (draft.upload || draft.staged || draft.importError) {
        draft.error = '请先完成或移除当前待添加附件。';
        render();
        return;
      }
      const work = (async () => {
        try {
          const picked = await window.caselite.pickPdf(scope);
          if (!picked.ok) throw new Error(picked.message);
          if (!picked.staged) return;
          draft.staged = { ...picked.staged, restore_source_id: item.id };
          const restored = await command({
            operation: 'restore',
            source_id: item.id,
            token: picked.staged.token,
          } as Omit<MaterialRequest, 'scope' | 'protocol_version'>);
          if (!restored.ok) throw new Error('恢复未完成');
          draft.error = '';
          draft.staged = undefined;
        } catch (error) {
          draft.error = error instanceof Error ? error.message : '恢复未完成。';
          render();
        }
      })().finally(() => {
        draft.upload = undefined;
        render();
      });
      draft.upload = work;
      render();
      await work;
    },
    async readReference(id: string, task: string, name: string) {
      try {
        const result = await command(
          { operation: 'read', source_id: id } as Omit<
            MaterialRequest,
            'scope' | 'protocol_version'
          >,
          task,
        );
        if (alive.current && result.data) setReading({ id, name, bytes: result.data });
        draft.error = draft.importError ?? '';
        render();
      } catch (error) {
        draft.error = error instanceof Error ? error.message : '无法打开附件。';
        render();
      }
    },
    async preview(
      instruction: string,
      model: AgentModel,
      signal?: AbortSignal,
    ): Promise<MaterialPreview | undefined> {
      // 点击发送时等待已开始的导入；UI在此期间锁定附件，但仍允许编辑下一轮文字。
      const cancelled = () => {
        if (signal?.aborted) throw new Error('已取消发送，附件和输入保留。');
      };
      const wait = async <T>(work: Promise<T>): Promise<T> => {
        cancelled();
        let stop = () => {};
        try {
          return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
              stop = () => reject(new Error('已取消发送，附件和输入保留。'));
              signal?.addEventListener('abort', stop, { once: true });
            }),
          ]);
        } finally {
          signal?.removeEventListener('abort', stop);
        }
      };
      await wait(draft.upload ?? Promise.resolve());
      cancelled();
      if (draft.error || draft.staged) throw new Error(draft.error || '附件尚未导入完成，请重试。');
      const ids = [...draft.ids];
      if (!ids.length) return undefined;
      const result = await wait(command({ operation: 'list' }));
      cancelled();
      const selected = ids.map((id) => {
        const item = result.materials.find((material) => material.id === id);
        if (!item || !item.page_count) throw new Error('附件尚不可用，本轮未发送。');
        return { source_id: id, pages: pageRange('', item.page_count)! };
      });
      const prepared = await wait(
        command({
          operation: 'preview',
          instruction,
          model,
          selected,
          automatic: true,
        } as Omit<MaterialRequest, 'scope' | 'protocol_version'>),
      );
      cancelled();
      if (!prepared.preview) throw new Error('未获得完整附件，本轮未发送。');
      return prepared.preview;
    },
  };
}
export type MaterialController = ReturnType<typeof useMaterials>;
