import { Icon } from '../shared/ui/Icon';
import { useMaterials } from './useMaterials';
import type { MaterialPreview } from '../../preload/caselite-api';
import PdfAttachments from './PdfAttachments';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';

import { ModelSettingsNavigation } from '../shared/navigation/ModelSettingsNavigation';
import { agentModelLabel, agentModels, agentProviderFor } from './model-labels';
import { projectStatuses, projectTypes } from '../projects/project-display';
import type { AgentResponse } from '../../preload/caselite-api';
import type { AgentModel, AgentRun, AgentRequest } from '../../preload/caselite-api';
import { emptyDraft, type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';

// 仅保留尚未提交的编辑草稿/发送身份，避免面板卸载丢字或未知回执触发新收费Run。
const drafts = new Map<string, RichDraft>();
const draftRevisions = new Map<string, number>();
const submissionRevisions = new Map<string, number>();
const confirmedMaterials = new Map<string, MaterialPreview>();
const submissions = new Map<string, Extract<AgentRequest, { operation: 'start' }>>();

const AttachmentReader = createContext<(id: string, task: string, name: string) => void>(() => {});
function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="assistant-markdown"
      skipHtml
      components={{
        // 模型链接和图片仅作文字展示，不能触发联网或被当成已核验来源。
        a: ({ children }) => <span title="模型提供的链接，未经核验">{children}</span>,
        img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : '[模型图片未加载]'}</span>,
      }}
    />
  );
}
function Message() {
  const attachments = useAuiState(
    (state) => state.message.metadata.custom?.attachments,
  ) as AgentRun['attachments'];
  const role = useAuiState((state) => state.message.role);
  const run = useAuiState((state) => state.message.metadata.custom?.run) as
    | (Pick<AgentRun, 'id' | 'scope' | 'model' | 'status' | 'message'> & { copyable: boolean })
    | undefined;
  const [copyState, setCopyState] = useState('复制');
  const read = useContext(AttachmentReader);
  return (
    <MessagePrimitive.Root className={`assistant-message assistant-message--${role}`}>
      <header className="assistant-message-heading">
        <strong>{role === 'user' ? '你' : 'CaseLite'}</strong>
        {role === 'assistant' && <span>{run ? agentModelLabel(run.model) : 'AI 辅助'}</span>}
      </header>
      {attachments?.length ? (
        <div className="message-attachments">
          {attachments.map((file) => (
            <button
              type="button"
              key={file.source_id}
              onClick={() => read(file.source_id, file.task_id, file.name)}
            >
              <span className="material-file-icon">PDF</span>
              <span>
                {file.name}
                <small>{file.pages.length} 页</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <MessagePrimitive.Parts
        components={role === 'assistant' ? { Text: MarkdownText } : undefined}
      />
      {role === 'assistant' && run && run.status !== 'running' && (
        <footer className="assistant-message-footer">
          <span>{run.status === 'succeeded' ? '待人工核对' : run.message}</span>
          <button
            type="button"
            disabled={!run.copyable}
            onClick={async () => {
              try {
                const result = await window.caselite.agent({
                  protocol_version: 1,
                  operation: 'copy_output',
                  scope: run.scope,
                  run_id: run.id,
                });
                if (!result.ok) throw new Error('Copy failed');
                setCopyState('已复制');
              } catch {
                setCopyState('复制失败，请选择文字复制');
              }
            }}
          >
            {copyState}
          </button>
        </footer>
      )}
    </MessagePrimitive.Root>
  );
}

const ComposerInput = forwardRef<
  DraftEditorHandle,
  {
    draft: RichDraft;
    onDraft(value: RichDraft): void;
    disabled: boolean;
    home?: boolean;
  }
>(function ComposerInput({ draft, onDraft, disabled, home }, ref) {
  const aui = useAui();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      append(text) {
        if (disabled) return;
        onDraft({ text: draft.text.trim() ? `${draft.text}\n${text}` : text, state: null });
        inputRef.current?.focus();
      },
    }),
    [disabled, draft.text, onDraft],
  );
  useEffect(() => {
    if (aui.composer.getState().text !== draft.text) aui.composer.setText(draft.text);
  }, [aui, draft.text]);
  return (
    <ComposerPrimitive.Input
      ref={inputRef}
      aria-label={home ? 'Agent 工作目标' : 'AI 工作要求'}
      data-testid={home ? 'agent-input' : 'assistant-input'}
      className="assistant-input"
      placeholder="描述你的工作目标或问题…"
      rows={1}
      minRows={1}
      maxRows={6}
      disabled={disabled}
      addAttachmentOnPaste={false}
      onChange={(event) => onDraft({ text: event.target.value, state: null })}
    />
  );
});

function ComposerFrame({
  compact,
  ...props
}: Omit<ComponentProps<typeof ComposerPrimitive.Root>, 'className'> & { compact: boolean }) {
  return (
    <ComposerPrimitive.Root
      {...props}
      className={compact ? 'assistant-compose agent-prompt' : 'assistant-compose'}
    />
  );
}

export function UnavailableAgentPanel({ reason }: { reason: string }) {
  // 未确认任务范围时只使用本地空状态渲染输入框，不挂载对话轮询或材料控制器。
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: (message) => message,
    onNew: async () => {},
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <section className="assistant-panel assistant-panel--compact" aria-label="AI 对话未启用">
        <ComposerFrame compact onSubmit={(event) => event.preventDefault()}>
          <div className="material-composer">
            <ComposerInput draft={emptyDraft()} onDraft={() => {}} disabled />
            <div className="assistant-actions">
              <div className="material-menu">
                <button
                  type="button"
                  className="material-menu-trigger"
                  aria-label="添加文件与材料"
                  disabled
                >
                  <Icon name="plus" size={18} />
                </button>
              </div>
              <select className="home-model-select" aria-label="选择大模型" disabled>
                <option>选择模型</option>
              </select>
              <button type="button" className="primary assistant-submit" aria-label="发送" disabled>
                发送
              </button>
            </div>
          </div>
        </ComposerFrame>
        <p className="assistant-run-status" role="status">
          {reason}
        </p>
      </section>
    </AssistantRuntimeProvider>
  );
}

export default function AgentPanel({
  scope,
  variant = 'default',
  draft: controlled,
  onDraft,
  editorRef,
  onConversationChange,
  project,
}: {
  scope: string;
  variant?: 'default' | 'compact';
  draft?: RichDraft;
  onDraft?(value: RichDraft): void;
  editorRef?: RefObject<DraftEditorHandle | null>;
  onCreate?(): void;
  onConversationChange?(hasRuns: boolean): void;
  project?: { version: number; archived: boolean };
}) {
  const materials = useMaterials(scope, !project);
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
  const mockPreview = new URLSearchParams(window.location.search).has('mock-agent');
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
    Partial<Record<import('../../preload/caselite-api').AgentProvider, boolean>>
  >({});
  const configured = providers[agentProviderFor(model)];
  const [error, setError] = useState('');
  const [credentialUnavailable, setCredentialUnavailable] = useState(false);
  const openSettings = useContext(ModelSettingsNavigation);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(() => submissions.has(scope));
  const composing = useRef(false),
    sending = useRef(false),
    alive = useRef(true);
  const preparationGeneration = useRef(0);
  const preparingAbort = useRef<AbortController | null>(null);
  const active = runs.find((run) => run.status === 'running');
  useEffect(() => {
    onConversationChange?.(runs.length > 0);
  }, [onConversationChange, runs.length]);
  const current = useRef({ draft, setDraft, materials });
  useLayoutEffect(() => {
    current.current = { draft, setDraft, materials };
  });
  const acknowledge = (request: Extract<AgentRequest, { operation: 'start' }>) => {
    if (submissions.get(scope)?.run_id !== request.run_id) return;
    const context = confirmedMaterials.get(scope);
    if (!project)
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
      setRuns(result.runs);
      setProviders(result.providers);
      setModel(result.model);
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
          setRuns(result.runs);
          setProviders(result.providers);
          setModel(result.model);
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
  async function send() {
    if (sending.current || composing.current || active) return;
    const previous = submissions.get(scope);
    if (project && !previous && (archived || !projectPreview || projectLoading)) return;
    const prompt = previous?.prompt ?? draft.text.trim();
    if (!prompt || prompt.length > 4000) return;
    if (!previous && !configured) {
      setError(
        credentialUnavailable
          ? '系统安全凭据暂不可读，请核对系统安全存储后重启应用。附件与输入已保留。'
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
        const context = project ? undefined : await materials.preview(prompt, model, abort.signal);
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
          ...(projectPreview ? { project_fingerprint: projectPreview.fingerprint } : {}),
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
          setRuns(result.runs);
          setProviders(result.providers);
          setModel(result.model);
          setCredentialUnavailable(
            Boolean(result.credential_errors?.[agentProviderFor(result.model)]),
          );
          setError('');
        }
      } else {
        const refreshProject =
          result.code === 'STALE_PROJECT_CONTEXT' || result.code === 'ARCHIVED';
        const uncertain =
          result.code === 'RESULT_UNKNOWN' || (Boolean(previous) && !refreshProject);
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
      setCredentialUnavailable(Boolean(result.credential_errors?.[agentProviderFor(result.model)]));
      if ('scope' in request) setRuns(result.runs);
      setError('');
    } else setError(result.message);
  };
  const messages: ThreadMessageLike[] = runs.flatMap((run) => [
    {
      id: `${run.id}:input`,
      role: 'user' as const,
      content: [{ type: 'text' as const, text: run.prompt }],
      metadata: { custom: { attachments: run.attachments } },
    },
    {
      id: `${run.id}:output`,
      role: 'assistant' as const,
      metadata: {
        custom: {
          run: {
            id: run.id,
            scope: run.scope,
            model: run.model,
            status: run.status,
            message: run.message,
            copyable: Boolean(run.output),
          },
        },
      },
      content: [
        {
          type: 'text' as const,
          text: run.output || (run.status === 'running' ? '正在等待模型…' : run.message),
        },
      ],
      status:
        run.status === 'running'
          ? { type: 'running' as const }
          : run.status === 'succeeded'
            ? { type: 'complete' as const, reason: 'stop' as const }
            : {
                type: 'incomplete' as const,
                reason: run.status === 'cancelled' ? ('cancelled' as const) : ('error' as const),
              },
    },
  ]);
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: Boolean(active),
    convertMessage: (message) => message,
    onNew: async () => {
      await send();
    },
    onCancel: async () => {
      if (active)
        await command({ protocol_version: 1, operation: 'cancel', scope, run_id: active.id });
    },
  });
  const latest = runs.at(-1);
  const homeComposer = scope === 'home' || variant === 'compact';
  const actions = (
    <>
      {homeComposer && (
        <select
          className="home-model-select"
          aria-label="选择大模型"
          value={active?.model ?? model}
          disabled={Boolean(active) || pending || unknown}
          onChange={(event) =>
            void command({
              protocol_version: 1,
              operation: 'select_model',
              model: event.target.value as AgentModel,
            })
          }
        >
          {agentModels.map((option) => (
            <option
              key={option}
              value={option}
              disabled={!providers[agentProviderFor(option)] && model !== option}
            >
              {agentProviderFor(option) === 'siliconflow' ? agentModelLabel(option) : option}
            </option>
          ))}
        </select>
      )}
      {pending && !submissions.has(scope) && (
        <button
          type="button"
          onClick={() => {
            preparationGeneration.current++;
            preparingAbort.current?.abort();
            setError('已取消发送，附件和输入保留。');
            void materials.cancelPreparation().catch(() => {});
          }}
        >
          取消发送
        </button>
      )}
      {active ? (
        <button
          type="button"
          className="primary assistant-stop"
          aria-label="停止生成"
          title="停止生成"
          onClick={() => void runtime.thread.cancelRun()}
        >
          停止生成
        </button>
      ) : (
        <button
          className={`primary ${unknown ? 'assistant-reconcile' : 'assistant-submit'}`}
          aria-busy={pending}
          type="submit"
          aria-label={unknown ? '核对原发送（同一标识）' : '发送'}
          title="发送"
          disabled={
            pending ||
            (!unknown &&
              ((project && (archived || !projectPreview || projectLoading)) ||
                !draft.text.trim() ||
                draft.text.length > 4000))
          }
        >
          {pending ? '正在准备…' : unknown ? '核对原发送（同一标识）' : '发送'}
        </button>
      )}
    </>
  );
  const composer = (
    <ComposerInput
      ref={editorRef}
      home={scope === 'home'}
      draft={draft}
      onDraft={setDraft}
      disabled={archived}
    />
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AttachmentReader.Provider
        value={(id, task, name) => {
          if (!project) void materials.readReference(id, task, name);
        }}
      >
        <section
          className={`assistant-panel${variant === 'compact' ? ' assistant-panel--compact' : ''}${runs.length ? ' assistant-panel--conversation' : ''}`}
          aria-label={
            project ? '项目 AI 对话' : scope === 'home' ? '首页 AI Agent' : '任务 AI 辅助栏'
          }
          onFocusCapture={openProjectPreview}
          onClickCapture={openProjectPreview}
        >
          {mockPreview && (
            <p className="assistant-run-status" role="status">
              MOCK_ONLY · 离线演示 · 不调用真实模型，固定输出只验证界面流程。
            </p>
          )}
          {!homeComposer && (
            <div className="assistant-model">
              <span>
                <i className={configured ? 'local-dot' : 'unconnected-dot'} />{' '}
                {agentModelLabel(active?.model ?? model)}
              </span>
              <button
                type="button"
                className="model-settings-link"
                disabled={!openSettings}
                onClick={() => openSettings?.()}
              >
                {active
                  ? '生成中 · 模型设置'
                  : configured
                    ? '已配置 · 模型设置'
                    : '前往设置配置 Key'}
              </button>
            </div>
          )}

          {(!project || runs.length > 0) && (
            <ThreadPrimitive.Root className="assistant-thread">
              <ThreadPrimitive.Viewport className="assistant-viewport">
                <ThreadPrimitive.Messages components={{ Message }} />
                <ThreadPrimitive.ScrollToBottom className="assistant-scroll-bottom">
                  回到最新回答 ↓
                </ThreadPrimitive.ScrollToBottom>
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>
          )}
          {latest && (
            <p className={`assistant-run-status ${latest.status}`} role="status">
              {agentModelLabel(latest.model)} ·{' '}
              {latest.status === 'running' ? '正在生成，可随时停止。' : latest.message}
              {latest.usage
                ? ` 输入 ${latest.usage.input} / 输出 ${latest.usage.output} tokens；费用未知。`
                : ''}
            </p>
          )}
          {credentialUnavailable && (
            <div role="alert" className="assistant-error">
              系统安全凭据暂不可读；旧密文已保留，未发起模型请求。可在设置中核对，人工任务与正文仍可使用。
            </div>
          )}
          {error && (
            <div role="alert" className="assistant-error">
              {error}
              <button onClick={() => void refresh()}>刷新状态</button>
            </div>
          )}
          {latest &&
            (latest.status === 'failed' ||
              latest.status === 'interrupted' ||
              latest.status === 'cancelled') &&
            !unknown &&
            !active && (
              <button
                type="button"
                className="assistant-refill"
                disabled={pending || Boolean(draft.text.trim())}
                onClick={() => setDraft({ text: latest.prompt, state: null })}
              >
                重新填写上次要求 · 附件请重新添加
              </button>
            )}
          {project && (
            <div className="assistant-run-status project-agent-context" aria-label="项目上下文">
              <button
                type="button"
                disabled={projectLoading}
                onClick={() => void loadProjectPreview()}
              >
                {projectLoading ? '正在读取项目上下文…' : '读取项目上下文'}
              </button>
              {projectError && <p role="alert">{projectError} 请重读项目上下文。</p>}
              {projectPreview && (
                <dl>
                  <dt>项目名称</dt>
                  <dd>{projectPreview.fields.title}</dd>
                  <dt>状态</dt>
                  <dd>{projectStatuses[projectPreview.fields.status]}</dd>
                  <dt>类型</dt>
                  <dd>{projectTypes[projectPreview.fields.project_type]}</dd>
                  <dt>优先级</dt>
                  <dd>{['无优先级', '紧急', '高', '中', '低'][projectPreview.fields.priority]}</dd>
                  <dt>目标日</dt>
                  <dd>{projectPreview.fields.target_date ?? '未设置'}</dd>
                </dl>
              )}
              {archived ? (
                <p>项目已归档，可查看已有历史。</p>
              ) : (
                <p>点击发送后，所选模型会收到当前问题和上方项目字段。</p>
              )}
              {!configured && openSettings && !archived && (
                <button type="button" className="model-settings-link" onClick={openSettings}>
                  前往设置配置 Key
                </button>
              )}
            </div>
          )}
          <ComposerFrame
            compact={homeComposer}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
          >
            {project ? (
              <div className="material-composer">
                {composer}
                <div className="assistant-actions">{actions}</div>
              </div>
            ) : (
              <PdfAttachments
                controller={materials}
                showSavedMaterials={scope !== 'home'}
                disabled={pending || unknown || Boolean(active)}
                actions={actions}
              >
                {composer}
              </PdfAttachments>
            )}
          </ComposerFrame>
          {scope !== 'home' && variant !== 'compact' && (
            <p className="assistant-footnote">
              回答待人工核对，不自动写入正文。运行记录保存在此设备；生成中的未落盘增量可能丢失。每次发送独立，不自动携带历史。
            </p>
          )}
        </section>
      </AttachmentReader.Provider>
    </AssistantRuntimeProvider>
  );
}
