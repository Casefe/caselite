import { assertBoundedHtml } from './bounded-html';
import { TableCommands } from './TableCommands';
import { useLocalDoc, type RichDraft } from './editor-state';
import { localExtensions, editorProfiles, type EditorProfile } from './editor-config';
export { draftDoc, emptyDraft, useLocalDoc, type RichDraft } from './editor-state';
export { localExtensions } from './editor-config';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import { createPortal } from 'react-dom';
import * as Y from 'yjs';
import { DocumentWordCount } from './DocumentWordCount';

const blocks = [
  { id: 'paragraph', label: '正文', hint: '普通文本', symbol: 'T' },
  { id: 'heading1', label: '标题 1', hint: '一级标题', symbol: 'H1' },
  { id: 'heading2', label: '标题 2', hint: '二级标题', symbol: 'H2' },
  { id: 'heading3', label: '标题 3', hint: '三级标题', symbol: 'H3' },
  { id: 'bulletList', label: '无序列表', hint: '项目列表', symbol: '•' },
  { id: 'orderedList', label: '有序列表', hint: '编号列表', symbol: '1.' },
  { id: 'blockquote', label: '引用', hint: '引用文字', symbol: '❞' },
  { id: 'codeBlock', label: '代码块', hint: '纯文本代码', symbol: '</>' },
  { id: 'horizontalRule', label: '分隔线', hint: '分隔内容', symbol: '—' },
];
function setBlock(editor: Editor, id: string, range?: { from: number; to: number }) {
  if (!editor.isEditable) return;
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  if (id.startsWith('heading'))
    chain
      .clearNodes()
      .setHeading({ level: Number(id.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6 })
      .run();
  else if (id === 'bulletList') chain.toggleBulletList().run();
  else if (id === 'orderedList') chain.toggleOrderedList().run();
  else if (id === 'blockquote') chain.toggleBlockquote().run();
  else if (id === 'codeBlock') chain.toggleCodeBlock().run();
  else if (id === 'horizontalRule') chain.setHorizontalRule().run();
  else chain.clearNodes().setParagraph().run();
}
function currentBlock(editor: Editor, position = editor.state.selection.from) {
  const at = editor.state.doc.resolve(Math.min(position, editor.state.doc.content.size));
  const index = Math.min(at.index(0), editor.state.doc.childCount - 1);
  let start = 0;
  for (let i = 0; i < index; i++) start += editor.state.doc.child(i).nodeSize;
  const node = editor.state.doc.child(index);
  return { node, index, start, end: start + node.nodeSize };
}
function blockAction(editor: Editor, action: 'up' | 'down' | 'duplicate' | 'delete') {
  if (!editor.isEditable) return;
  const block = currentBlock(editor);
  const tr = editor.state.tr;
  let target = block.start;
  if (action === 'duplicate') {
    tr.insert(block.end, block.node);
    target = block.end;
  } else if (action === 'delete') tr.delete(block.start, block.end);
  else {
    if (action === 'up' && block.index === 0) return;
    if (action === 'down' && block.index >= editor.state.doc.childCount - 1) return;
    target =
      action === 'up'
        ? block.start - editor.state.doc.child(block.index - 1).nodeSize
        : block.start + editor.state.doc.child(block.index + 1).nodeSize;
    tr.delete(block.start, block.end).insert(target, block.node);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(target + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}
function FormatBar({
  editor,
  floating = false,
  marksOnly = false,
}: {
  editor: Editor;
  floating?: boolean;
  marksOnly?: boolean;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      undo: e.can().undo(),
      redo: e.can().redo(),
      heading: [1, 2, 3, 4, 5, 6].find((level) => e.isActive('heading', { level })) ?? 0,
    }),
  });
  return (
    <div
      className={`format-bar ${floating ? 'format-bar--floating' : ''}`}
      role="toolbar"
      aria-label={floating ? '选区格式' : '文档格式'}
      onMouseDown={(event) => event.preventDefault()}
    >
      {!floating && (
        <>
          <button
            type="button"
            aria-label="撤销"
            disabled={!active.undo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            ↶
          </button>
          <button
            type="button"
            aria-label="重做"
            disabled={!active.redo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            ↷
          </button>
          <span className="format-separator" />
        </>
      )}
      {!marksOnly && (
        <>
          <select
            aria-label="段落样式"
            value={active.heading ? `heading${active.heading}` : 'paragraph'}
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => setBlock(editor, event.target.value)}
          >
            <option value="paragraph">正文</option>
            <option value="heading1">标题 1</option>
            <option value="heading2">标题 2</option>
            <option value="heading3">标题 3</option>
            <option value="heading4">标题 4</option>
            <option value="heading5">标题 5</option>
            <option value="heading6">标题 6</option>
          </select>
          <span className="format-separator" />
        </>
      )}
      <button
        type="button"
        aria-label="加粗"
        aria-pressed={active.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </button>
      <button
        type="button"
        aria-label="斜体"
        aria-pressed={active.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </button>
      <button
        type="button"
        aria-label="下划线"
        aria-pressed={active.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <u>U</u>
      </button>
      <button
        type="button"
        aria-label="删除线"
        aria-pressed={active.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </button>
      <button
        type="button"
        aria-label="行内代码"
        aria-pressed={active.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        &lt;/&gt;
      </button>
      {!floating && (
        <>
          <span className="format-separator" />
          <button
            type="button"
            aria-label="无序列表"
            aria-pressed={active.bullet}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            • 列表
          </button>
          <button
            type="button"
            aria-label="有序列表"
            aria-pressed={active.ordered}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1. 列表
          </button>
          <button
            type="button"
            aria-label="引用"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            ❞
          </button>
          <button
            type="button"
            aria-label="代码块"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            {'{ }'}
          </button>
          <button
            type="button"
            aria-label="分隔线"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            —
          </button>
        </>
      )}
    </div>
  );
}

const selectionMenuOptions = {
  placement: 'top' as const,
  offset: 6,
  flip: { padding: 8 },
  shift: { padding: 8 },
};

function SelectionFormatTools({ editor }: { editor: Editor }) {
  const [element] = useState(() => {
    const menu = document.createElement('div');
    menu.className = 'selection-tools';
    return menu;
  });
  const [pluginKey] = useState(() => new PluginKey('selectionFormat'));
  const [active, setActive] = useState(editor.isFocused);
  useEffect(() => {
    const focus = () => setActive(true);
    const blur = ({ event }: { event: FocusEvent }) => {
      if (!(event.relatedTarget instanceof Node && element.contains(event.relatedTarget)))
        setActive(false);
    };
    editor.on('focus', focus);
    editor.on('blur', blur);
    return () => {
      editor.off('focus', focus);
      editor.off('blur', blur);
    };
  }, [editor, element]);
  useEffect(() => {
    if (!active) return;
    // 正文和紧凑描述使用不同滚动祖先；交给官方插件监听，不能只跟随window。
    let parent = editor.view.dom.parentElement;
    let scrollTarget: HTMLElement | Window = window;
    while (parent) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
        scrollTarget = parent;
        break;
      }
      parent = parent.parentElement;
    }
    editor.registerPlugin(
      BubbleMenuPlugin({
        editor,
        element,
        pluginKey,
        options: { ...selectionMenuOptions, scrollTarget },
        updateDelay: 0,
      }),
    );
    // 同步注销当前实例，避免React严格模式重放后被旧的延迟清理移除；不改官方定位算法。
    return () => {
      editor.unregisterPlugin(pluginKey);
      element.remove();
    };
  }, [editor, element, pluginKey, active]);
  return createPortal(
    <div
      onBlur={(event) => {
        const next = event.relatedTarget;
        // 菜单按钮属于当前选区；离开菜单和正文时必须收起，不能把旧选区留在另一对象上。
        if (!(
          next instanceof Node &&
          (element.contains(next) || (!editor.isDestroyed && editor.view.dom.contains(next)))
        ))
          setActive(false);
      }}
    >
      <FormatBar editor={editor} floating marksOnly />
    </div>,
    element,
  );
}

export function EditorSurface({
  editor,
  mode,
  placeholder = '开始输入…',
  disabled = false,
  blockActions = false,
  documentScheme,
}: {
  editor: Editor | null;
  mode: 'notion' | 'simple' | 'compact';
  placeholder?: string;
  disabled?: boolean;
  blockActions?: boolean;
  documentScheme?: 'markdown' | 'word';
}) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef<(ReturnType<typeof currentBlock> & { doc: object }) | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [blockMenu, setBlockMenu] = useState(false);
  const [showFormats, setShowFormats] = useState(false);
  const [composing, setComposing] = useState(false);
  const [pasteError, setPasteError] = useState('');
  useEffect(() => {
    if (disabled) dragging.current = null;
  }, [disabled]);
  const ui = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || !e.isInitialized) return null;
      const selection = e.state.selection;
      const at = selection.$from;
      const before = at.parent.textBetween(0, at.parentOffset, '', '');
      const slash =
        selection.empty &&
        at.parent.type.name === 'paragraph' &&
        at.parentOffset === at.parent.content.size &&
        /^\/[^\s/]*$/.test(before)
          ? { from: at.pos - before.length, to: at.pos, query: before.slice(1) }
          : null;
      let top = 0,
        left = 0,
        width = 400;
      try {
        const box = e.view.coordsAtPos(selection.from);
        const parent = root.current?.getBoundingClientRect();
        width = parent?.width ?? 400;
        top = box.top - (parent?.top ?? box.top) + (root.current?.scrollTop ?? 0);
        left = box.left - (parent?.left ?? box.left);
      } catch {
        /* 首帧尚未挂载时不定位弹层。 */
      }
      return {
        slash,
        selected: !selection.empty,
        empty: e.isEmpty,
        focused: e.isFocused,
        top,
        left,
        width,
        from: selection.from,
        to: selection.to,
        editable: e.isEditable,
      };
    },
  });
  if (!editor)
    return (
      <div className="rich-editor-loading" role="status">
        编辑器载入中…
      </div>
    );
  const editable = !disabled && editor.isEditable;
  const compact = mode === 'compact';
  const documentMode = mode === 'simple';
  const markdown = documentMode && documentScheme === 'markdown';
  const word = documentMode && documentScheme === 'word';
  const trackComposition = compact || documentMode;
  const tableMode = documentMode && Boolean(editor.schema.nodes.table);
  const allowHtml = (html: string, position: number) => {
    if (!tableMode || !html) return true;
    try {
      if (assertBoundedHtml(html)) {
        const at = editor.state.doc.resolve(position);
        for (let depth = at.depth; depth > 0; depth--) {
          if (at.node(depth).type.name === 'table')
            throw new Error('请在表格外粘贴完整表格。单元格内可粘贴文字。');
        }
      }
      setPasteError('');
      return true;
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : '插入内容失败，正文未改变。');
      return false;
    }
  };
  const slashKey = ui?.slash ? `${ui.slash.from}:${ui.slash.query}` : '';
  const choices = blocks.filter((item) =>
    `${item.label}${item.hint}${item.id}`
      .toLowerCase()
      .includes(ui?.slash?.query.toLowerCase() ?? ''),
  );
  const showBlockActions = mode === 'notion' || (compact && blockActions && showFormats);
  const showSlash =
    (showBlockActions || (documentMode && !word && ui?.focused && !composing)) &&
    Boolean(ui?.slash) &&
    dismissed !== slashKey &&
    editable;
  const choose = (id: string) => {
    if (ui?.slash) setBlock(editor, id, ui.slash);
    setIndex(0);
  };
  return (
    <div
      ref={root}
      className={`rich-editor rich-editor--${mode} editor-surface`}
      data-editor-mode={mode}
      data-editor-scheme={documentMode ? documentScheme : undefined}
      aria-disabled={!editable}
      onPasteCapture={(event) => {
        if (!allowHtml(event.clipboardData.getData('text/html'), editor.state.selection.from)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      data-empty={ui?.empty ? 'true' : undefined}
      data-placeholder={placeholder}
      onClickCapture={(event) => {
        if (!editable || !editor.isEditable) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !root.current?.contains(event.relatedTarget)
        ) {
          setBlockMenu(false);
          if (compact) setShowFormats(false);
          if (trackComposition) setComposing(false);
        }
      }}
      onCompositionStartCapture={trackComposition ? () => setComposing(true) : undefined}
      onCompositionEndCapture={trackComposition ? () => setComposing(false) : undefined}
      onKeyDownCapture={(event) => {
        if (compact && !editable) return;
        if (!editable || !editor.isEditable) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.nativeEvent.isComposing || editor.view.composing || (documentMode && composing))
          return;
        if (
          tableMode &&
          event.key === 'Tab' &&
          !event.shiftKey &&
          editor.isActive('table') &&
          !editor.can().goToNextCell()
        ) {
          const at = editor.state.selection.$from;
          for (let depth = at.depth; depth > 0; depth--) {
            if (at.node(depth).type.name === 'table' && at.node(depth).childCount >= 200) {
              // TableKit 末格 Tab 会自动加行，必须保持宿主可保存的上限。
              event.preventDefault();
              event.stopPropagation();
              setPasteError('表格已达 200 行，未新增行。请拆分为另一张表格。');
              return;
            }
          }
        }
        if (event.key === '/') setDismissed('');
        if (!showSlash) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setDismissed(slashKey);
        } else if (choices.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Enter') choose(choices[index % choices.length].id);
          else
            setIndex(
              (n) => (n + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length,
            );
        }
      }}
      onDragOver={(event) => {
        if (dragging.current) event.preventDefault();
      }}
      onDropCapture={(event) => {
        const original = dragging.current;
        dragging.current = null;
        if (!editable || !editor.isEditable) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!original) {
          const target = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (
            !allowHtml(
              event.dataTransfer.getData('text/html'),
              target?.pos ?? editor.state.selection.from,
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (original.doc !== editor.state.doc) return;
        const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return;
        const target = currentBlock(editor, at.pos);
        const element = editor.view.nodeDOM(target.start);
        const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : null;
        const destination =
          rect && event.clientY > rect.top + rect.height / 2 ? target.end : target.start;
        if (destination >= original.start && destination <= original.end) return;
        const insert =
          destination > original.start ? destination - original.node.nodeSize : destination;
        const tr = editor.state.tr
          .delete(original.start, original.end)
          .insert(insert, original.node);
        tr.setSelection(TextSelection.near(tr.doc.resolve(insert + 1)));
        editor.view.dispatch(tr.scrollIntoView());
      }}
    >
      {pasteError && <p role="alert">{pasteError}</p>}
      {documentMode && documentScheme && (
        <div className="editor-scheme-bar">
          <span>{word ? 'Word · 连续纸张' : 'Markdown · 快捷写作'}</span>
          {markdown ? (
            <details className="markdown-format-menu">
              <summary>格式与表格</summary>
              <div className="simple-toolbar">
                <FormatBar editor={editor} />
                {tableMode && <TableCommands editor={editor} />}
              </div>
            </details>
          ) : (
            <small>基础格式</small>
          )}
        </div>
      )}
      {documentMode && !markdown && (
        <div className="simple-toolbar">
          <FormatBar editor={editor} />
          {tableMode && <TableCommands editor={editor} />}
        </div>
      )}
      <EditorContent className="rich-editor-content" editor={editor} />
      {documentMode && <DocumentWordCount editor={editor} />}
      {compact && editable && (
        <>
          <button
            className="compact-format-toggle"
            type="button"
            aria-expanded={showFormats}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setShowFormats((shown) => !shown)}
          >
            格式工具
          </button>
          {showFormats && <FormatBar editor={editor} />}
          {!showFormats && !composing && ui?.selected && <SelectionFormatTools editor={editor} />}
        </>
      )}
      {documentMode && editable && !composing && ui?.selected && (
        <SelectionFormatTools editor={editor} />
      )}
      {showBlockActions && editable && ui && (
        <div className="block-controls" style={{ top: Math.max(8, ui.top) }}>
          <button
            type="button"
            aria-label="插入内容块"
            title="插入内容块"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const block = currentBlock(editor);
              editor
                .chain()
                .focus()
                .insertContentAt(block.end, {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '/' }],
                })
                .run();
            }}
          >
            +
          </button>
          <button
            type="button"
            draggable
            aria-label="块操作"
            title="拖动调整顺序，点击查看块操作"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setBlockMenu(!blockMenu)}
            onDragStart={(event) => {
              if (!editable || !editor.isEditable) {
                event.preventDefault();
                return;
              }
              dragging.current = { ...currentBlock(editor), doc: editor.state.doc };
              event.dataTransfer.setData('application/x-caselite-editor-block', 'move');
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              dragging.current = null;
            }}
          >
            ⠿
          </button>
        </div>
      )}
      {mode === 'notion' && ui?.selected && ui.focused && editable && !showSlash && (
        <div
          className="selection-tools"
          style={{
            top: ui.top - 64,
            left: Math.max(8, Math.min(ui.left, ui.width - 340)),
          }}
        >
          <FormatBar editor={editor} floating />
        </div>
      )}
      {showSlash && (
        <div
          className="slash-menu"
          role="listbox"
          aria-label="插入内容块"
          style={{
            top: ui!.top + 28,
            left: Math.max(12, Math.min(ui!.left, ui!.width - 270)),
          }}
        >
          <div className="slash-menu-title">
            基础内容块 <small>↑↓ 选择 · Enter 插入</small>
          </div>
          {choices.map((item, i) => (
            <button
              type="button"
              role="option"
              aria-selected={i === index % choices.length}
              key={item.id}
              data-block-command={item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item.id)}
            >
              <span>{item.symbol}</span>
              <div>
                {item.label}
                <small>{item.hint}</small>
              </div>
            </button>
          ))}
          {choices.length === 0 && <p>没有匹配的内容块</p>}
        </div>
      )}
      {blockMenu && showBlockActions && editable && (
        <div
          className="block-menu"
          role="menu"
          aria-label="当前内容块"
          style={{ top: Math.max(35, ui?.top ?? 0) }}
        >
          {(
            [
              ['up', '上移'],
              ['down', '下移'],
              ['duplicate', '复制块'],
              ['delete', '删除块'],
            ] as const
          ).map(([action, label]) => (
            <button
              type="button"
              role="menuitem"
              key={action}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                blockAction(editor, action);
                setBlockMenu(false);
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => setBlockMenu(false)}>
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

export type DraftEditorHandle = { append(text: string): void };
export const DraftEditor = forwardRef<
  DraftEditorHandle,
  {
    value: RichDraft;
    onChange(value: RichDraft): void;
    label: string;
    testId?: string;
    placeholder?: string;
    disabled?: boolean;
    compact?: boolean;
    profile?: EditorProfile;
    readTables?: boolean;
  }
>(function DraftEditor(
  {
    value,
    onChange,
    label,
    testId,
    placeholder,
    disabled = false,
    compact = false,
    profile,
    readTables = false,
  },
  ref,
) {
  const doc = useLocalDoc(value);
  const ready = useRef(false);
  const editor = useEditor(
    {
      injectCSS: false,
      extensions: localExtensions(doc, readTables && disabled),
      editable: !disabled,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': label,
          'data-testid': testId ?? 'rich-input',
          'aria-multiline': 'true',
        },
      },
      // 初始Yjs水合不属于用户编辑，不能把重开正文标成未保存。
      onCreate: () => {
        ready.current = true;
      },
      onUpdate: ({ editor: current }) => {
        if (!ready.current) return;
        onChange({
          text: current.getText({ blockSeparator: '\n' }),
          state: Array.from(Y.encodeStateAsUpdate(doc)),
        });
      },
    },
    [doc],
  );
  useEffect(() => {
    // 保存中或归档只改变可写性，不应触发正文更新并把已保存页面重新标成未保存。
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useImperativeHandle(
    ref,
    () => ({
      append(text) {
        if (!editor || disabled || !editor.isEditable) return;
        const content = text.split('\n').map((line) => ({
          type: 'paragraph',
          ...(line ? { content: [{ type: 'text', text: line }] } : {}),
        }));
        if (editor.isEmpty) editor.chain().focus().setContent({ type: 'doc', content }).run();
        else
          editor.chain().focus('end').insertContentAt(editor.state.doc.content.size, content).run();
      },
    }),
    [editor, disabled],
  );
  return (
    <EditorSurface
      editor={editor}
      mode={editorProfiles[profile ?? (compact ? 'description' : 'draft')].mode}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
});
