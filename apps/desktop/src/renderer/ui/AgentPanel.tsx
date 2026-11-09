import { isDocx } from './useMaterials';
import { agentMessages, isConversationRun } from '../features/agent/agent-messages';
import { useAgentController } from '../features/agent/useAgentController';
import { Icon } from '../shared/ui/Icon';
import PdfAttachments from './PdfAttachments';
import { AssistantMarkdown } from '../features/agent/AssistantMarkdown';
import PageReference from '../shared/ui/PageReference';
import {
  createContext,
  forwardRef,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  type ComponentProps,
  type RefObject,
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
import { projectStatuses, projectTypes } from '../features/projects/project-display';
import type { AgentModel, AgentRun } from '../../preload/caselite-api';
import { emptyDraft, type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';

const AttachmentReader = createContext<(id: string, task: string, name: string) => void>(() => {});
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
        {role === 'assistant' && run?.status === 'running' && (
          <span className="assistant-generating">正在生成</span>
        )}
      </header>
      {attachments?.length ? (
        <div className="message-attachments">
          {attachments.map((file) => (
            <button
              type="button"
              key={file.source_id}
              onClick={() => read(file.source_id, file.task_id, file.name)}
            >
              <span className="material-file-icon">{isDocx(file.name) ? 'DOCX' : 'PDF'}</span>
              <span>
                {file.name}
                <small>
                  {file.pages.length} {isDocx(file.name) ? '段' : '页'}
                </small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <MessagePrimitive.Parts
        components={role === 'assistant' ? { Text: AssistantMarkdown } : undefined}
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
  page,
}: {
  scope: string;
  variant?: 'default' | 'compact';
  draft?: RichDraft;
  onDraft?(value: RichDraft): void;
  editorRef?: RefObject<DraftEditorHandle | null>;
  onCreate?(): void;
  onConversationChange?(hasRuns: boolean): void;
  project?: { version: number; archived: boolean };
  page?: { version: string; archived: boolean };
}) {
  const {
    pageReference,
    pageLoading,
    loadPageReference,
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
    composing: composingRef,
    active,
    refresh,
    loadProjectPreview,
    openProjectPreview,
    send,
    command,
    cancelPreparation,
    preparing,
  } = useAgentController({
    scope,
    draft: controlled,
    onDraft,
    onConversationChange,
    project,
    page,
  });
  const panel = useRef<HTMLElement>(null);
  const activate = useRef(() => {});
  useLayoutEffect(() => {
    activate.current = () => {
      if (!page || pageLoading || active || pending || unknown) return;
      const selection = window.getSelection();
      const anchor = selection?.anchorNode?.parentElement;
      const focus = selection?.focusNode?.parentElement;
      // 在鼠标落到输入框前固定页面选区；对话自身的文字不反向变成页面材料。
      const selected =
        selection &&
        !selection.isCollapsed &&
        anchor &&
        focus &&
        !anchor.closest('.inspector-ai-region') &&
        !focus.closest('.inspector-ai-region')
          ? selection.toString().trim()
          : '';
      if (selected || !pageReference) void loadPageReference(selected || undefined);
    };
  });
  const pageEnabled = Boolean(page);
  useEffect(() => {
    const region = panel.current?.closest('.inspector-ai-region');
    if (!pageEnabled || !region) return;
    const trigger = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest('.inspector-ai-heading button, .inspector-ai-resize')
      )
        return;
      activate.current();
    };
    region.addEventListener('pointerdown', trigger, true);
    region.addEventListener('focusin', trigger, true);
    return () => {
      region.removeEventListener('pointerdown', trigger, true);
      region.removeEventListener('focusin', trigger, true);
    };
  }, [pageEnabled]);
  const openSettings = useContext(ModelSettingsNavigation);
  const mockPreview = new URLSearchParams(window.location.search).has('mock-agent');
  const readOnlyPreview = new URLSearchParams(window.location.search).has('audit-agent');
  const messages = agentMessages(runs);
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: Boolean(active),
    convertMessage: (message) => message,
    onNew: async () => {
      if (!readOnlyPreview) await send();
    },
    onCancel: async () => {
      if (active)
        await command({ protocol_version: 1, operation: 'cancel', scope, run_id: active.id });
    },
  });
  // 专用日期历史不投影成聊天；active仍来自全部Run，不能因隐藏JSON而放开重复发送。
  const latest = runs.filter(isConversationRun).at(-1);
  const homeComposer = scope === 'home' || variant === 'compact';
  const actions = (
    <>
      {homeComposer && (
        <select
          className="home-model-select"
          aria-label="选择大模型"
          value={active?.model ?? model}
          disabled={Boolean(active) || pending || unknown || credentialReading}
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
      {preparing && (
        <button type="button" onClick={cancelPreparation}>
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
              (credentialReading ||
                (page
                  ? page.archived || !pageReference || pageLoading
                  : project && (archived || !projectPreview || projectLoading)) ||
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
          ref={panel}
          className={`assistant-panel${variant === 'compact' ? ' assistant-panel--compact' : ''}${messages.length ? ' assistant-panel--conversation' : ''}`}
          aria-label={
            project ? '项目 AI 对话' : scope === 'home' ? '首页 AI Agent' : '任务 AI 辅助栏'
          }
          onFocusCapture={page ? undefined : openProjectPreview}
          onClickCapture={page ? undefined : openProjectPreview}
        >
          {mockPreview && (
            <p className="assistant-run-status" role="status">
              MOCK_ONLY · 离线演示 · 不调用真实模型，固定输出只验证界面流程。
            </p>
          )}
          {readOnlyPreview && (
            <p className="assistant-run-status" role="status">
              AI 验收记录（只读）· 可查看回答、复制和打开附件；此入口不发送新请求。
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

          {(!project || messages.length > 0) && (
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
          {active?.purpose === 'important_dates' && (
            <p className="assistant-run-status" role="status">
              重要日期识别正在运行，请在重要日期面板查看候选与来源。
            </p>
          )}
          {credentialReading && (
            <p className="assistant-run-status" role="status">
              正在读取系统安全凭据，尚未发起模型请求；人工任务与正文可继续使用。
            </p>
          )}
          {!credentialReading && credentialUnavailable && (
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
                disabled={
                  pending ||
                  restoring ||
                  Boolean(draft.text.trim()) ||
                  Object.keys(materials.selected).length > 0 ||
                  materials.busy ||
                  Boolean(materials.staged)
                }
                onClick={() => void restoreRun(latest)}
              >
                {restoring ? '正在核对上轮材料…' : '恢复上轮要求与原选段'}
              </button>
            )}
          {project && !page && (
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
          {readOnlyPreview && materials.reading && (
            <PdfAttachments controller={materials} disabled>
              {null}
            </PdfAttachments>
          )}
          {!readOnlyPreview && (
            <ComposerFrame
              compact={homeComposer}
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
            >
              {pageReference && <PageReference reference={pageReference} />}
              {pageLoading && <span className="caption">正在引用当前页面…</span>}
              {project || scope.startsWith('document:') ? (
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
          )}
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
