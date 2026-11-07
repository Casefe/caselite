import { useChat } from '@ai-sdk/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentModel, AgentRun, ReviewRange, ReviewSaved } from '../../preload/caselite-api';
import type { Editor } from '@tiptap/react';
import { documentReviewTransport, type DocumentScope } from './document-review-transport';

const protocol_version = 1 as const;

function currentRange(editor: Editor) {
  const { $from, $to, empty } = editor.state.selection;
  if (
    empty ||
    $from.depth !== 1 ||
    !$from.sameParent($to) ||
    $from.parent.type.name !== 'paragraph' ||
    $from.parent.textContent.length !== $from.parent.content.size
  )
    return;
  return {
    paragraph: $from.index(0),
    from: $from.parentOffset,
    to: $to.parentOffset,
    text: $from.parent.textBetween($from.parentOffset, $to.parentOffset),
  };
}

export default function DocumentReview({
  editor,
  identity,
  blocked,
  onApplyBusy,
  onSaved,
}: {
  editor: Editor | null;
  identity: Omit<ReviewRange, 'paragraph' | 'from' | 'to' | 'text'>;
  blocked: boolean;
  onApplyBusy(value: boolean): void;
  onSaved(result: ReviewSaved): void;
}) {
  const scope: DocumentScope = `document:${identity.document_id}`;
  const [preview, setPreview] = useState<{ id: string; range: ReviewRange; model: AgentModel }>();
  const [question, setQuestion] = useState('');
  const [terminal, setTerminal] = useState<AgentRun>();
  const [history, setHistory] = useState<AgentRun[]>([]);
  const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [recovery, setRecovery] = useState<'verify' | 'retry' | null>(null);
  const verifyApply = recovery === 'verify';
  const [submitted, setSubmitted] = useState(false);
  const alive = useRef(true);
  const previewId = useRef<string | undefined>(undefined);
  const lock = useRef(false);
  const composing = useRef(false);
  const transport = useMemo(() => documentReviewTransport(scope, setTerminal), [scope]);
  const { messages, sendMessage, setMessages, stop, status, error, clearError } = useChat({
    id: scope,
    transport,
  });
  const running = status === 'submitted' || status === 'streaming';
  const valid = preview && !blocked && preview.range.revision === identity.revision;
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
    candidate !== preview?.range.text &&
    !/[\p{Cc}\u2028\u2029\uD800-\uDFFF]/u.test(candidate),
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

  async function prepare() {
    if (lock.current || blocked || running || !editor || editor.view.composing) return;
    const selection = currentRange(editor);
    if (!selection?.text.trim() || selection.text.length > 8000 || identity.revision < 1) {
      setNotice('请在已保存正文中选中同一段落内的文字，最多 8000 字符。');
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
      if (!alive.current) {
        if (result.ok && result.review_preview) void discard(result.review_preview.id);
        return;
      }
      if (!result.ok) return setNotice(result.message);
      if (!result.review_preview) return setNotice('无法核对所选文字，请重试。');
      previewId.current = result.review_preview.id;
      setPreview({ ...result.review_preview, model: result.model });
      setMessages([]);
      setTerminal(undefined);
      setSubmitted(false);
      setRecovery(null);
      clearError();
      setNotice('');
    } catch {
      if (alive.current) setNotice('无法核对所选文字，请重试。');
    } finally {
      lock.current = false;
      if (alive.current) setPreparing(false);
    }
  }

  function send() {
    if (!valid || lock.current || running || submitted || !question.trim() || composing.current)
      return;
    lock.current = true;
    setNotice('');
    setSubmitted(true);
    void sendMessage(
      { text: question.trim() },
      { body: { id: preview.id, model: preview.model } },
    ).finally(() => {
      lock.current = false;
    });
  }

  async function reject() {
    if (!preview) return;
    const runId = preview.id;
    setPreview(undefined);
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
    lock.current = true;
    setApplying(true);
    onApplyBusy(true);
    // 确认后锁定编辑器和导航。回执未知时保留同一候选，只允许核对原提交。
    editor?.setEditable(false, false);
    let nextRecovery: typeof recovery = null;
    try {
      const request = { protocol_version, scope, run_id: preview.id };
      const result = await window.caselite.agent(
        verifyApply
          ? { ...request, operation: 'status_review' }
          : { ...request, operation: 'apply_review', confirmed: true },
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
    <div className="document-review">
      <h2>文档 AI 审阅</h2>
      {new URLSearchParams(window.location.search).has('mock-agent') && (
        <p className="caption">合成演示 · MOCK_ONLY</p>
      )}
      <p className="caption">本轮仅发送所选文字与下方问题。确认前可核对替换内容。</p>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void prepare()}
        disabled={blocked || running || preparing || applying || verifyApply}
      >
        {preparing ? '正在核对…' : '引用所选文字'}
      </button>
      {preview && (
        <section className="document-review-text" aria-label="本轮引用">
          <h3>本轮引用 · 修订 {preview.range.revision}</h3>
          <p>{preview.range.text}</p>
          {!valid && !applying && !verifyApply && <p>工作稿已变化，请保存后重新选取。</p>}
        </section>
      )}
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
          onClick={send}
          disabled={
            !valid ||
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
      {preview && submitted && !terminal && (running || streamed) && !error && (
        <section className="document-review-text" aria-label="流式候选">
          <h3>正在生成候选</h3>
          <p>{streamed || '等待模型响应…'}</p>
        </section>
      )}
      {preview && terminal && (
        <section className="document-review-text" aria-label="替换差异">
          <h3>替换差异</h3>
          <del>{preview.range.text}</del>
          <ins>{candidate}</ins>
          {!applicable && <p>只有不同于原文的单行纯文本可写回。</p>}
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
