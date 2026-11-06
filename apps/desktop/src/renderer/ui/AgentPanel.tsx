import { useMaterials } from "./useMaterials";
import type { MaterialPreview } from "../../preload/caselite-api";
import PdfAttachments from "./PdfAttachments";
import {
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ModelSettingsNavigation } from "./SettingsView";
import { agentModelLabel, agentProviderFor } from "./model-labels";
import type {
  AgentModel,
  AgentRun,
  AgentRequest,
} from "../../preload/caselite-api";
import {
  emptyDraft,
  type DraftEditorHandle,
  type RichDraft,
} from "../editors/RichEditor";

// 仅保留尚未提交的编辑草稿/发送身份，避免面板卸载丢字或未知回执触发新收费Run。
const drafts = new Map<string, RichDraft>();
const confirmedMaterials = new Map<string, MaterialPreview>();
const submissions = new Map<
  string,
  Extract<AgentRequest, { operation: "start" }>
>();

function Message() {
  return (
    <MessagePrimitive.Root className="assistant-message">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

const ComposerInput = forwardRef<
  DraftEditorHandle,
  {
    draft: RichDraft;
    onDraft(value: RichDraft): void;
    disabled: boolean;
    scope: string;
  }
>(function ComposerInput({ draft, onDraft, disabled, scope }, ref) {
  const aui = useAui();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      append(text) {
        if (disabled) return;
        onDraft({
          text: draft.text.trim() ? `${draft.text}\n${text}` : text,
          state: null,
        });
        inputRef.current?.focus();
      },
    }),
    [disabled, draft.text, onDraft],
  );
  useEffect(() => {
    if (aui.composer.getState().text !== draft.text)
      aui.composer.setText(draft.text);
  }, [aui, draft.text]);
  return (
    <ComposerPrimitive.Input
      ref={inputRef}
      aria-label={scope === "home" ? "Agent 工作目标" : "AI 工作要求"}
      data-testid={scope === "home" ? "agent-input" : "assistant-input"}
      className="assistant-input"
      placeholder="描述你的工作目标或问题…"
      rows={1}
      disabled={disabled}
      addAttachmentOnPaste={false}
      onChange={(event) => onDraft({ text: event.target.value, state: null })}
    />
  );
});

export default function AgentPanel({
  scope,
  draft: controlled,
  onDraft,
  editorRef,
  onCreate,
}: {
  scope: string;
  draft?: RichDraft;
  onDraft?(value: RichDraft): void;
  editorRef?: RefObject<DraftEditorHandle | null>;
  onCreate?(): void;
}) {
  const materials = useMaterials(scope);
  const [materialPreview, setMaterialPreview] =
    useState<MaterialPreview | null>(() => {
      const stored = confirmedMaterials.get(scope);
      return stored?.id === submissions.get(scope)?.context_id
        ? (stored ?? null)
        : null;
    });
  const [localDraft, setLocalDraft] = useState(
    () => drafts.get(scope) ?? emptyDraft(),
  );
  const draft = controlled ?? localDraft;
  const setDraft = (value: RichDraft) => {
    drafts.set(scope, value);
    (onDraft ?? setLocalDraft)(value);
  };
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [model, setModel] = useState<AgentModel>("gpt-4.1-mini");
  const [providers, setProviders] = useState({
    openai: false,
    deepseek: false,
  });
  const [previewModel, setPreviewModel] = useState<AgentModel>(
    () => submissions.get(scope)?.model ?? "gpt-4.1-mini",
  );
  const inputSnapshot = useRef("");
  useLayoutEffect(() => {
    inputSnapshot.current = JSON.stringify([
      draft.text,
      model,
      materials.signature,
    ]);
  }, [draft.text, model, materials.signature]);
  const previewGeneration = useRef(0);
  const configured = providers[agentProviderFor(model)];
  const previewConfigured = providers[agentProviderFor(previewModel)];
  const [error, setError] = useState("");
  const openSettings = useContext(ModelSettingsNavigation);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(
    () => submissions.get(scope)?.prompt ?? null,
  );
  const [unknown, setUnknown] = useState(() => submissions.has(scope));
  const materialSignature = useRef(materials.signature);
  useEffect(() => {
    if (!unknown && materialSignature.current !== materials.signature) {
      materialSignature.current = materials.signature;
      setPreview(null);
      setMaterialPreview(null);
    }
  }, [materials.signature, unknown]);
  const composing = useRef(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const active = runs.find((run) => run.status === "running");
  const refresh = async () => {
    const result = await window.caselite.agent({
      protocol_version: 1,
      operation: "read",
      scope,
    });
    if (!alive.current) return;
    if (result.ok) {
      setRuns(result.runs);
      setProviders(result.providers);
      setModel(result.model);
    } else setError(result.message);
  };
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await window.caselite.agent({
        protocol_version: 1,
        operation: "read",
        scope,
      });
      if (stopped) return;
      if (result.ok) {
        setRuns(result.runs);
        setProviders(result.providers);
        setModel(result.model);
        const submitted = submissions.get(scope);
        if (
          submitted &&
          result.runs.some((run) => run.id === submitted.run_id)
        ) {
          submissions.delete(scope);
          confirmedMaterials.delete(scope);
          setUnknown(false);
          setPreview(null);
        }
      } else setError(result.message);
      timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      alive.current = false;
      stopped = true;
      clearTimeout(timer);
    };
  }, [scope]);
  const command = async (request: AgentRequest) => {
    const result = await window.caselite.agent(request);
    if (!alive.current) return;
    if (result.ok) {
      setProviders(result.providers);
      setModel(result.model);
      if ("scope" in request) setRuns(result.runs);
      setError("");
    } else setError(result.message);
  };
  const messages: ThreadMessageLike[] = runs.flatMap((run) => [
    {
      id: `${run.id}:input`,
      role: "user" as const,
      content: [{ type: "text" as const, text: run.prompt }],
    },
    {
      id: `${run.id}:output`,
      role: "assistant" as const,
      content: [
        {
          type: "text" as const,
          text:
            run.output ||
            (run.status === "running" ? "正在等待模型…" : run.message),
        },
      ],
      status:
        run.status === "running"
          ? { type: "running" as const }
          : run.status === "succeeded"
            ? { type: "complete" as const, reason: "stop" as const }
            : {
                type: "incomplete" as const,
                reason:
                  run.status === "cancelled"
                    ? ("cancelled" as const)
                    : ("error" as const),
              },
    },
  ]);
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: Boolean(active),
    convertMessage: (message) => message,
    onNew: async (message) => {
      if (sending.current || !preview || composing.current) return;
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (text !== preview) {
        setError("输入已变化，请重新预览。");
        return;
      }
      sending.current = true;
      setPending(true);
      const previousSubmission = submissions.get(scope);
      const request = previousSubmission ?? {
        protocol_version: 1 as const,
        operation: "start" as const,
        model: previewModel,
        scope,
        run_id: crypto.randomUUID(),
        prompt: preview,
        confirmed: true as const,
        ...(materialPreview ? { context_id: materialPreview.id } : {}),
      };
      submissions.set(scope, request);
      if (materialPreview && request.context_id === materialPreview.id)
        confirmedMaterials.set(scope, materialPreview);
      else confirmedMaterials.delete(scope);
      try {
        const result = await window.caselite.agent(request);
        const uncertain =
          !result.ok &&
          (result.code === "RESULT_UNKNOWN" || Boolean(previousSubmission));
        if (!uncertain && submissions.get(scope)?.run_id === request.run_id) {
          submissions.delete(scope);
          confirmedMaterials.delete(scope);
        }
        if (!alive.current) return;
        setUnknown(uncertain && submissions.has(scope));
        if (uncertain && !submissions.has(scope)) setPreview(null);
        if (result.ok) {
          setRuns(result.runs);
          setProviders(result.providers);
          setModel(result.model);
          setError("");
          setPreview(null);
        } else setError(result.message);
      } finally {
        sending.current = false;
        if (alive.current) setPending(false);
      }
    },
    onCancel: async () => {
      if (active)
        await command({
          protocol_version: 1,
          operation: "cancel",
          scope,
          run_id: active.id,
        });
    },
  });
  const latest = runs.at(-1);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <section
        className="assistant-panel"
        aria-label={scope === "home" ? "首页 AI Agent" : "任务 AI 辅助栏"}
      >
        <div className="assistant-model">
          <span>
            <i className={configured ? "local-dot" : "unconnected-dot"} />{" "}
            {agentModelLabel(active?.model ?? model)}
          </span>
          <button
            type="button"
            className="model-settings-link"
            disabled={!openSettings}
            onClick={() => openSettings?.()}
          >
            {active
              ? "生成中 · 模型设置"
              : configured
                ? "已配置 · 模型设置"
                : "前往设置配置 Key"}
          </button>
        </div>

        <ThreadPrimitive.Root className="assistant-thread">
          <ThreadPrimitive.Viewport className="assistant-viewport">
            <ThreadPrimitive.Messages components={{ Message }} />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
        {latest && (
          <p className={`assistant-run-status ${latest.status}`} role="status">
            {agentModelLabel(latest.model)} ·{" "}
            {latest.status === "running"
              ? "正在生成，可随时停止。"
              : latest.message}
            {latest.usage
              ? ` 输入 ${latest.usage.input} / 输出 ${latest.usage.output} tokens；费用未知。`
              : ""}
          </p>
        )}
        {error && (
          <div role="alert" className="assistant-error">
            {error}
            <button onClick={() => void refresh()}>刷新状态</button>
          </div>
        )}
        <ComposerPrimitive.Root
          className={
            scope === "home"
              ? "assistant-compose agent-prompt"
              : "assistant-compose"
          }
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              !composing.current &&
              !unknown &&
              !pending &&
              !active &&
              draft.text.trim() &&
              draft.text.length <= 4000
            ) {
              const instruction = draft.text.trim();
              const snapshot = inputSnapshot.current,
                generation = ++previewGeneration.current;
              const hasMaterials = Object.keys(materials.selected).length > 0;
              if (hasMaterials) setPending(true);
              let context: MaterialPreview | null | undefined;
              try {
                context = hasMaterials
                  ? await materials.preview(instruction, model)
                  : undefined;
              } finally {
                if (alive.current && generation === previewGeneration.current)
                  setPending(false);
              }
              if (
                !alive.current ||
                generation !== previewGeneration.current ||
                snapshot !== inputSnapshot.current ||
                context === null
              )
                return;
              setMaterialPreview(context ?? null);
              setPreviewModel(model);
              setPreview(instruction);
            }
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        >
          <PdfAttachments
            controller={materials}
            disabled={pending || unknown || Boolean(active)}
          >
            <ComposerInput
              ref={editorRef}
              scope={scope}
              draft={draft}
              onDraft={(value) => {
                setDraft(value);
                setPreview(null);
              }}
              disabled={pending || unknown}
            />
          </PdfAttachments>
          <div className="assistant-actions">
            {onCreate && (
              <button
                type="button"
                data-testid="create-from-agent"
                disabled={!draft.text.trim() || draft.text.length > 4000}
                onClick={onCreate}
              >
                创建本地任务
              </button>
            )}
            {active ? (
              <button
                type="button"
                className="primary"
                onClick={() => void runtime.thread.cancelRun()}
              >
                停止生成
              </button>
            ) : (
              <button
                className="primary assistant-submit"
                type="submit"
                aria-label="预览发送"
                title="预览发送"
                disabled={
                  pending ||
                  unknown ||
                  !draft.text.trim() ||
                  draft.text.length > 4000
                }
              >
                预览发送
              </button>
            )}
          </div>
        </ComposerPrimitive.Root>
        {preview !== null && (
          <section className="assistant-preview" aria-label="发送预览">
            <h3>本次发送内容</h3>
            <p>
              发送至 {agentModelLabel(previewModel)}。
              {materialPreview
                ? "包含下列指令和所选材料文字，不含未选页或此前对话。"
                : "只包含下列输入，不含任务正文、文件或此前对话。"}
            </p>
            <pre>{materialPreview?.payload ?? preview}</pre>
            <p>
              最多输出 2,048 tokens；60 秒超时，不自动重试。可能产生 API 费用。
            </p>
            <div className="assistant-actions">
              <button
                disabled={pending || unknown}
                onClick={() => setPreview(null)}
              >
                返回修改
              </button>
              <button
                className="primary"
                disabled={!previewConfigured || pending || Boolean(active)}
                onClick={() => {
                  if (!composing.current)
                    runtime.thread.append({
                      role: "user",
                      content: [{ type: "text", text: preview }],
                    });
                }}
              >
                {unknown
                  ? "核对原发送（同一标识）"
                  : previewConfigured
                    ? "确认发送"
                    : "请先配置 Key"}
              </button>
            </div>
          </section>
        )}
        <p className="assistant-footnote">
          回答待人工核对，不自动写入正文。运行记录保存在此设备；生成中的未落盘增量可能丢失。每次发送独立，不自动携带历史。
        </p>
      </section>
    </AssistantRuntimeProvider>
  );
}
