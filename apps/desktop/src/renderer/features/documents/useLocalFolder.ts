import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FolderEntry,
  FolderRequest,
  FolderResponse,
  FolderRoot,
  FolderScope,
  PersonalMaterial,
} from '../../../preload/caselite-api';

type Success = Extract<FolderResponse, { ok: true }>;
type Directory = { entries: FolderEntry[]; cursor: string | null };
type Pending = NonNullable<Success['pending']>[number];
type Saved = NonNullable<Success['saved']>[number];
type Opened = { source: PersonalMaterial; bytes: Uint8Array };

// 请求结果只属于发起时的视图；切换项目、卸载或刷新目录后不能覆盖新的选择。
export function useLocalFolder(enabled: boolean, projectId?: string) {
  const scope: FolderScope = projectId
    ? { kind: 'project', project_id: projectId }
    : { kind: 'workspace' };
  const scopeKey = projectId ?? 'workspace';
  const generation = useRef(0);
  const running = useRef(false);
  const uncertain = useRef(new Map<string, Pending>());
  const requestDirectories = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [root, setRoot] = useState<FolderRoot>();
  const [directories, setDirectories] = useState<Record<string, Directory>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [opened, setOpened] = useState<Opened>();
  const [resumeId, setResumeId] = useState<string>();
  const [message, setMessage] = useState('');
  const [state, setState] = useState<Success['state']>('not_configured');

  const invoke = useCallback(
    async (request: FolderRequest, epoch: number): Promise<FolderResponse | undefined> => {
      if (!window.caselite?.folder) {
        if (generation.current === epoch) setMessage('当前版本暂不支持本地文件夹。');
        return { ok: false, code: 'SOURCE_UNAVAILABLE', message: '当前版本暂不支持本地文件夹。' };
      }
      try {
        const result = await window.caselite.folder(request);
        if (generation.current !== epoch) return;
        if (!result.ok) setMessage(result.message);
        return result;
      } catch {
        if (generation.current === epoch)
          setMessage('暂时无法读取文件夹，请核对原操作结果后重试。');
      }
    },
    [],
  );
  const run = useCallback(
    async (fn: (epoch: number) => Promise<void>) => {
      if (running.current || !enabled) return;
      running.current = true;
      const epoch = generation.current;
      setBusy(true);
      setMessage('');
      try {
        await fn(epoch);
      } finally {
        if (generation.current === epoch) {
          running.current = false;
          setBusy(false);
        }
      }
    },
    [enabled],
  );
  const refreshLists = useCallback(
    async (epoch: number) => {
      const scoped: FolderScope = projectId
        ? { kind: 'project', project_id: projectId }
        : { kind: 'workspace' };
      const [p, s] = await Promise.all([
        invoke({ protocol_version: 1, operation: 'list_pending', scope: scoped }, epoch),
        invoke({ protocol_version: 1, operation: 'list_saved', scope: scoped }, epoch),
      ]);
      if (p?.ok)
        setPending([
          ...new Map([
            ...(p.pending ?? []).map((item) => [item.request_id, item] as const),
            ...uncertain.current.entries(),
          ]).values(),
        ]);
      if (s?.ok) setSaved(s.saved ?? []);
    },
    [invoke, projectId],
  );
  const loadDirectory = useCallback(
    async (rootId: string, entryId: string, epoch: number, cursor?: string) => {
      const scoped: FolderScope = projectId
        ? { kind: 'project', project_id: projectId }
        : { kind: 'workspace' };
      const result = await invoke(
        {
          protocol_version: 1,
          operation: 'list_directory',
          scope: scoped,
          root_id: rootId,
          entry_id: entryId,
          view_generation: epoch,
          ...(cursor ? { cursor } : {}),
        },
        epoch,
      );
      if (result?.ok && result.entries)
        setDirectories((old) => ({
          ...old,
          [entryId]: {
            entries: cursor
              ? [...(old[entryId]?.entries ?? []), ...result.entries!]
              : result.entries!,
            cursor: result.next_cursor ?? null,
          },
        }));
    },
    [invoke, projectId],
  );
  const restore = useCallback(
    () =>
      run(async (epoch) => {
        const scoped: FolderScope = projectId
          ? { kind: 'project', project_id: projectId }
          : { kind: 'workspace' };
        const result = await invoke(
          {
            protocol_version: 1,
            operation: 'restore_default',
            scope: scoped,
            view_generation: epoch,
          },
          epoch,
        );
        if (!result?.ok) return;
        setState(result.state);
        setRoot(result.root);
        setDirectories({});
        setExpanded(result.root ? [result.root.root_entry_id] : []);
        await refreshLists(epoch);
        if (result.root) await loadDirectory(result.root.root_id, result.root.root_entry_id, epoch);
      }),
    [run, invoke, projectId, refreshLists, loadDirectory],
  );
  useEffect(() => {
    generation.current += 1;
    running.current = false;
    const epoch = generation.current;
    queueMicrotask(() => {
      if (generation.current !== epoch) return;
      setBusy(false);
      setRoot(undefined);
      setDirectories({});
      setExpanded([]);
      setOpened(undefined);
      uncertain.current.clear();
      requestDirectories.current.clear();
      setPending([]);
      setSaved([]);
      setResumeId(undefined);
      setMessage('');
      setState('not_configured');
      if (enabled) restore();
    });
    return () => {
      generation.current += 1;
      running.current = false;
    };
  }, [enabled, scopeKey, restore]);

  const refreshCaptureDirectory = async (epoch: number, requestId: string, sourceName: string) => {
    if (!root) return;
    const known = requestDirectories.current.get(requestId);
    const parents =
      known && directories[known]
        ? [known]
        : Object.keys(directories).filter((id) =>
            directories[id].entries.some(
              (entry) => entry.kind === 'file' && entry.display_name === sourceName,
            ),
          );
    for (const parent of parents) {
      const previous = directories[parent];
      const fresh: FolderEntry[] = [];
      const visited = new Set<string>();
      let cursor: string | undefined;
      let next: string | null = null;
      for (let page = 0; page < previous.entries.length; page++) {
        const result = await invoke(
          {
            protocol_version: 1,
            operation: 'list_directory',
            scope,
            root_id: root.root_id,
            entry_id: parent,
            view_generation: epoch,
            ...(cursor ? { cursor } : {}),
          },
          epoch,
        );
        if (!result?.ok || !result.entries) return;
        fresh.push(...result.entries);
        next = result.next_cursor ?? null;
        if (fresh.length >= previous.entries.length || !next || visited.has(next)) break;
        visited.add(next);
        cursor = next;
      }
      if (generation.current !== epoch) return;
      const revisions = new Map(
        fresh.map((entry) => [entry.kind + '\0' + entry.display_name, entry.mapping_revision]),
      );
      if (
        fresh.length !== previous.entries.length ||
        previous.entries.some((entry) => !revisions.has(entry.kind + '\0' + entry.display_name))
      ) {
        setMessage('目录内容已变化，请重新读取文件夹。');
        return;
      }
      // 只合并服务端的修订和对应页位置，保留旧entry能力及已展开子树；不推算+1。
      setDirectories((old) => {
        if (generation.current !== epoch || !old[parent]) return old;
        return {
          ...old,
          [parent]: {
            entries: old[parent].entries.map((entry) => ({
              ...entry,
              mapping_revision:
                revisions.get(entry.kind + '\0' + entry.display_name) ?? entry.mapping_revision,
            })),
            cursor: next,
          },
        };
      });
    }
    requestDirectories.current.delete(requestId);
  };
  const show = async (result: FolderResponse | undefined, epoch: number, requestId?: string) => {
    if (!result?.ok || !result.source || !result.saved_handle) return;
    if (requestId) await refreshCaptureDirectory(epoch, requestId, result.source.name);
    if (generation.current !== epoch) return;
    const read = await invoke(
      { protocol_version: 1, operation: 'read_saved', scope, saved_handle: result.saved_handle },
      epoch,
    );
    if (read?.ok && read.data) {
      setOpened({ source: result.source, bytes: read.data });
      setResumeId(undefined);
    }
    await refreshLists(epoch);
  };
  const toggle = (entryId: string) => {
    if (!root || busy) return;
    if (expanded.includes(entryId)) {
      setExpanded((old) => old.filter((id) => id !== entryId));
      return;
    }
    setExpanded((old) => [...old, entryId]);
    if (!directories[entryId]) void run((epoch) => loadDirectory(root.root_id, entryId, epoch));
  };
  const open = (entry: FolderEntry) => {
    if (!root || entry.kind !== 'file') return;
    if (uncertain.current.size && !resumeId) {
      setMessage('请先核对或继续未完成的原操作。');
      return;
    }
    void run(async (epoch) => {
      const requestId = resumeId ?? crypto.randomUUID();
      const parent = Object.keys(directories).find((id) =>
        directories[id].entries.some((item) => item.entry_id === entry.entry_id),
      );
      if (parent) {
        if (requestDirectories.current.size >= 256)
          requestDirectories.current.delete(requestDirectories.current.keys().next().value!);
        requestDirectories.current.set(requestId, parent);
      }
      const result = await invoke(
        {
          protocol_version: 1,
          operation: resumeId ? 'resume_capture' : 'open_entry',
          scope,
          root_id: root.root_id,
          entry_id: entry.entry_id,
          request_id: requestId,
          mapping_revision: entry.mapping_revision,
          view_generation: epoch,
        },
        epoch,
      );
      if (generation.current !== epoch) return;
      if (
        !result ||
        (!result.ok && (result.code === 'RESULT_UNKNOWN' || result.code === 'CAPTURE_PENDING'))
      ) {
        // 结果未知时只核对原请求，不发起第二次捕获。
        const pendingId = result && !result.ok ? (result.request_id ?? requestId) : requestId;
        const item: Pending = {
          request_id: pendingId,
          phase: 'reserved',
          needs_reselect: false,
          relative_label: entry.display_name,
        };
        uncertain.current.set(pendingId, item);
        setPending((old) => (old.some((p) => p.request_id === pendingId) ? old : [...old, item]));
      }
      await show(result, epoch, requestId);
      if (generation.current === epoch) await refreshLists(epoch);
    });
  };
  const query = (item: Pending) =>
    void run(async (epoch) => {
      const result = await invoke(
        {
          protocol_version: 1,
          operation: 'query_capture',
          request_kind: 'capture',
          scope,
          request_id: item.request_id,
        },
        epoch,
      );
      if (generation.current !== epoch) return;
      if (result?.ok && result.phase) uncertain.current.delete(item.request_id);
      if (result && !result.ok && result.code === 'NOT_FOUND')
        setMessage('暂未查到回执，原操作仍可能执行中，请稍后继续核对。');
      if (result?.ok && result.phase === 'ready') await show(result, epoch, item.request_id);
      if (result?.ok && result.phase && result.phase !== 'ready' && result.phase !== 'cancelled')
        setMessage('原操作尚未完成。可选择继续原操作，再点击原文件；也可取消。');
      await refreshLists(epoch);
    });
  const cancel = (item: Pending) =>
    void run(async (epoch) => {
      const result = await invoke(
        {
          protocol_version: 1,
          operation: 'cancel_capture',
          request_kind: 'capture',
          scope,
          request_id: item.request_id,
        },
        epoch,
      );
      if (generation.current !== epoch) return;
      if (result?.ok && result.phase === 'cancelled') uncertain.current.delete(item.request_id);
      if (resumeId === item.request_id) setResumeId(undefined);
      await refreshLists(epoch);
    });
  const resume = (item: Pending) => {
    if (item.phase === 'reserved') {
      setResumeId(item.request_id);
      setMessage('请点击原文件以继续原操作。');
      return;
    }
    void run(async (epoch) => {
      const result = await invoke(
        {
          protocol_version: 1,
          operation: 'resume_capture',
          scope,
          request_id: item.request_id,
          view_generation: epoch,
        },
        epoch,
      );
      if (generation.current !== epoch) return;
      if (result?.ok && result.phase) uncertain.current.delete(item.request_id);
      if (result && !result.ok && result.code === 'ROOT_EXPIRED') {
        setResumeId(item.request_id);
        setMessage('需重新读取原目录并点击原文件以恢复固定快照。');
      }
      await show(result, epoch, item.request_id);
      await refreshLists(epoch);
    });
  };
  const openSaved = (item: Saved) =>
    void run(async (epoch) => {
      const result = await invoke(
        {
          protocol_version: 1,
          operation: 'open_saved',
          scope,
          mapping_id: item.mapping_id,
          source_id: item.source.id,
        },
        epoch,
      );
      await show(result, epoch);
    });
  return {
    busy,
    root,
    state,
    directories,
    expanded,
    pending,
    saved,
    opened,
    message,
    resumeId,
    restore,
    toggle,
    open,
    query,
    cancel,
    openSaved,
    resume,
    setResumeId,
    close: () => setOpened(undefined),
    more: (entryId: string) => {
      const cursor = directories[entryId]?.cursor;
      if (root && cursor) void run((epoch) => loadDirectory(root.root_id, entryId, epoch, cursor));
    },
  };
}
export type LocalFolderModel = ReturnType<typeof useLocalFolder>;
