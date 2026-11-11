import { editorProfiles } from './editor-config';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@tiptap/react';
import * as Y from 'yjs';
import type { Task, TaskRequest } from '../../preload/caselite-api';
import { EditorSurface, localExtensions, useLocalDoc } from './RichEditor';

export default function TaskContentEditor({
  task,
  initial,
  onDirty,
  onSaved,
  disabled = false,
}: {
  task: Task;
  initial: number[] | null;
  onDirty(value: boolean): void;
  onSaved(task: Task, state: number[]): void;
  disabled?: boolean;
}) {
  const doc = useLocalDoc({ text: task.objective, state: initial });
  const [title, setTitle] = useState(task.title);
  const [version, setVersion] = useState(task.version);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [length, setLength] = useState(task.objective.length);
  const [status, setStatus] = useState('任务内容已保存');
  const [hasPending, setHasPending] = useState(false);
  const ready = useRef(false);
  const composing = useRef(false);
  const sequence = useRef(0);
  const pending = useRef<{
    request: Extract<TaskRequest, { operation: 'update' }>;
    sequence: number;
  } | null>(null);
  const editor = useEditor(
    {
      injectCSS: false,
      editable: !disabled,
      extensions: localExtensions(doc),
      editorProps: {
        attributes: {
          'aria-label': '任务内容',
          'data-testid': 'task-content-editor',
          role: 'textbox',
          'aria-multiline': 'true',
        },
      },
      onCreate: () => {
        ready.current = true;
      },
      onUpdate: ({ editor: current }) => {
        if (!ready.current) return;
        sequence.current++;
        setLength(current.getText({ blockSeparator: '\n' }).length);
        setDirty(true);
        onDirty(true);
        setStatus('任务内容有未保存修改');
      },
    },
    [doc],
  );
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  async function save() {
    if (!editor || busy || disabled || length > 4000 || !title.trim()) return;
    const recovering = Boolean(pending.current);
    const current = pending.current ?? {
      sequence: sequence.current,
      request: {
        protocol_version: 1 as const,
        request_id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
        operation: 'update' as const,
        task_id: task.id,
        expected_version: version,
        title: title.trim(),
        objective: editor.getText({ blockSeparator: '\n' }),
        objective_state: Array.from(Y.encodeStateAsUpdate(doc)),
      },
    };
    pending.current = current;
    setHasPending(true);
    setBusy(true);
    setStatus('正在保存任务内容…');
    try {
      let response = await window.caselite.task(
        recovering
          ? {
              operation: 'status',
              protocol_version: 1,
              idempotency_key: current.request.idempotency_key,
            }
          : current.request,
      );
      if (recovering && !response.ok && response.code === 'NOT_FOUND')
        response = await window.caselite.task(current.request);
      if (!response.ok && response.code === 'RESULT_UNKNOWN') {
        response = await window.caselite.task({
          operation: 'status',
          protocol_version: 1,
          idempotency_key: current.request.idempotency_key,
        });
        if (!response.ok) throw new Error('结果尚未确认，请保留输入并再次核对。');
      } else if (
        !response.ok &&
        ['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT'].includes(response.code)
      ) {
        pending.current = null;
        setHasPending(false);
      }
      if (!response.ok) throw new Error(response.message);
      const saved = response.tasks[0];
      if (
        response.receipt !== current.request.idempotency_key ||
        response.tasks.length !== 1 ||
        !saved ||
        saved.id !== task.id ||
        saved.version !== current.request.expected_version + 1 ||
        saved.title !== current.request.title ||
        saved.objective !== current.request.objective
      )
        throw Error('任务内容回执不匹配，请保留输入并核对原提交。');
      pending.current = null;
      setHasPending(false);
      setVersion(saved.version);
      onSaved(saved, current.request.objective_state!);
      const changed = current.sequence !== sequence.current;
      setDirty(changed);
      onDirty(changed);
      setStatus(changed ? '较早任务内容已保存，仍有未保存修改' : '任务内容已保存');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败，输入已保留。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="task-content-panel"
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onKeyDownCapture={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          return;
        if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (dirty || hasPending) void save();
      }}
    >
      <h1 className="sr-only">{title}</h1>
      <label className="task-title-editor">
        <span className="sr-only">任务标题</span>
        <input
          aria-label="任务标题"
          value={title}
          maxLength={160}
          disabled={disabled}
          onChange={(event) => {
            setTitle(event.target.value);
            sequence.current++;
            setDirty(true);
            onDirty(true);
            setStatus('任务内容有未保存修改');
          }}
        />
      </label>
      <EditorSurface
        editor={editor}
        mode={editorProfiles.description.mode}
        blockActions
        disabled={disabled}
        placeholder="描述目标、事实与待处理问题…"
      />
      <footer>
        <span role="status" data-testid="task-content-status">
          {length > 4000 ? '超过4000字符，请精简后保存；输入仍保留。' : status}
        </span>
        <button
          type="button"
          className="primary"
          data-testid="save-task-content"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          title="保存任务内容（⌘ / Ctrl + Enter）"
          disabled={disabled || busy || length > 4000 || !title.trim() || (!dirty && !hasPending)}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : hasPending ? '核对任务内容' : '保存任务内容'}
        </button>
      </footer>
    </section>
  );
}
