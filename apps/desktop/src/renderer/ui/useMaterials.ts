import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  Material,
  MaterialScope,
  MaterialRequest,
  MaterialPreview,
  AgentModel,
  AgentRun,
} from '../../preload/caselite-api';

// 这里只存输入框选择，原件与版本始终由 Application/SQLite 拥有。
// 面板卸载不能丢失正在导入的附件，或让下一次发送绕过它。
type DraftFiles = {
  ids: Set<string>;
  sections: Map<string, number[]>;
  upload?: Promise<void>;
  staged?: { token: string; name: string; bytes: number; restore_source_id?: string };
  error: string;
  importError?: string;
  name?: string;
  selectImport?: boolean;
  items: Material[];
  revision: number;
  listeners: Set<() => void>;
  stopPolling?: () => void;
  generation: number;
  loaded: boolean;
  readError: string;
};
export function isDocx(name: string) {
  return /\.docx$/i.test(name);
}
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
  if (!drafts.has(scope))
    drafts.set(scope, {
      ids: new Set(),
      sections: new Map(),
      error: '',
      items: [],
      revision: 0,
      listeners: new Set(),
      generation: 0,
      loaded: false,
      readError: '',
    });
  return drafts.get(scope)!;
}
function notify(draft: DraftFiles) {
  draft.revision++;
  draft.listeners.forEach((listener) => listener());
}
function subscribeMaterials(scope: MaterialScope, listener: () => void) {
  const draft = getDraft(scope);
  draft.listeners.add(listener);
  if (!draft.stopPolling) {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const generation = draft.generation;
      try {
        const result = await window.caselite.material({
          protocol_version: 1,
          operation: 'list',
          scope,
        });
        if (stopped || generation !== draft.generation) return;
        if (!result.ok) throw new Error(result.message);
        draft.items = result.materials;
        if (!draft.upload) draft.staged = result.staged ?? undefined;
        draft.loaded = true;
        draft.readError = '';
        notify(draft);
      } catch (error) {
        if (stopped || generation !== draft.generation) return;
        draft.readError = error instanceof Error ? error.message : '材料列表暂不可读取。';
        notify(draft);
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 500);
      }
    }
    draft.stopPolling = () => {
      stopped = true;
      clearTimeout(timer);
    };
    void poll();
  }
  return () => {
    draft.listeners.delete(listener);
    if (!draft.listeners.size) {
      draft.stopPolling?.();
      draft.stopPolling = undefined;
      // 查询只是投影；重新进入时先按原 scope 回读，不显示上次授权范围的缓存。
      draft.items = [];
      draft.loaded = false;
      draft.readError = '';
    }
  };
}
export function useMaterials(scope: MaterialScope, enabled = true, selectImports = true) {
  const draft = getDraft(scope);
  const available = enabled && typeof window.caselite?.material === 'function';
  const subscribe = useCallback(
    (listener: () => void) => (available ? subscribeMaterials(scope, listener) : () => {}),
    [scope, available],
  );
  const snapshot = useCallback(() => getDraft(scope).revision, [scope]);
  useSyncExternalStore(subscribe, snapshot);
  const items = draft.items;
  const context = useMemo(() => ({ scope }), [scope]);
  const [reading, setReading] = useState<{
    context: { scope: string };
    id: string;
    name: string;
    task: string;
    bytes: Uint8Array;
    material?: Material;
  } | null>(null);
  const [pendingContext, setPendingContext] = useState<typeof context | null>(null);
  const [copyDiagnostic, setCopyDiagnostic] = useState<{
    context: typeof context;
    message: string;
  } | null>(null);
  const [readingDiagnostic, setReadingDiagnostic] = useState<{
    context: typeof context;
    message: string;
  } | null>(null);
  const readPending = pendingContext === context;
  const copyError = copyDiagnostic?.context === context ? copyDiagnostic.message : '';
  const readingError = readingDiagnostic?.context === context ? readingDiagnostic.message : '';
  const setCopyError = (message: string) => setCopyDiagnostic({ context, message });
  const setReadingError = (message: string) => setReadingDiagnostic({ context, message });
  const alive = useRef(true);
  const readSequence = useRef(0);
  const copySequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    const sequence = readSequence;
    const copy = copySequence;
    return () => {
      alive.current = false;
      sequence.current++;
      copy.current++;
    };
  }, [context]);
  const render = () => notify(draft);
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
    if (
      readScope === scope &&
      request.operation !== 'save_original' &&
      request.operation !== 'docx_semantic_preview' &&
      request.operation !== 'read'
    ) {
      // 动作回执优先于先前发出的轮询；异步旧列表不能覆盖刚保存的固定来源。
      draft.generation++;
      draft.items = result.materials;
      draft.loaded = true;
      draft.readError = '';
      notify(draft);
    }
    return result;
  }
  async function importFile(file?: File, retry = false) {
    if (draft.upload) return draft.upload;
    setReadingError('');
    if (!retry && draft.staged) {
      setReadingError('上次附件尚未完成，请重试或移除后添加。');
      return;
    }
    draft.error = '';
    draft.importError = '';
    draft.name = file?.name ?? draft.staged?.name;
    draft.selectImport ??= selectImports;
    const work = (async () => {
      try {
        let staged = draft.staged;
        if (!staged) {
          const result = await (file
            ? window.caselite.dropPdf(file, scope)
            : window.caselite.pickPdf(scope));
          if (!result.ok) throw new Error(result.message);
          staged = result.staged ?? undefined;
          if (!staged) {
            draft.selectImport = undefined;
            return;
          }
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
        if (!staged.restore_source_id && draft.selectImport) draft.ids.add(staged.token);
        draft.selectImport = undefined;
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
    scope,
    available,
    items,
    loaded: draft.loaded,
    readError: draft.readError,
    readPending,
    sections: draft.sections,
    toggleSection(id: string, page: number) {
      const selected = draft.sections.get(id) ?? [];
      draft.sections.set(
        id,
        selected.includes(page) ? selected.filter((n) => n !== page) : [...selected, page],
      );
      render();
    },
    async saveOriginal(id: string, task: string) {
      const sequence = ++copySequence.current;
      setCopyError('');
      try {
        await command(
          { operation: 'save_original', source_id: id } as Omit<
            MaterialRequest,
            'scope' | 'protocol_version'
          >,
          task,
        );
      } catch (error) {
        if (!alive.current || sequence !== copySequence.current) return;
        setCopyError(error instanceof Error ? error.message : '原件副本未保存。');
      }
    },
    copyError,
    reading: reading?.context === context ? reading : null,
    busy: Boolean(draft.upload),
    staged: !selectImports || draft.selectImport !== false ? draft.staged : undefined,
    uploadingName: !selectImports || draft.selectImport !== false ? draft.name : undefined,
    error: (!selectImports || draft.selectImport !== false ? draft.error : '') || readingError,
    selected: Object.fromEntries([...draft.ids].map((id) => [id, ''])),
    async prepareRecovery(attachments: NonNullable<AgentRun['attachments']>) {
      const empty = () => !draft.ids.size && !draft.upload && !draft.staged && !draft.importError;
      if (!empty()) throw new Error('请先处理当前附件，再恢复上轮输入。');
      if (attachments.length && !available) throw new Error('当前范围不能恢复附件。');
      const result = available ? await command({ operation: 'list' }) : undefined;
      if (result?.staged) throw new Error('请先处理当前附件，再恢复上轮输入。');
      const restored = new Map<string, number[]>();
      for (const attachment of attachments) {
        const item = result?.materials.find((value) => value.id === attachment.source_id);
        if (
          !item ||
          item.task_id !== attachment.task_id ||
          !item.page_count ||
          restored.has(item.id) ||
          !attachment.pages.length ||
          attachment.pages.some(
            (page) => !Number.isInteger(page) || page < 1 || page > item.page_count!,
          )
        )
          throw new Error('上轮附件或选段已不可用；未恢复，请重新核对材料。');
        restored.set(item.id, [...new Set(attachment.pages)]);
      }
      return () => {
        // 读取期间用户可能新增附件；只恢复原固定来源和原选段，不覆盖新选择。
        if (!alive.current || !empty()) throw new Error('输入已变化，未恢复上轮附件。');
        for (const [id, pages] of restored) {
          draft.ids.add(id);
          draft.sections.set(id, pages);
        }
        draft.error = '';
        render();
      };
    },
    clearReading() {
      setReadingError('');
      copySequence.current++;
      readSequence.current++;
      setPendingContext(null);
      setReading(null);
      setCopyError('');
    },
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
        draft.selectImport = undefined;
        setReadingError('');
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
      else {
        draft.ids.delete(id);
        draft.sections.delete(id);
      }
      render();
    },
    acknowledge(ids: string[]) {
      ids.forEach((id) => {
        draft.ids.delete(id);
        draft.sections.delete(id);
      });
      render();
    },
    async localText(item: Material) {
      try {
        const docx = isDocx(item.name);
        await command(
          {
            operation: 'process',
            source_id: item.id,
            ocr: !docx,
            force: item.status === 'ready',
          } as Omit<MaterialRequest, 'scope' | 'protocol_version'>,
          docx ? item.task_id : scope,
        );
        if (docx) {
          draft.error = draft.importError ?? '';
          render();
        }
      } catch (error) {
        draft.error = error instanceof Error ? error.message : '暂不能提取文字。';
        render();
      }
    },
    async stopLocalText(item: Material) {
      try {
        await command(
          { operation: 'cancel', source_id: item.id } as Omit<
            MaterialRequest,
            'scope' | 'protocol_version'
          >,
          isDocx(item.name) ? item.task_id : scope,
        );
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
      const sequence = ++readSequence.current;
      setPendingContext(context);
      setReadingError('');
      setReading(null);
      setCopyError('');
      const expected = items.find((item) => item.id === id);
      try {
        const result = await command(
          { operation: 'read', source_id: id } as Omit<
            MaterialRequest,
            'scope' | 'protocol_version'
          >,
          task,
        );
        if (!alive.current || sequence !== readSequence.current) return;
        const current = result.materials.find((item) => item.id === id);
        if (
          !result.data ||
          !current ||
          current.task_id !== task ||
          (expected &&
            (expected.asset_version_id !== current.asset_version_id ||
              expected.sha256 !== current.sha256))
        )
          throw new Error('附件版本或归属已变化，请重新读取。');
        setReading({
          context,
          id,
          name,
          task,
          bytes: result.data,
          material: result.materials.find((item) => item.id === id),
        });
      } catch (error) {
        if (!alive.current || sequence !== readSequence.current) return;
        setReadingError(error instanceof Error ? error.message : '无法打开附件。');
      } finally {
        if (alive.current && sequence === readSequence.current) setPendingContext(null);
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
      // 只有聊天附件属于这次发送。属性栏另存的材料不会拖住或阻断原来的 AI 输入。
      await wait((draft.selectImport !== false ? draft.upload : undefined) ?? Promise.resolve());
      cancelled();
      if (draft.selectImport !== false && (draft.error || draft.staged))
        throw new Error(draft.error || '附件尚未导入完成，请重试。');
      const ids = [...draft.ids];
      if (!ids.length) return undefined;
      const result = await wait(command({ operation: 'list' }));
      cancelled();
      const selected = ids.map((id) => {
        const item = result.materials.find((material) => material.id === id);
        if (!item || !item.page_count) throw new Error('附件尚不可用，本轮未发送。');
        const pages =
          draft.sections.get(id) ??
          (isDocx(item.name) ? undefined : pageRange('', item.page_count));
        if (!pages?.length) throw new Error('请先打开 Word 附件并选择本轮使用的段落。');
        return { source_id: id, pages };
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
