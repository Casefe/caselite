import {
  folderRequestSchema,
  MATERIAL_MAX_PAGES,
  textPageSchema,
  type FolderRequest,
  type FolderResponse,
  type FolderScope,
  type PersonalMaterial,
  type TextPage,
} from '@caselite/contracts';
import type {
  FolderCaller,
  FolderCaptureTarget,
  FolderGuard,
  FolderRootsPort,
  PersonalCaptureJournal,
  PersonalMaterialFilesPort,
  PersonalMaterialStorePort,
} from './folder-ports';
import type { PdfProcessorPort } from './material-ports';
import type { createFolderConfigurationApplication } from './folder-configuration-application';
import { folderFailure } from './folder-errors';

const sameScope = (a: FolderScope, b: FolderScope) => JSON.stringify(a) === JSON.stringify(b);
export function createPersonalMaterialApplication(input: {
  hash(text: string): string;
  store: PersonalMaterialStorePort;
  files: PersonalMaterialFilesPort;
  roots: FolderRootsPort;
  configuration: ReturnType<typeof createFolderConfigurationApplication>;
  processors: Record<'pdf' | 'docx' | 'image', PdfProcessorPort>;
}) {
  const { store, files, roots, configuration, processors } = input;
  const running = new Map<string, { caller: FolderCaller; controller: AbortController }>();
  const ready = (
    caller: FolderCaller,
    scope: FolderScope,
    source: PersonalMaterial,
    requestId?: string,
  ): FolderResponse => {
    configuration.callerValid(caller);
    store.assertSourceScope(scope, source.id);
    return {
      ok: true,
      state: 'ready',
      source,
      saved_handle: roots.savedHandle(caller, scope, source.id),
      request_id: requestId,
      phase: requestId ? 'ready' : undefined,
    };
  };
  function journalFor(scope: FolderScope, id: string) {
    const j = store.read(id);
    if (!j) throw new Error('NOT_FOUND');
    if (!sameScope(j.target.scope, scope)) throw new Error('FORBIDDEN');
    return j;
  }
  function status(
    caller: FolderCaller,
    scope: FolderScope,
    j: PersonalCaptureJournal,
  ): FolderResponse {
    if (j.phase === 'ready') {
      const source = store.source(j.result!.source_id);
      if (!source) throw new Error('SOURCE_UNAVAILABLE');
      return ready(caller, scope, source, j.request_id);
    }
    return {
      ok: true,
      state: j.phase === 'cancelled' ? 'cancelled' : 'pending',
      request_id: j.request_id,
      phase: j.phase,
      needs_reselect: j.needs_reselect,
    };
  }
  async function capture(
    caller: FolderCaller,
    request: Extract<FolderRequest, { operation: 'open_entry' | 'resume_capture' }>,
  ) {
    const { guard: scopeGuard } = configuration.scopeView(caller, request.scope);
    const existing = store.read(request.request_id);
    if (existing && !sameScope(existing.target.scope, request.scope)) throw new Error('FORBIDDEN');
    let target: FolderCaptureTarget;
    if (existing && request.operation === 'resume_capture' && existing.phase !== 'reserved') {
      // 持久化快照恢复不再读取外部目录，也不需要旧窗口的root/entry能力。
      const { mapping_id, ...plain } = existing.target;
      void mapping_id;
      target = plain;
      if (
        request.mapping_revision !== undefined &&
        request.mapping_revision !== target.mapping_revision
      )
        throw new Error('RECEIPT_CONFLICT');
    } else {
      if (!request.root_id || !request.entry_id || request.mapping_revision === undefined)
        throw new Error('ROOT_EXPIRED');
      target = roots.target(caller, request.scope, request.root_id, request.entry_id, scopeGuard);
      target.mapping_revision = request.mapping_revision;
    }
    let j = store.reserve(request.request_id, target, input.hash(JSON.stringify(target)));
    if (j.phase === 'ready' || j.phase === 'cancelled') return status(caller, request.scope, j);
    if (running.has(request.request_id)) throw new Error('BUSY');
    const controller = new AbortController();
    running.set(request.request_id, { caller, controller });
    const guard: FolderGuard = () => {
      scopeGuard();
      if (controller.signal.aborted || store.read(request.request_id)?.phase === 'cancelled')
        throw new Error('CANCELLED');
    };
    const checked = async <T>(effect: () => Promise<T>) => {
      guard();
      try {
        const result = await effect();
        guard();
        return result;
      } catch (error) {
        guard();
        throw error;
      }
    };
    try {
      guard();
      j = store.advance(j.request_id, j.phase, { interrupted: false, needs_reselect: false });
      let bytes: Uint8Array | undefined;
      if (j.phase === 'reserved') {
        if (!request.root_id || !request.entry_id) throw new Error('ROOT_EXPIRED');
        const rootId = request.root_id,
          entryId = request.entry_id;
        const snap = await checked(() =>
          roots.snapshot(caller, request.scope, rootId, entryId, j.target.entry_hint, guard),
        );
        j = store.advance(j.request_id, 'reserved', {
          phase: 'snapshot_planned',
          snapshot: {
            name: snap.name,
            kind: snap.kind,
            sha256: snap.sha256,
            bytes: snap.bytes.length,
          },
        });
        bytes = snap.bytes;
      }
      if (j.phase === 'snapshot_planned') {
        const current = store.currentSource(j.target);
        if (current && current.sha256 === j.snapshot!.sha256) {
          await checked(() => files.read(current.asset_version_id, current.sha256, guard));
          j = store.advance(j.request_id, 'snapshot_planned', {
            phase: 'placed',
            reuse_source_id: current.id,
          });
        } else {
          if (!bytes) {
            try {
              bytes = await checked(() =>
                files.placedOrStaged(j.capture_token, j.snapshot!.sha256, guard),
              );
            } catch {
              guard();
              if (!request.root_id || !request.entry_id) throw new Error('ROOT_EXPIRED');
              const rootId = request.root_id,
                entryId = request.entry_id;
              const snap = await checked(() =>
                roots.snapshot(caller, request.scope, rootId, entryId, j.target.entry_hint, guard),
              );
              if (snap.sha256 !== j.snapshot!.sha256) throw new Error('ENTRY_CHANGED');
              bytes = snap.bytes;
            }
          }
          await checked(() =>
            files.stageFrozen(bytes!, j.snapshot!.name, j.capture_token, j.snapshot!.sha256, guard),
          );
          j = store.advance(j.request_id, 'snapshot_planned', { phase: 'staged' });
        }
      }
      if (j.phase === 'staged') {
        await checked(() => files.place(j.capture_token, j.snapshot!.sha256, guard));
        j = store.advance(j.request_id, 'staged', { phase: 'placed' });
      }
      guard();
      if (j.phase !== 'placed') throw new Error('CAPTURE_PENDING');
      if (j.reuse_source_id) {
        const original = store.source(j.reuse_source_id);
        if (!original) throw new Error('SOURCE_UNAVAILABLE');
        await checked(() => files.read(original.asset_version_id, original.sha256, guard));
        guard();
        return ready(
          caller,
          request.scope,
          store.commit(j.request_id, original.page_count, '', original.pages).source,
          j.request_id,
        );
      }
      bytes = await checked(() => files.placedOrStaged(j.capture_token, j.snapshot!.sha256, guard));
      const processor = processors[j.snapshot!.kind];
      const count = await checked(() => processor.inspect(bytes!));
      if (!Number.isInteger(count) || count < 1 || count > MATERIAL_MAX_PAGES)
        throw new Error('FILE_LIMIT');
      const pages = new Map<number, TextPage>();
      await checked(() =>
        processor.process(bytes!, {
          ocr: false,
          previous: [],
          signal: controller.signal,
          onPage(page) {
            guard();
            const p = textPageSchema.parse(page);
            if (p.page > count || pages.has(p.page)) throw new Error('FILE_LIMIT');
            pages.set(p.page, p);
          },
        }),
      );
      if (pages.size !== count || [...pages.values()].some((p) => p.origin === 'failed'))
        throw new Error('FILE_UNAVAILABLE');
      guard();
      const result = store.commit(
        j.request_id,
        count,
        processor.configuration,
        [...pages.values()].sort((a, b) => a.page - b.page),
      );
      return ready(caller, request.scope, result.source, j.request_id);
    } catch (error) {
      // 已确认的ready回执必须保留；撤权/取消不删除原件，也不重发提交。
      const failure = folderFailure(error);
      store.interrupt(request.request_id, failure.code);
      throw error;
    } finally {
      running.delete(request.request_id);
    }
  }
  async function execute(caller: FolderCaller, value: unknown): Promise<FolderResponse> {
    const parsed = folderRequestSchema.safeParse(value);
    if (!parsed.success) return folderFailure(new Error('INVALID_REQUEST'));
    const request = parsed.data;
    try {
      configuration.callerValid(caller);
      const configResult = await configuration.execute(caller, request);
      if (configResult) return configResult;
      if (!('scope' in request)) throw new Error('INVALID_REQUEST');
      // 读取固定副本不依赖外部根，但项目仍必须存在且有当前映射权限。
      configuration.scopeView(caller, request.scope).guard();
      switch (request.operation) {
        case 'list_directory': {
          const { guard } = configuration.scopeView(caller, request.scope);
          const result = await roots.list(caller, request, guard);
          guard();
          for (const entry of result.entries)
            if (entry.kind === 'file') {
              const t = roots.target(caller, request.scope, request.root_id, entry.entry_id, guard);
              entry.mapping_revision = store.mappingRevision(t.binding_id, t.relative_name);
            }
          return { ok: true, state: 'listed', ...result, view_generation: request.view_generation };
        }
        case 'open_entry':
        case 'resume_capture':
          return await capture(caller, request);
        case 'query_capture':
          return status(caller, request.scope, journalFor(request.scope, request.request_id));
        case 'cancel_capture': {
          journalFor(request.scope, request.request_id);
          running.get(request.request_id)?.controller.abort();
          return status(caller, request.scope, store.cancel(request.request_id)!);
        }
        case 'list_saved':
          return { ok: true, state: 'listed', saved: store.saved(request.scope) };
        case 'list_pending':
          return { ok: true, state: 'listed', pending: store.pending(request.scope) };
        case 'open_saved': {
          store.assertSourceScope(request.scope, request.source_id, request.mapping_id);
          const source = store.source(request.source_id);
          if (!source) throw new Error('SOURCE_UNAVAILABLE');
          return ready(caller, request.scope, source);
        }
        case 'read_saved': {
          const sourceId = roots.savedSource(caller, request.scope, request.saved_handle);
          const guard = () => {
            configuration.callerValid(caller);
            store.assertSourceScope(request.scope, sourceId);
          };
          guard();
          const source = store.source(sourceId);
          if (!source) throw new Error('SOURCE_UNAVAILABLE');
          guard();
          const data = await files.read(source.asset_version_id, source.sha256, guard);
          guard();
          return {
            ok: true,
            state: 'ready',
            source,
            saved_handle: request.saved_handle,
            data: new Uint8Array(data),
          };
        }
        default:
          throw new Error('INVALID_REQUEST');
      }
    } catch (error) {
      const failure = folderFailure(error);
      return { ...failure, request_id: 'request_id' in request ? request.request_id : undefined };
    }
  }
  function revokeCaller(caller: FolderCaller) {
    roots.revokeCaller(caller);
    for (const [id, active] of running)
      if (
        active.caller.session === caller.session &&
        active.caller.window_id === caller.window_id
      ) {
        active.controller.abort();
        store.interrupt(id, 'FORBIDDEN');
      }
  }
  return { execute, revokeCaller };
}
