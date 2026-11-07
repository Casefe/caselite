import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CatalogRequest, DiscussionEntry, DiscussionScope } from '../../preload/caselite-api';
import { DraftEditor, emptyDraft } from '../editors/RichEditor';
import { catalogMutation } from '../ui/useCatalog';

type Publication = Extract<CatalogRequest, { operation: 'publish_discussion' }>;
const labels = {
  project_comment: '项目评论',
  update: '项目更新',
  update_comment: '更新评论',
};

export default function ProjectDiscussion({
  projectId,
  activity = false,
  archived,
  disabled,
  onDirty,
}: {
  projectId: string;
  activity?: boolean;
  archived: boolean;
  disabled: boolean;
  onDirty(value: boolean): void;
}) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const scope = { kind: activity ? 'update' : 'project_comment', project_id: projectId } as const;
  const reportDirty = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  const props = { archived, disabled, onDirty: reportDirty };
  return (
    <section className="project-record-panel project-discussion" aria-label={labels[scope.kind]}>
      <h2>{activity ? '人工项目更新' : '项目整体评论'}</h2>
      <DiscussionFeed scope={scope} compose={!replyTo} {...props}>
        {activity
          ? (entry, reading) => (
              <>
                <button
                  type="button"
                  disabled={disabled || dirty || reading}
                  aria-expanded={replyTo === entry.id}
                  onClick={() => setReplyTo(replyTo === entry.id ? null : entry.id)}
                >
                  {replyTo === entry.id ? '收起讨论' : '查看与评论更新'}
                </button>
                {replyTo === entry.id && (
                  <DiscussionFeed
                    key={entry.id}
                    scope={{ kind: 'update_comment', project_id: projectId, update_id: entry.id }}
                    compose
                    {...props}
                  />
                )}
              </>
            )
          : undefined}
      </DiscussionFeed>
    </section>
  );
}

function DiscussionFeed({
  scope,
  archived,
  disabled,
  compose,
  onDirty,
  children,
}: {
  scope: DiscussionScope;
  archived: boolean;
  disabled: boolean;
  compose: boolean;
  onDirty(value: boolean): void;
  children?: (entry: DiscussionEntry, reading: boolean) => React.ReactNode;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const [epoch, setEpoch] = useState(0);
  const [page, setPage] = useState<{ entries: DiscussionEntry[]; next: number | null } | null>(
    null,
  );
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<{ message: string; before?: number } | null>(null);
  const [writeError, setWriteError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const original = useRef<Publication | null>(null);
  const saving = useRef(false);
  const composing = useRef(false);
  const generation = useRef(0);
  const label = labels[scope.kind];

  async function load(before?: number) {
    const current = ++generation.current;
    setReading(true);
    setReadError(null);
    try {
      const result = await window.caselite.catalog({
        operation: 'list_discussion',
        protocol_version: 1,
        scope,
        ...(before === undefined ? {} : { before }),
      });
      if (current !== generation.current) return;
      if (!result.ok || !result.discussion) {
        setReadError({ message: result.ok ? '无法读取讨论，请重试。' : result.message, before });
        return;
      }
      const discussion = result.discussion;
      setPage((prior) =>
        before === undefined
          ? discussion
          : { entries: [...(prior?.entries ?? []), ...discussion.entries], next: discussion.next },
      );
    } catch {
      if (current === generation.current)
        setReadError({ message: '无法读取讨论，请重试。', before });
    } finally {
      if (current === generation.current) setReading(false);
    }
  }
  const readFirst = useEffectEvent(() => void load());
  const invalidateRead = useEffectEvent(() => {
    generation.current++;
  });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) readFirst();
    });
    return () => {
      active = false;
      invalidateRead();
    };
  }, []);

  function resetDraft() {
    setDraft(emptyDraft());
    setEpoch((n) => n + 1);
    onDirty(false);
  }
  async function publish(request: Publication, checkFirst = false) {
    if (saving.current) return;
    saving.current = true;
    original.current = request;
    setPending(true);
    onDirty(true);
    setWriteError('');
    setSaved(false);
    try {
      let result = await window.caselite.catalog(
        checkFirst
          ? { operation: 'status', protocol_version: 1, idempotency_key: request.idempotency_key }
          : request,
      );
      // 未知时仅在原键明确未落盘后重放，避免重复发布。
      if (checkFirst && !result.ok && result.code === 'NOT_FOUND')
        result = await window.caselite.catalog(request);
      if (!result.ok) {
        const uncertain = result.code === 'UNAVAILABLE' || result.code === 'RESULT_UNKNOWN';
        setUnknown(uncertain);
        if (!uncertain) original.current = null;
        setWriteError(result.message);
        return;
      }
      if (result.receipt !== request.idempotency_key || !result.target_id)
        throw new Error('Invalid publication receipt');
      original.current = null;
      setUnknown(false);
      setSaved(true);
      resetDraft();
      void load();
    } catch {
      setUnknown(true);
      setWriteError('发布结果未知，草稿已保留。请核对原发布。');
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  const tooLong = draft.text.trim().length > 8000 || (draft.state?.length ?? 0) > 32768;
  return (
    <>
      {compose && !archived && (
        <div
          className="project-discussion-compose"
          onCompositionStartCapture={() => {
            composing.current = true;
          }}
          onCompositionEndCapture={() => {
            composing.current = false;
          }}
          onBlurCapture={() => {
            composing.current = false;
          }}
        >
          <DraftEditor
            key={epoch}
            label={label}
            placeholder={`输入${label}…`}
            value={draft}
            onChange={(value) => {
              setDraft(value);
              setSaved(false);
              onDirty(true);
            }}
            disabled={disabled || pending || unknown}
            compact
          />
          <button
            type="button"
            className="primary"
            disabled={
              disabled || pending || unknown || !draft.text.trim() || !draft.state || tooLong
            }
            onClick={() => {
              if (!composing.current && draft.state)
                void publish(
                  catalogMutation({ operation: 'publish_discussion', scope, state: draft.state }),
                );
            }}
          >
            发布{label}
          </button>
          {draft.state && !unknown && (
            <button
              type="button"
              disabled={disabled || pending}
              onClick={() => {
                if (window.confirm('放弃当前未发布的草稿？')) {
                  resetDraft();
                  setWriteError('');
                }
              }}
            >
              放弃草稿
            </button>
          )}
          {tooLong && <p role="alert">正文超出发布大小限制。请缩短内容后再发布。</p>}
        </div>
      )}
      {archived && <p>项目已归档，讨论只读。</p>}
      {writeError && <p role="alert">{writeError}</p>}
      {unknown && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (original.current) void publish(original.current, true);
          }}
        >
          核对原发布
        </button>
      )}
      {saved && <p role="status">已发布{label}。</p>}
      {reading && <p role="status">正在读取{label}…</p>}
      {readError && (
        <p role="alert">
          {readError.message}{' '}
          <button
            type="button"
            disabled={!compose || pending}
            onClick={() => void load(readError.before)}
          >
            重新读取
          </button>
        </p>
      )}
      {page && page.entries.length === 0 && <p>暂无{label}。</p>}
      {page?.entries.map((entry) => (
        <article className="project-discussion-entry" key={entry.id} data-discussion-id={entry.id}>
          <time dateTime={entry.committed_at}>
            {new Date(entry.committed_at).toLocaleString('zh-CN')}
          </time>
          <DraftEditor
            label={`已发布${label}`}
            value={{ text: '', state: entry.state }}
            onChange={() => {}}
            disabled
            compact
          />
          {children?.(entry, reading)}
        </article>
      ))}
      {page?.next != null && (
        <button
          type="button"
          disabled={reading || !compose || pending}
          onClick={() => void load(page.next!)}
        >
          加载更早的{label}
        </button>
      )}
    </>
  );
}
