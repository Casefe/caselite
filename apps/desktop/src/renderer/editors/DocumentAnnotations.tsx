import { useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';

type Comment = { id: string; text: string; quote: string; from: number; to: number };
export default function DocumentAnnotations({
  editor,
  disabled = false,
  readonly = false,
  onDraft,
}: {
  editor: Editor;
  disabled?: boolean;
  readonly?: boolean;
  onDraft?(open: boolean): void;
}) {
  const [draft, setDraft] = useState<{
    id?: string;
    from: number;
    to: number;
    quote: string;
    text: string;
  } | null>(null);
  const [error, setError] = useState('');
  const ui = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const comments = new Map<string, Comment>();
      e.state.doc.descendants((node, pos) => {
        const mark = node.marks.find((m) => m.type.name === 'comment');
        if (!mark) return;
        const id = mark.attrs.id as string;
        const old = comments.get(id);
        if (old) {
          old.quote += node.text ?? '';
          old.to = pos + node.nodeSize;
        } else
          comments.set(id, {
            id,
            text: mark.attrs.text as string,
            quote: node.text ?? '',
            from: pos,
            to: pos + node.nodeSize,
          });
      });
      const { from, to, empty } = e.state.selection;
      let blocked = e.isActive('codeBlock'),
        overlap = false;
      e.state.doc.nodesBetween(from, to, (node) => {
        if (node.type.name === 'codeBlock') blocked = true;
        if (node.marks.some((m) => m.type.name === 'comment')) overlap = true;
      });
      return {
        comments: [...comments.values()],
        from,
        to,
        empty,
        blocked,
        overlap,
        highlighted: e.isActive('highlight'),
      };
    },
  });
  function close() {
    setDraft(null);
    setError('');
    onDraft?.(false);
  }
  function change(id: string, text?: string) {
    if (disabled || readonly) return;
    const type = editor.schema.marks.comment;
    const tr = editor.state.tr;
    // 同一批注可能因加粗、分段而拆开；一次事务更新所有片段，不能留下相同ID的不同正文。
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.marks.some((m) => m.type === type && m.attrs.id === id)) return;
      tr.removeMark(pos, pos + node.nodeSize, type);
      if (text !== undefined) tr.addMark(pos, pos + node.nodeSize, type.create({ id, text }));
    });
    editor.view.dispatch(tr);
  }
  function submit() {
    if (!draft || disabled || readonly) return;
    const text = draft.text.trim();
    if (!text || text.length > 4000) {
      setError('请输入1—4000字的批注。');
      return;
    }
    if (draft.id) change(draft.id, text);
    else {
      if (editor.state.doc.textBetween(draft.from, draft.to, '\n') !== draft.quote) {
        setError('选区已变化，请取消后重新选择。');
        return;
      }
      editor
        .chain()
        .setTextSelection({ from: draft.from, to: draft.to })
        .setMark('comment', { id: crypto.randomUUID(), text })
        .run();
    }
    close();
  }
  const locked = disabled || !!draft;
  return (
    <div className="document-annotations">
      {!readonly && (
        <div className="annotation-tools" role="toolbar" aria-label="文档标记">
          <button
            type="button"
            disabled={locked || ui.empty || ui.blocked}
            aria-pressed={ui.highlighted}
            onClick={() => editor.chain().focus().toggleMark('highlight').run()}
          >
            高亮标记
          </button>
          <button
            type="button"
            disabled={locked || ui.empty || ui.blocked || ui.overlap || ui.comments.length >= 200}
            onClick={() => {
              setDraft({
                from: ui.from,
                to: ui.to,
                quote: editor.state.doc.textBetween(ui.from, ui.to, '\n'),
                text: '',
              });
              onDraft?.(true);
            }}
          >
            添加批注
          </button>
          <span className="caption">选中文字后标记 · {ui.comments.length} 条批注</span>
        </div>
      )}
      {draft && (
        <form
          className="annotation-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <blockquote>{draft.quote.slice(0, 160)}</blockquote>
          <textarea
            autoFocus
            aria-label="批注内容"
            maxLength={4000}
            value={draft.text}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
          <button type="submit" disabled={disabled || !draft.text.trim()}>
            确定批注
          </button>
          <button type="button" onClick={close}>
            取消批注
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      {!!ui.comments.length && (
        <details className="annotation-list" open>
          <summary>批注（{ui.comments.length}）</summary>
          {ui.comments.map((comment) => (
            <article key={comment.id} data-testid="document-comment">
              <button
                type="button"
                className="annotation-quote"
                disabled={!!draft}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTextSelection({ from: comment.from, to: comment.to })
                    .scrollIntoView()
                    .run()
                }
              >
                {comment.quote.slice(0, 160)}
              </button>
              <p>{comment.text}</p>
              {!readonly && (
                <div>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      setDraft(comment);
                      onDraft?.(true);
                    }}
                  >
                    修改批注
                  </button>
                  <button type="button" disabled={locked} onClick={() => change(comment.id)}>
                    删除批注
                  </button>
                </div>
              )}
            </article>
          ))}
        </details>
      )}
    </div>
  );
}
