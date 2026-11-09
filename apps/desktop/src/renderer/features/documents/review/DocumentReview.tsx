import { useChat } from '@ai-sdk/react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
} from 'react';
import type {
  AgentModel,
  AgentRun,
  ReviewRange,
  ReviewSaved,
} from '../../../../preload/caselite-api';
import type { Editor } from '@tiptap/react';
import { documentReviewTransport, type DocumentScope } from './document-review-transport';

import useEditorSelection from './useEditorSelection';
import EditorConversation from './EditorConversation';
import { editorSelection } from './editor-selection';
import type { WritingSkillHandle } from './WritingSkillMenu';
export { default as WritingSkillMenu, type WritingSkillHandle } from './WritingSkillMenu';

const protocol_version = 1 as const;

export default function DocumentReview({
  editor,
  identity,
  blocked,
  onApplyBusy,
  onSaved,
  variant = 'review',
  skillHandle,
  onSkillAvailability,
}: {
  variant?: 'review' | 'assistant';
  editor: Editor | null;
  identity: Omit<ReviewRange, 'paragraph' | 'from' | 'to' | 'text'>;
  blocked: boolean;
  onApplyBusy(value: boolean): void;
  onSaved(result: ReviewSaved): void;
  skillHandle?: Ref<WritingSkillHandle>;
  onSkillAvailability?(available: boolean): void;
}) {
  const scope: DocumentScope = `document:${identity.document_id}`;
  const [preview, setPreview] = useState<{
    id: string;
    range: ReviewRange;
    model: AgentModel;
    doc: object;
  }>();
  const [question, setQuestion] = useState('');
  const [terminal, setTerminal] = useState<AgentRun>();
  const [history, setHistory] = useState<AgentRun[]>([]);
  const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [recovery, setRecovery] = useState<'verify' | 'retry' | null>(null);
  const verifyApply = recovery === 'verify';
  const [submitted, setSubmitted] = useState(false);
  const [action, setAction] = useState<'replace' | 'insert_after' | 'append'>('replace');
  const submissionAction = useRef(action);
  const alive = useRef(true);
  const previewId = useRef<string | undefined>(undefined);
  const lock = useRef(false);
  const composing = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => documentReviewTransport(scope, setTerminal), [scope]);
  const { messages, sendMessage, setMessages, stop, status, error, clearError } = useChat({
    id: scope,
    transport,
  });
  const running = status === 'submitted' || status === 'streaming';
  const selected = useEditorSelection(editor, !submitted && !running && !applying);
  const current = useRef({ blocked, revision: identity.revision });
  useLayoutEffect(() => {
    current.current = { blocked, revision: identity.revision };
  });
  const valid =
    preview &&
    !blocked &&
    preview.range.revision === identity.revision &&
    preview.doc === editor?.state.doc;
  const reference = submitted ? preview?.range : selected?.range;
  const canPrepare = Boolean(
    reference && !blocked && identity.revision > 0 && reference.text.length <= 8000,
  );
  const skillAvailable =
    canPrepare && !submitted && !running && !preparing && !applying && !recovery;
  useEffect(() => {
    onSkillAvailability?.(skillAvailable);
    return () => onSkillAvailability?.(false);
  }, [onSkillAvailability, skillAvailable]);
  useImperativeHandle(skillHandle, () => ({
    pick(request) {
      if (
        !editor ||
        !skillAvailable ||
        editor.view.composing ||
        !editor.isEditable ||
        request.revision !== identity.revision ||
        request.doc !== editor.state.doc ||
        request.from !== editor.state.selection.from ||
        request.to !== editor.state.selection.to ||
        !editorSelection(editor)?.text
      )
        return;
      setQuestion(request.skill.instruction);
      const range = editorSelection(editor);
      if (!range) return;
      // 点击技能即明确发送当前指令与选区；直接传入快照，不能读到尚未更新的question。
      root.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      void send(request.skill.instruction, { range, doc: request.doc });
    },
  }));

  const streamed =
    messages.at(-1)?.role === 'assistant'
      ? messages
          .at(-1)
          ?.parts.map((part) => (part.type === 'text' ? part.text : ''))
          .join('')
      : '';
  const candidate = terminal?.output.trim();
  const applicable = Boolean(
    candidate &&
    candidate.length <= 8000 &&
    !/[\p{Cc}\u2028\u2029\uD800-\uDFFF]/u.test(candidate.replaceAll('\n', '')) &&
    (action !== 'replace' || (preview?.range.text && candidate !== preview.range.text)),
  );

  const discard = (id: string) =>
    window.caselite
      .agent({ protocol_version, operation: 'discard_review', scope, run_id: id })
      .catch(() => {});
  useEffect(() => {
    alive.current = true;
    let current = true;
    void window.caselite
      .agent({ protocol_version, operation: 'read', scope })
      .then((result) => {
        if (current && result.ok) setHistory(result.runs.filter((run) => run.status !== 'running'));
      })
      .catch(() => {});
    return () => {
      current = false;
      alive.current = false;
      void stop();
      if (previewId.current)
        void window.caselite
          .agent({
            protocol_version,
            operation: 'discard_review',
            scope,
            run_id: previewId.current,
          })
          .catch(() => {});
    };
  }, [scope, stop]);

  async function prepare(captured = selected) {
    if (lock.current || blocked || running || !editor || editor.view.composing) return;
    const selection = captured?.range;
    if (
      !selection ||
      captured?.doc !== editor.state.doc ||
      selection.text.length > 8000 ||
      identity.revision < 1
    ) {
      setNotice('请在已保存正文的同一段落内选择文字或放置光标，最多 8000 字符。');
      return;
    }
    lock.current = true;
    setPreparing(true);
    try {
      const result = await window.caselite.agent({
        protocol_version,
        operation: 'preview_review',
        scope,
        range: { ...identity, ...selection },
      });
      if (
        !alive.current ||
        current.current.blocked ||
        current.current.revision !== identity.revision ||
        editor.state.doc !== captured.doc
      ) {
        if (result.ok && result.review_preview) void discard(result.review_preview.id);
        return;
      }
      if (!result.ok) return setNotice(result.message);
      if (!result.review_preview) return setNotice('无法核对所选文字，请重试。');
      previewId.current = result.review_preview.id;
      setPreview({ ...result.review_preview, model: result.model, doc: captured.doc });
      setMessages([]);
      setTerminal(undefined);
      setSubmitted(false);
      setRecovery(null);
      clearError();
      setAction(selection.text ? 'replace' : 'insert_after');
      setNotice('');
      return { ...result.review_preview, model: result.model };
    } catch {
      if (alive.current) setNotice('无法核对所选文字，请重试。');
    } finally {
      lock.current = false;
      if (alive.current) setPreparing(false);
    }
  }

  async function send(prompt = question, captured = selected) {
    if (blocked || lock.current || running || submitted || !prompt.trim() || composing.current)
      return;
    // 选区变化只更新本机引用卡；明确发送时才固定经可信端验证的输入。
    const prepared = await prepare(captured);
    if (!prepared || !alive.current || current.current.blocked) return;
    lock.current = true;
    setNotice('');
    setSubmitted(true);
    try {
      await sendMessage(
        { text: prompt.trim() },
        { body: { id: prepared.id, model: prepared.model } },
      );
    } finally {
      lock.current = false;
    }
  }

  async function reject() {
    if (!preview) return;
    const runId = preview.id;
    setPreview(undefined);
    setSubmitted(false);
    setTerminal(undefined);
    setMessages([]);
    clearError();
    if (running) {
      void stop();
      setNotice('已停止本地生成。');
    } else {
      if (terminal) setHistory((old) => [...old.filter((run) => run.id !== terminal.id), terminal]);
      setNotice('已拒绝候选，正文保留原修订。');
    }
    previewId.current = undefined;
    await discard(runId);
  }

  async function recoverRun() {
    if (!preview || lock.current || running) return;
    lock.current = true;
    try {
      const result = await window.caselite.agent({ protocol_version, operation: 'read', scope });
      if (!alive.current) return;
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      const original = result.runs.find((run) => run.id === preview.id);
      if (original?.status === 'running') {
        setNotice('原运行仍在进行中，请先停止并再次核对。');
        return;
      }
      if (original?.status === 'succeeded') {
        setTerminal(original);
        clearError();
        setNotice('已找回本轮候选，未重新调用模型。');
      } else {
        await reject();
        setNotice('已核对原运行；问题已保留，可重新选择并发送。');
      }
    } catch {
      if (alive.current) setNotice('原运行结果仍待核对，输入已保留，未重新发送。');
    } finally {
      lock.current = false;
    }
  }

  async function apply() {
    if (
      (!valid && !verifyApply) ||
      !preview ||
      !terminal ||
      !applicable ||
      lock.current ||
      running ||
      editor?.view.composing
    )
      return;
    if (preview.doc !== editor?.state.doc && !verifyApply) {
      setNotice('正文已有变化，请保存后重新选择。');
      return;
    }
    lock.current = true;
    setApplying(true);
    onApplyBusy(true);
    if (!recovery) submissionAction.current = action;
    // 确认后锁定编辑器和导航。回执未知时保留同一候选，只允许核对原提交。
    editor?.setEditable(false, false);
    let nextRecovery: typeof recovery = null;
    try {
      const request = { protocol_version, scope, run_id: preview.id };
      const result = await window.caselite.agent(
        verifyApply
          ? { ...request, operation: 'status_review' }
          : {
              ...request,
              operation: 'apply_review',
              confirmed: true,
              action: submissionAction.current,
            },
      );
      if (!result.ok) {
        if (verifyApply && result.code === 'NO_RECEIPT') {
          nextRecovery = 'retry';
          setNotice('未找到保存回执。核对选区仍有效后，可重试确认。');
        } else if (
          verifyApply ||
          result.code === 'RESULT_UNKNOWN' ||
          result.code === 'UNAVAILABLE'
        ) {
          nextRecovery = 'verify';
          setNotice('保存结果待核对，请核对原提交。');
        } else {
          nextRecovery = result.code === 'WRITE_FAILED' ? 'retry' : null;
          setNotice(result.message);
        }
        return;
      }
      if (!result.review_saved) throw new Error('Missing review receipt');
      onSaved(result.review_saved);
      setHistory((old) => [...old.filter((run) => run.id !== terminal.id), terminal]);
      setPreview(undefined);
      setSubmitted(false);
      setTerminal(undefined);
      setMessages([]);
      setQuestion('');
      setNotice('已保存工作稿新修订。');
    } catch {
      nextRecovery = 'verify';
      setNotice('保存结果待核对，请核对原提交。');
    } finally {
      lock.current = false;
      setApplying(false);
      setRecovery(nextRecovery);
      if (nextRecovery !== 'verify') {
        onApplyBusy(false);
      }
    }
  }

  return (
    <div ref={root} className="document-review">
      <h2>{variant === 'assistant' ? '正文 AI 助手' : '文档 AI 审阅'}</h2>
      {new URLSearchParams(window.location.search).has('mock-agent') && (
        <p className="caption">合成演示 · MOCK_ONLY</p>
      )}
      <p className="caption">
        选中文字作为本轮引用；点击技能立即分析，也可在右侧填写问题后发送。候选接受前不改变正文。
      </p>
      {reference ? (
        <section className="document-review-text" aria-label="本轮引用">
          <h3>
            {reference.text ? '本轮引用' : '插入位置'} · 修订{' '}
            {submitted ? preview?.range.revision : identity.revision}
          </h3>
          <p>{reference.text || '当前段落光标处；未引用其他正文。'}</p>
          {submitted && !valid && !applying && !verifyApply && (
            <p>工作稿已变化，请保存后重新选取。</p>
          )}
          {!submitted && blocked && <p>请先保存正文，引用不会自动外发。</p>}
        </section>
      ) : (
        <p className="caption">在正文段落中选择文字或放置光标。跨段、列表和表格选区暂不支持。</p>
      )}
      {!submitted && reference?.text && (
        <button
          type="button"
          onClick={() => {
            if (editor) editor.commands.setTextSelection(editor.state.selection.to);
          }}
        >
          移除引用，改为插入
        </button>
      )}
      {variant === 'assistant' ? (
        <EditorConversation
          messages={messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.parts.flatMap((part) =>
              part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [],
            ),
          }))}
          question={question}
          onQuestion={setQuestion}
          send={() => void send()}
          stop={() => void reject()}
          running={running}
          disabled={!canPrepare || submitted || preparing || applying || verifyApply}
        />
      ) : (
        <>
          <label>
            本轮问题
            <textarea
              value={question}
              maxLength={4000}
              rows={3}
              disabled={running || applying || verifyApply}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Enter' ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229 ||
                  composing.current
                )
                  return;
                event.preventDefault();
                send();
              }}
              placeholder="例如：将这一条款改为明确的付款期限"
            />
          </label>
          <div className="document-review-actions">
            <button
              type="button"
              className="primary"
              data-sidebar-expand
              onClick={() => void send()}
              disabled={
                !canPrepare ||
                !question.trim() ||
                submitted ||
                preparing ||
                running ||
                applying ||
                verifyApply
              }
            >
              发送本轮审阅
            </button>
            {running && (
              <button type="button" onClick={() => void reject()}>
                停止
              </button>
            )}
          </div>
        </>
      )}
      {preview && submitted && !terminal && (running || streamed) && !error && (
        <section className="document-review-text" aria-label="流式候选">
          <h3>正在生成候选</h3>
          <p>{streamed || '等待模型响应…'}</p>
        </section>
      )}
      {preview && terminal && (
        <section className="document-review-text" aria-label="替换差异">
          <h3>{action === 'replace' ? '替换差异' : '待插入正文'}</h3>
          {action === 'replace' && <del>{preview.range.text}</del>}
          <label>
            接受方式
            <select
              aria-label="接受方式"
              value={action}
              disabled={applying || !!recovery}
              onChange={(event) => setAction(event.target.value as typeof action)}
            >
              <option value="replace" disabled={!preview.range.text}>
                替换所选文字
              </option>
              <option value="insert_after">插入选区或光标后</option>
              <option value="append">追加到文末</option>
            </select>
          </label>
          <ins>{candidate}</ins>
          {!applicable && <p>请选择适用的接受方式；候选须为有效纯文本，换行将保存为段落。</p>}
          <div className="document-review-actions">
            <button type="button" onClick={() => void reject()} disabled={applying || verifyApply}>
              拒绝
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void apply()}
              disabled={(!valid && !verifyApply) || !applicable || applying}
            >
              {applying
                ? '核对中…'
                : verifyApply
                  ? '核对原提交'
                  : recovery === 'retry'
                    ? '重试确认'
                    : '确认写回'}
            </button>
          </div>
        </section>
      )}
      {error && !running && !terminal && preview && (
        <div className="document-review-actions">
          <button type="button" onClick={() => void recoverRun()}>
            核对本轮结果
          </button>
          <button
            type="button"
            onClick={() =>
              void window.caselite
                .agent({ protocol_version, operation: 'cancel', scope, run_id: preview.id })
                .then(() => recoverRun())
                .catch(() => setNotice('停止结果待核对。'))
            }
          >
            停止原运行
          </button>
        </div>
      )}
      {(notice || error) && <p role="status">{notice || error?.message}</p>}
      {history.length > 0 && (
        <details>
          <summary>本文档本机运行记录</summary>
          {[...history]
            .reverse()
            .slice(0, 10)
            .map((run) => (
              <section key={run.id} className="document-review-text">
                <h3>{run.prompt}</h3>
                <p>{run.status === 'succeeded' ? run.output : run.message}</p>
              </section>
            ))}
        </details>
      )}
    </div>
  );
}
