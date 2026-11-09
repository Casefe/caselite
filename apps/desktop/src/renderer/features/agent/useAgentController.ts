import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useMaterials } from '../../ui/useMaterials';
import { agentProviderFor } from '../../ui/model-labels';
import type {
  MaterialPreview,
  AgentModel,
  AgentRun,
  AgentPageReference,
  AgentRequest,
  AgentResponse,
} from '../../../preload/caselite-api';
import { emptyDraft, type RichDraft } from '../../editors/editor-state';
import { isConversationRun } from './agent-messages';

// 仅保留尚未提交的编辑草稿/发送身份，避免面板卸载丢字或未知回执触发新收费Run。
const drafts = new Map<string, RichDraft>();
const draftRevisions = new Map<string, number>();
const submissionRevisions = new Map<string, number>();
const confirmedMaterials = new Map<string, MaterialPreview>();
const submissions = new Map<string, Extract<AgentRequest, { operation: 'start' }>>();

export type AgentControllerOptions = {
  scope: string;
  draft?: RichDraft;
  onDraft?(value: RichDraft): void;
  onConversationChange?(hasRuns: boolean): void;
  project?: { version: number; archived: boolean };
  page?: { version: string; archived: boolean };
};

export function useAgentController({
  scope,
  draft: controlled,
  onDraft,
  onConversationChange,
  project,
  page,
}: AgentControllerOptions) {
  const withoutMaterials = Boolean(project || scope.startsWith('document:'));
  const materials = useMaterials(scope, !withoutMaterials);
  const [pageState, setPageState] = useState<{
    version: string | undefined;
    value: AgentPageReference;
  }>();
  const pageReference = pageState?.version === page?.version ? pageState?.value : undefined;
  const setPageReference = (value?: AgentPageReference) =>
    setPageState(value ? { version: page?.version, value } : undefined);
  const [pageRequestVersion, setPageRequestVersion] = useState<string>();
  const pageLoading = page !== undefined && pageRequestVersion === page.version;
  const setPageLoading = (loading: boolean) =>
    setPageRequestVersion(loading ? page?.version : undefined);
  const pageGeneration = useRef(0);
  const [preview, setProjectPreview] = useState<{
    version: number;
    value: NonNullable<Extract<AgentResponse, { ok: true }>['project_preview']>;
  }>();
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState('');
  const previewRequest = useRef(0);
  const previewStarted = useRef(false);
  const projectVersion = project?.version;
  const projectPreview = preview?.version === projectVersion ? preview?.value : undefined;
  const archived = Boolean(project?.archived || projectPreview?.archived);
  const [localDraft, setLocalDraft] = useState(() => drafts.get(scope) ?? emptyDraft());
  const draft = controlled ?? localDraft;
  const setDraft = (value: RichDraft) => {
    draftRevisions.set(scope, (draftRevisions.get(scope) ?? 0) + 1);
    drafts.set(scope, value);
    (onDraft ?? setLocalDraft)(value);
  };
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [model, setModel] = useState<AgentModel>('gpt-4.1-mini');
  const [providers, setProviders] = useState<
    Partial<Record<import('../../../preload/caselite-api').AgentProvider, boolean>>
  >({});
  const configured = providers[agentProviderFor(model)];
  const [error, setError] = useState('');
  const [credentialUnavailable, setCredentialUnavailable] = useState(false);
  const [credentialReading, setCredentialReading] = useState(false);
  const [pending, setPending] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [unknown, setUnknown] = useState(() => submissions.has(scope));
  const composing = useRef(false),
    sending = useRef(false),
    alive = useRef(true);
  const preparationGeneration = useRef(0);
  const preparingAbort = useRef<AbortController | null>(null);
  const active = runs.find((run) => run.status === 'running');
  const hasConversation = runs.some(isConversationRun);
  useEffect(() => {
    onConversationChange?.(hasConversation);
  }, [onConversationChange, hasConversation]);
  const current = useRef({ draft, setDraft, materials, scope });
  useLayoutEffect(() => {
    current.current = { draft, setDraft, materials, scope };
  });
  const acknowledge = (request: Extract<AgentRequest, { operation: 'start' }>) => {
    if (submissions.get(scope)?.run_id !== request.run_id) return;
    const context = confirmedMaterials.get(scope);
    if (!withoutMaterials)
      current.current.materials.acknowledge(
        context?.selections.map((item) => item.source_id) ?? [],
      );
    submissions.delete(scope);
    confirmedMaterials.delete(scope);
    // 晚到回执只清理原输入，不能擦掉用户正在写的下一轮要求。
    if (draftRevisions.get(scope) === submissionRevisions.get(request.run_id))
      current.current.setDraft(emptyDraft());
    submissionRevisions.delete(request.run_id);
    if (alive.current) setUnknown(false);
  };
  const acceptResponse = useRef(acknowledge);
  useLayoutEffect(() => {
    acceptResponse.current = acknowledge;
  });
  const refresh = async () => {
    const result = await window.caselite.agent({ protocol_version: 1, operation: 'read', scope });
    if (!alive.current) return;
    if (result.ok) {
      setRuns(result.runs.filter((run) => run.scope === scope));
      setProviders(result.providers);
      setModel(result.model);
      setCredentialReading(Boolean(result.credential_reading));
      setCredentialUnavailable(Boolean(result.credential_errors?.[agentProviderFor(result.model)]));
    } else setError(result.message);
  };
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await window.caselite.agent({
          protocol_version: 1,
          operation: 'read',
          scope,
        });
        if (stopped) return;
        if (result.ok) {
          setRuns(result.runs.filter((run) => run.scope === scope));
          setProviders(result.providers);
          setModel(result.model);
          setCredentialReading(Boolean(result.credential_reading));
          setCredentialUnavailable(
            Boolean(result.credential_errors?.[agentProviderFor(result.model)]),
          );
          const submitted = submissions.get(scope);
          if (submitted && result.runs.some((run) => run.id === submitted.run_id))
            acceptResponse.current(submitted);
        } else setError(result.message);
      } catch {
        if (!stopped) setError('状态读取失败；请保留输入并刷新。');
      }
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      alive.current = false;
      preparingAbort.current?.abort();
      stopped = true;
      clearTimeout(timer);
    };
  }, [scope]);
  const loadProjectPreview = async () => {
    if (projectVersion === undefined) return;
    const token = ++previewRequest.current;
    previewStarted.current = true;
    setProjectPreview(undefined);
    setProjectError('');
    setProjectLoading(true);
    try {
      const result = await window.caselite.agent({
        protocol_version: 1,
        operation: 'preview_project',
        scope: scope as `project:${string}`,
      });
      if (!alive.current || previewRequest.current !== token) return;
      if (result.ok && result.project_preview)
        setProjectPreview({ version: projectVersion, value: result.project_preview });
      else setProjectError(result.ok ? '项目上下文不可用。' : result.message);
    } catch {
      if (alive.current && previewRequest.current === token)
        setProjectError('项目上下文读取失败。');
    } finally {
      if (alive.current && previewRequest.current === token) setProjectLoading(false);
    }
  };
  const openProjectPreview = (event: SyntheticEvent) => {
    if (project && !previewStarted.current && event.target instanceof HTMLTextAreaElement)
      void loadProjectPreview();
  };
  const reloadPreview = useRef(loadProjectPreview);
  useLayoutEffect(() => {
    reloadPreview.current = loadProjectPreview;
  });
  useEffect(() => {
    if (previewStarted.current) void reloadPreview.current();
  }, [projectVersion]);
  const loadPageReference = async (selected_text?: string) => {
    if (!page || page.archived || pending || unknown || active) return;
    const generation = ++pageGeneration.current;
    setPageLoading(true);
    setPageReference(undefined);
    try {
      const result = await window.caselite.agent({
        protocol_version: 1,
        operation: 'preview_page',
        scope,
        ...(selected_text ? { selected_text } : {}),
      });
      if (!alive.current || generation !== pageGeneration.current) return;
      if (result.ok && result.page_preview) setPageReference(result.page_preview);
      else setError(result.ok ? '当前页面无法引用。' : result.message);
    } catch {
      if (alive.current && generation === pageGeneration.current)
        setError('页面引用读取失败，请重新点击输入框。');
    } finally {
      if (alive.current && generation === pageGeneration.current) setPageLoading(false);
    }
  };
  useLayoutEffect(() => {
    pageGeneration.current++;
  }, [scope, page?.version]);
  async function send() {
    if (sending.current || composing.current || active) return;
    const previous = submissions.get(scope);
    if (
      !previous &&
      (page
        ? page.archived || !pageReference || pageLoading
        : project && (archived || !projectPreview || projectLoading))
    )
      return;
    const prompt = previous?.prompt ?? draft.text.trim();
    if (!prompt || prompt.length > 4000) return;
    if (!previous && credentialReading) {
      setError('正在读取系统安全凭据，请稍后再发送。附件与输入已保留。');
      return;
    }
    if (!previous && !configured) {
      setError(
        credentialUnavailable
          ? '系统安全凭据暂不可读，可在设置中重新读取。附件与输入已保留。'
          : '请在设置中配置当前模型的 Key，附件与输入已保留。',
      );
      return;
    }
    sending.current = true;
    setPending(true);
    setError('');
    const generation = ++preparationGeneration.current;
    const abort = new AbortController();
    preparingAbort.current = abort;
    const revision = draftRevisions.get(scope);
    let request = previous;
    try {
      if (!request) {
        const context = withoutMaterials
          ? undefined
          : await materials.preview(prompt, model, abort.signal);
        if (!alive.current || generation !== preparationGeneration.current) return;
        request = {
          protocol_version: 1,
          operation: 'start',
          model,
          scope,
          run_id: crypto.randomUUID(),
          prompt,
          confirmed: true,
          ...(context ? { context_id: context.id } : {}),
          ...(pageReference
            ? { page_context_id: pageReference.id }
            : projectPreview
              ? { project_fingerprint: projectPreview.fingerprint }
              : {}),
        };
        submissions.set(scope, request);
        if (revision !== undefined) submissionRevisions.set(request.run_id, revision);
        if (context) confirmedMaterials.set(scope, context);
        else confirmedMaterials.delete(scope);
      }
      const result = await window.caselite.agent(request);
      // 卸载实例不能清掉重挂载后的新输入，由当前实例按 Run ID 轮询核对。
      if (!alive.current) return;
      if (result.ok) {
        if (result.runs.some((run) => run.id === request!.run_id)) acceptResponse.current(request);
        else if (project && submissions.get(scope)?.run_id === request.run_id) setUnknown(true);
        if (alive.current) {
          setRuns(result.runs.filter((run) => run.scope === scope));
          setProviders(result.providers);
          setModel(result.model);
          setCredentialReading(Boolean(result.credential_reading));
          setCredentialUnavailable(
            Boolean(result.credential_errors?.[agentProviderFor(result.model)]),
          );
          setError('');
        }
      } else {
        const refreshProject =
          result.code === 'STALE_PROJECT_CONTEXT' || result.code === 'ARCHIVED';
        if (result.code === 'STALE_PAGE_CONTEXT') setPageReference(undefined);
        const uncertain =
          result.code === 'RESULT_UNKNOWN' ||
          (Boolean(previous) && !refreshProject && result.code !== 'STALE_PAGE_CONTEXT');
        if (refreshProject) void loadProjectPreview();
        if (submissions.get(scope)?.run_id === request.run_id) {
          if (!uncertain) {
            submissions.delete(scope);
            confirmedMaterials.delete(scope);
          }
          if (alive.current) setUnknown(uncertain);
        }
        if (alive.current) setError(result.message);
      }
    } catch (failure) {
      if (alive.current) {
        setError(failure instanceof Error ? failure.message : '暂未完成发送，输入与附件已保留。');
        if (request && submissions.get(scope)?.run_id === request.run_id) setUnknown(true);
      }
    } finally {
      sending.current = false;
      if (alive.current) setPending(false);
    }
  }
  const command = async (request: AgentRequest) => {
    const result = await window.caselite.agent(request);
    if (!alive.current) return;
    if (result.ok) {
      setProviders(result.providers);
      setModel(result.model);
      setCredentialReading(Boolean(result.credential_reading));
      setCredentialUnavailable(Boolean(result.credential_errors?.[agentProviderFor(result.model)]));
      if ('scope' in request) setRuns(result.runs.filter((run) => run.scope === scope));
      setError('');
    } else setError(result.message);
  };
  const cancelPreparation = () => {
    preparationGeneration.current++;
    preparingAbort.current?.abort();
    setError('已取消发送，附件和输入保留。');
    void materials.cancelPreparation().catch(() => {});
  };
  const restoreRun = async (run: AgentRun) => {
    if (
      composing.current ||
      sending.current ||
      active ||
      submissions.has(scope) ||
      !isConversationRun(run) ||
      run.scope !== scope ||
      !['failed', 'cancelled', 'interrupted'].includes(run.status) ||
      current.current.draft.text.trim()
    )
      return;
    sending.current = true;
    setRestoring(true);
    setError('');
    const revision = draftRevisions.get(scope);
    try {
      if (run.context_id && !run.attachments?.length)
        throw new Error('上轮附件或选段已不可用；未恢复，请重新核对材料。');
      const restore = await materials.prepareRecovery(run.attachments ?? []);
      if (!alive.current || current.current.scope !== scope) return;
      if (
        composing.current ||
        draftRevisions.get(scope) !== revision ||
        current.current.draft.text.trim()
      )
        throw new Error('输入已变化，未覆盖当前内容。');
      restore();
      current.current.setDraft({ text: run.prompt, state: null });
      // 恢复的是输入，不复用历史授权或 context_id；发送仍走当轮预览校验。
      if (project) void loadProjectPreview();
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : '上轮输入未恢复。');
    } finally {
      sending.current = false;
      if (alive.current) setRestoring(false);
    }
  };
  return {
    pageReference,
    pageLoading,
    loadPageReference,
    removePageReference: () => {
      pageGeneration.current++;
      setPageReference(undefined);
      setPageLoading(false);
    },
    materials,
    projectLoading,
    projectError,
    projectPreview,
    archived,
    draft,
    setDraft,
    runs,
    model,
    providers,
    configured,
    error,
    credentialUnavailable,
    credentialReading,
    pending,
    restoring,
    restoreRun,
    unknown,
    composing,
    active,
    refresh,
    loadProjectPreview,
    openProjectPreview,
    send,
    command,
    cancelPreparation,
    preparing: pending && !submissions.has(scope),
  };
}
