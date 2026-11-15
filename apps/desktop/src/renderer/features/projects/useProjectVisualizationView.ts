import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogResponse } from '../../../preload/caselite-api';
import {
  defaultProjectVisualizationConfig,
  normalizeVisualizationConfig,
  type ProjectGraph,
  type ProjectVisualizationConfig,
  type ProjectVisualizationView,
  type ProjectVisualizationRequest,
} from './project-visualization-view-model';
import {
  pruneVisualizationConfig,
  visualizationDraftKey,
} from './project-visualization-view-model';
type SaveRequest = Extract<
  ProjectVisualizationRequest,
  { operation: 'save_project_visualization_view' }
>;
type Phase =
  'loading' | 'ready' | 'saving' | 'unknown' | 'checking' | 'saved' | 'failed' | 'abandoned';
type State = {
  projectId: string;
  graph: ProjectGraph | null;
  committed: ProjectVisualizationView | null;
  latest: ProjectVisualizationView | null;
  draft: ProjectVisualizationConfig;
  phase: Phase;
  error: string;
  sourceChanged: boolean;
  externalChanged: boolean;
  retryAllowed: boolean;
  command: SaveRequest | null;
};
const initial = (projectId: string): State => ({
  projectId,
  graph: null,
  committed: null,
  latest: null,
  draft: defaultProjectVisualizationConfig,
  phase: 'loading',
  error: '',
  sourceChanged: false,
  externalChanged: false,
  retryAllowed: false,
  command: null,
});
function scopedResponse(input: CatalogResponse, projectId: string) {
  const response = input;
  if (!response.ok) return response;
  const graph = response.project_graph;
  const view = response.project_visualization_view;
  if (
    !graph ||
    !view ||
    graph.project_id !== projectId ||
    view.project_id !== projectId ||
    view.view_id !== 'current' ||
    graph.depth !== 2 ||
    graph.node_limit !== 200 ||
    graph.fingerprint !== view.current_source_fingerprint
  )
    throw new Error('Unexpected visualization response');
  return { ...response, graph, view };
}
export function useProjectVisualizationView(
  projectId: string,
  refreshHint: string,
  restored?: ProjectVisualizationConfig,
) {
  const [state, setState] = useState<State>(() => initial(projectId));
  const current = useRef(state);
  const lifecycle = useRef({ epoch: 0, reads: 0, mounted: false });
  const restoredScope = useRef(projectId);
  const queuedRefresh = useRef(false);
  const restore = useRef(restored);
  const publish = useCallback((next: State) => {
    current.current = next;
    setState(next);
  }, []);
  const locked = useCallback(
    () =>
      Boolean(current.current.command) || ['saving', 'checking'].includes(current.current.phase),
    [],
  );
  const refresh = useCallback(async () => {
    if (locked()) {
      queuedRefresh.current = true;
      return;
    }
    const generation = lifecycle.current.epoch;
    const sequence = ++lifecycle.current.reads;
    try {
      const response = scopedResponse(
        await window.caselite.catalog({
          protocol_version: 1,
          operation: 'read_project_visualization_view',
          project_id: projectId,
          view_id: 'current',
        }),
        projectId,
      );
      if (
        !lifecycle.current.mounted ||
        generation !== lifecycle.current.epoch ||
        sequence !== lifecycle.current.reads
      )
        return;
      const old = current.current;
      if (!response.ok) {
        publish({ ...old, graph: null, phase: 'failed', error: response.message });
        return;
      }
      const dirty =
        old.committed &&
        visualizationDraftKey(old.draft) !== visualizationDraftKey(old.committed.config);
      const externalChanged = Boolean(dirty && old.committed?.revision !== response.view.revision);
      const restoredConfig = restore.current;
      restore.current = undefined;
      const draft = pruneVisualizationConfig(
        restoredConfig ??
          (dirty
            ? old.draft
            : {
                ...response.view.config,
                ...(old.graph
                  ? {
                      selected: old.draft.selected,
                      viewport: old.draft.viewport,
                      mode: old.draft.mode,
                    }
                  : {}),
              }),
        response.graph,
      );
      publish({
        ...old,
        graph: response.graph,
        latest: response.view,
        committed: externalChanged ? old.committed : response.view,
        draft,
        phase: 'ready',
        error: externalChanged
          ? '其他窗口已保存新视图。当前输入已保留，请核对后重新载入已保存视图。'
          : '',
        externalChanged,
        sourceChanged:
          old.sourceChanged ||
          Boolean(old.graph && old.graph.fingerprint !== response.graph.fingerprint) ||
          Boolean(
            response.view.saved_source_fingerprint &&
            response.view.saved_source_fingerprint !== response.graph.fingerprint,
          ),
      });
    } catch {
      if (
        lifecycle.current.mounted &&
        generation === lifecycle.current.epoch &&
        sequence === lifecycle.current.reads
      )
        publish({
          ...current.current,
          graph: null,
          phase: 'failed',
          error: '暂时无法读取项目记录，请重新读取。',
        });
    }
  }, [projectId, publish, locked]);
  useEffect(() => {
    const control = lifecycle.current;
    control.mounted = true;
    control.epoch++;
    control.reads++;
    if (restoredScope.current !== projectId) restore.current = undefined;
    queuedRefresh.current = false;
    current.current = initial(projectId);
    return () => {
      control.mounted = false;
      control.epoch++;
      control.reads++;
    };
  }, [projectId, publish, refresh]);
  useEffect(() => {
    void refreshHint;
    void refresh();
  }, [refreshHint, refresh]);
  const edit = useCallback(
    (patch: Partial<ProjectVisualizationConfig>, transient = false) => {
      const old = current.current;
      if (locked() || !old.graph || (!transient && old.graph.read_only)) return;
      const parsed = normalizeVisualizationConfig({ ...old.draft, ...patch });
      if (parsed)
        publish({ ...old, draft: parsed, phase: old.phase === 'saved' ? 'ready' : old.phase });
    },
    [locked, publish],
  );
  const submit = useCallback(
    async (request: SaveRequest, status = false): Promise<boolean> => {
      const generation = lifecycle.current.epoch;
      lifecycle.current.reads++;
      publish({
        ...current.current,
        phase: status ? 'checking' : 'saving',
        retryAllowed: false,
        error: '',
      });
      try {
        const query: ProjectVisualizationRequest = status
          ? {
              protocol_version: 1,
              operation: 'project_visualization_view_status',
              project_id: request.project_id,
              view_id: 'current',
              idempotency_key: request.idempotency_key,
            }
          : request;
        const response = scopedResponse(await window.caselite.catalog(query), request.project_id);
        if (!lifecycle.current.mounted || generation !== lifecycle.current.epoch) return false;
        if (!response.ok) {
          if (status && response.code === 'NOT_FOUND') {
            // status缺失不能证明项目仍可读；先窄读核对当前范围，再决定是否允许原键重试。
            const scope = scopedResponse(
              await window.caselite.catalog({
                protocol_version: 1,
                operation: 'read_project_visualization_view',
                project_id: request.project_id,
                view_id: 'current',
              }),
              request.project_id,
            );
            if (!lifecycle.current.mounted || generation !== lifecycle.current.epoch) return false;
            if (scope.ok) {
              publish({
                ...current.current,
                graph: scope.graph,
                latest: scope.view,
                draft: pruneVisualizationConfig(current.current.draft, scope.graph),
                phase: scope.graph.read_only ? 'failed' : 'unknown',
                retryAllowed: !scope.graph.read_only,
                error: scope.graph.read_only
                  ? '项目已归档，原提交结果仍未确认。可继续核对，或明确放弃本次输入与核对。'
                  : '尚未查到原提交，当前项目范围已核对。可继续核对，或重试同一原提交。',
              });
            } else {
              const lostScope = scope.code === 'NOT_FOUND' || scope.code === 'FORBIDDEN';
              publish({
                ...current.current,
                graph: null,
                phase: lostScope ? 'failed' : 'unknown',
                retryAllowed: false,
                error: lostScope
                  ? '项目范围已不可用，原提交结果仍未确认。可继续核对，或明确放弃本次输入与核对；不能重试。'
                  : '当前范围无法确认，请保留输入并继续核对原提交。',
              });
            }
            return false;
          }
          const uncertain =
            status || response.code === 'RESULT_UNKNOWN' || response.code === 'UNAVAILABLE';
          publish({
            ...current.current,
            phase: uncertain ? 'unknown' : 'failed',
            command: uncertain ? current.current.command : null,
            retryAllowed: false,
            graph:
              status || ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT'].includes(response.code)
                ? null
                : current.current.graph,
            error:
              status && response.code === 'NOT_FOUND'
                ? '尚未查到原提交。可继续核对，或明确重试同一提交。'
                : response.message,
          });
          return false;
        }
        const receipt = response.visualization_receipt;
        if (
          !receipt ||
          receipt.project_id !== request.project_id ||
          receipt.view_id !== 'current' ||
          receipt.idempotency_key !== request.idempotency_key ||
          receipt.committed_revision > response.view.revision
        )
          throw new Error('Unexpected receipt');
        // 原回执只证明曾提交；始终显示同响应的当前视图，不恢复旧命令配置。
        publish({
          ...current.current,
          graph: response.graph,
          committed: response.view,
          latest: response.view,
          draft: response.view.config,
          phase: 'saved',
          command: null,
          error: '',
          externalChanged: false,
          sourceChanged: Boolean(
            response.view.saved_source_fingerprint !== response.graph.fingerprint,
          ),
        });
        if (queuedRefresh.current) {
          queuedRefresh.current = false;
          void refresh();
        }
        return true;
      } catch {
        if (lifecycle.current.mounted && generation === lifecycle.current.epoch)
          publish({
            ...current.current,
            phase: 'unknown',
            graph: status ? null : current.current.graph,
            retryAllowed: false,
            error: '保存回执未知。请先核对原提交，输入仍保留。',
          });
        return false;
      }
    },
    [publish, refresh],
  );
  const save = useCallback(
    async (config?: ProjectVisualizationConfig) => {
      const old = current.current;
      if (
        locked() ||
        old.phase === 'abandoned' ||
        !old.graph ||
        !old.committed ||
        old.graph.read_only ||
        old.externalChanged
      )
        return false;
      const parsed = normalizeVisualizationConfig(config ?? old.draft);
      if (!parsed) return false;
      const request: SaveRequest = {
        protocol_version: 1,
        operation: 'save_project_visualization_view',
        project_id: projectId,
        view_id: 'current',
        format_version: 1,
        request_id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
        expected_view_revision: old.committed.revision,
        expected_source_fingerprint: old.graph.fingerprint,
        config: parsed,
      };
      publish({ ...old, draft: parsed, command: request });
      return submit(request);
    },
    [locked, projectId, publish, submit],
  );
  const check = useCallback(
    () =>
      current.current.command && !['saving', 'checking'].includes(current.current.phase)
        ? submit(current.current.command, true)
        : Promise.resolve(false),
    [submit],
  );
  const retry = useCallback(
    () =>
      current.current.command &&
      current.current.retryAllowed &&
      !['saving', 'checking'].includes(current.current.phase)
        ? submit(current.current.command)
        : Promise.resolve(false),
    [submit],
  );
  const discard = useCallback(() => {
    const old = current.current;
    if (locked() || !old.latest) return;
    publish({
      ...old,
      committed: old.latest,
      draft: old.latest.config,
      externalChanged: false,
      phase: 'ready',
      error: '',
    });
  }, [locked, publish]);
  const abandon = useCallback(() => {
    const old = current.current;
    if (!old.command || ['saving', 'checking'].includes(old.phase)) return;
    // 仅放弃本地输入和本次核对身份，不能冒称取消已派发的保存或确认其结果。
    queuedRefresh.current = false;
    publish({
      ...old,
      committed: old.latest ?? old.committed,
      command: null,
      graph: null,
      draft: old.latest?.config ?? defaultProjectVisualizationConfig,
      phase: 'abandoned',
      retryAllowed: false,
      externalChanged: false,
      error: '已放弃本地输入与本次核对；这不会取消可能已保存的结果。请重新读取后查看实际状态。',
    });
  }, [publish]);
  const scopeState = state.projectId === projectId ? state : initial(projectId);
  return {
    ...scopeState,
    dirty: Boolean(
      scopeState.committed &&
      visualizationDraftKey(scopeState.draft) !==
        visualizationDraftKey(scopeState.committed.config),
    ),
    hasChanges: Boolean(
      scopeState.committed &&
      JSON.stringify(scopeState.draft) !== JSON.stringify(scopeState.committed.config),
    ),
    locked: Boolean(scopeState.command) || ['saving', 'checking'].includes(scopeState.phase),
    busy: ['saving', 'checking'].includes(scopeState.phase),
    hasUnresolved: Boolean(scopeState.command),
    requiresReload: scopeState.phase === 'abandoned',
    canRetry: scopeState.phase === 'unknown' && scopeState.retryAllowed,
    edit,
    save,
    refresh,
    check,
    retry,
    discard,
    abandon,
  };
}
