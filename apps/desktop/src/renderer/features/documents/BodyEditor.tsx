import DocumentAnnotations from '../../editors/DocumentAnnotations';
import { hasDocumentAnnotations } from '../../editors/document-annotation-marks';
import { editorProfiles, reviewUpdateOrigin } from '../../editors/editor-config';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '@tiptap/react';
import * as Y from 'yjs';
import type { Task, TaskRequest } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';
import { mutation, check } from '../../shared/data/taskCommand';
import { EditorSurface, localExtensions } from '../../editors/RichEditor';
import DocumentReview, { WritingSkillMenu, type WritingSkillHandle } from './review/DocumentReview';
import DeliverySnapshots from './delivery/DeliverySnapshots';
import { useLocalPreferences } from '../../shared/data/LocalPreferences';

export default function BodyEditor({
  task,
  initial,
  onSaved,
  onDirty,
  disabled = false,
  reviewDock,
  reviewSaving,
  onReviewSaving,
  reviewVariant = 'review',
  embedded = false,
}: {
  task: Task;
  initial: number[] | null;
  onSaved(task: Task, state: number[]): void;
  onDirty(dirty: boolean): void;
  disabled?: boolean;
  reviewDock: HTMLElement | null;
  reviewSaving: boolean;
  onReviewSaving(value: boolean): void;
  reviewVariant?: 'review' | 'assistant';
  embedded?: boolean;
}) {
  const { preferences } = useLocalPreferences();
  const [doc] = useState(() => {
    const d = new Y.Doc();
    if (initial) Y.applyUpdate(d, Uint8Array.from(initial));
    return d;
  });
  const [editorSchema, setEditorSchema] = useState(task.editor_schema);
  const [annotationDraft, setAnnotationDraft] = useState(false);
  const [revision, setRevision] = useState(task.body_revision);
  const [status, setStatus] = useState('已保存到此设备');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const skillHandle = useRef<WritingSkillHandle>(null);
  const [skillAvailable, setSkillAvailable] = useState(false);
  const changes = useRef(0);
  const bodyDirty = useRef(false);
  const reviewHydrating = useRef(false);
  const editorReady = useRef(false);
  const pending = useRef<{ request: TaskRequest; sequence: number } | null>(null);
  const alive = useRef(true);
  const editor = useEditor(
    {
      injectCSS: false,
      editable: !task.document_archived_at && !disabled,
      extensions: localExtensions(doc, true, true),
      editorProps: {
        attributes: { 'aria-label': '成果正文', 'data-testid': 'body-editor', role: 'textbox' },
      },
      onCreate: () => {
        editorReady.current = true;
      },
      onUpdate: () => {
        if (!editorReady.current || reviewHydrating.current) return;
        changes.current++;
        bodyDirty.current = true;
        setDirty(true);
        onDirty(true);
        setStatus('有未保存修改');
      },
    },
    [doc],
  );
  useEffect(() => {
    // 只切换可编辑性，不发出正文update，避免把属性锁定误记成正文修改。
    editor?.setEditable(
      !task.document_archived_at && !disabled && !reviewSaving && !annotationDraft,
      false,
    );
  }, [editor, task.document_archived_at, disabled, reviewSaving, annotationDraft]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => {
        if (!alive.current) doc.destroy();
      });
    };
  }, [doc]);
  async function save() {
    if (!editor || busy || disabled || reviewSaving || annotationDraft) return;
    setBusy(true);
    setStatus('正在保存…');
    const sequence = pending.current?.sequence ?? changes.current;
    const request: TaskRequest = pending.current?.request ?? {
      ...mutation(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: revision,
      editor_schema: editorSchema === 2 || hasDocumentAnnotations(editor) ? 2 : 1,
      state: Array.from(Y.encodeStateAsUpdate(doc)),
    };
    const reconciling = !!pending.current;
    pending.current = { request, sequence };
    setHasPending(true);
    try {
      // 已有待确认提交先核对原键；只有明确不存在回执时才重试同一请求。
      let result = reconciling
        ? await window.caselite.task({
            protocol_version: 1,
            operation: 'status',
            idempotency_key: 'idempotency_key' in request ? request.idempotency_key : '',
          })
        : await window.caselite.task(request);
      if (reconciling && !result.ok && result.code === 'NOT_FOUND')
        result = await window.caselite.task(request);
      if (!result.ok && result.code === 'RESULT_UNKNOWN') {
        result = await window.caselite.task({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: 'idempotency_key' in request ? request.idempotency_key : '',
        });
        if (!result.ok) throw new Error('保存结果尚未确认，请保留输入并点击核对保存结果。');
      }
      const saved = check(result).tasks[0];
      if (!alive.current) return;
      pending.current = null;
      setHasPending(false);
      setEditorSchema(saved.editor_schema);
      setRevision(saved.body_revision);
      onSaved(saved, request.operation === 'save' ? request.state : []);
      const unchanged = sequence === changes.current;
      bodyDirty.current = !unchanged;
      setDirty(!unchanged);
      onDirty(!unchanged);
      setStatus(unchanged ? '已保存到此设备' : '较早修订已保存，仍有未保存修改');
    } catch (error) {
      if (alive.current)
        setStatus(error instanceof Error ? error.message : '保存失败，输入已保留。');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const saveControls = (
    <footer>
      <span role="status" data-testid="save-status">
        {task.document_archived_at ? '文档已归档 · 只读' : status}
      </span>
      <button
        className="primary"
        data-testid="save-body"
        disabled={
          disabled ||
          annotationDraft ||
          reviewSaving ||
          !!task.document_archived_at ||
          busy ||
          (!dirty && !hasPending)
        }
        onClick={() => void save()}
      >
        {busy ? '保存中…' : hasPending ? '核对并保存' : '保存正文'}
      </button>
    </footer>
  );
  return (
    <>
      <section className="document" hidden={deliveryOpen}>
        <div className="document-bar">
          <span>
            <Icon name="file" size={16} /> {embedded ? task.title : '内部沟通初稿'}{' '}
            <small className="draft-badge">草稿</small>
          </span>
          <span>
            修订 <b data-testid="revision">{revision}</b>
          </span>
        </div>
        {embedded && saveControls}
        {editor && (
          <DocumentAnnotations
            editor={editor}
            disabled={disabled || busy || hasPending || reviewSaving || !!task.document_archived_at}
            onDraft={(open) => {
              setAnnotationDraft(open);
              onDirty(open || bodyDirty.current || pending.current !== null);
            }}
          />
        )}
        {(editorSchema === 2 || dirty) && (
          <p className="caption annotation-compatibility">
            高亮和批注随正文保存。保存标记后，此工作稿暂不支持新建固定交付版本或单段 AI
            写回；已有固定版本仍可查看和导出。
          </p>
        )}
        <EditorSurface
          editor={editor}
          disabled={disabled || annotationDraft || reviewSaving || !!task.document_archived_at}
          mode={editorProfiles.document.mode}
          documentScheme={embedded ? 'word' : (preferences.editor_mode ?? 'markdown')}
          selectionActions={
            editor &&
            reviewDock && (
              <WritingSkillMenu
                editor={editor}
                revision={revision}
                enabled={
                  editorSchema === 1 &&
                  !annotationDraft &&
                  skillAvailable &&
                  !dirty &&
                  !busy &&
                  !hasPending &&
                  !disabled &&
                  !reviewSaving &&
                  !task.document_archived_at
                }
                onPick={(request) => skillHandle.current?.pick(request)}
              />
            )
          }
        />
        {!embedded && saveControls}
        {!embedded && (
          <p className="caption">仅已确认保存的内容可在退出后恢复。当前成果尚未进行法律核验。</p>
        )}
        {!embedded && (
          <button
            type="button"
            className="delivery-entry"
            disabled={disabled || annotationDraft || busy || hasPending || reviewSaving}
            onClick={() => setDeliveryOpen(true)}
          >
            交付版本
          </button>
        )}
      </section>
      {deliveryOpen && (
        <DeliverySnapshots
          task={task}
          revision={revision}
          dirty={dirty}
          disabled={disabled || busy || hasPending || !!task.document_archived_at}
          onBack={() => setDeliveryOpen(false)}
          onBusy={onReviewSaving}
        />
      )}
      {reviewDock &&
        createPortal(
          <div hidden={deliveryOpen}>
            <DocumentReview
              title={task.title}
              key={task.document_id}
              variant={reviewVariant}
              editor={editor}
              skillHandle={skillHandle}
              onSkillAvailability={setSkillAvailable}
              identity={{
                task_id: task.id,
                document_id: task.document_id,
                body_id: task.body_id,
                revision,
              }}
              blocked={
                editorSchema === 2 ||
                annotationDraft ||
                deliveryOpen ||
                disabled ||
                !!task.document_archived_at ||
                dirty ||
                busy ||
                hasPending
              }
              onApplyBusy={onReviewSaving}
              onSaved={({ task: saved, state }) => {
                reviewHydrating.current = true;
                try {
                  Y.applyUpdate(doc, Uint8Array.from(state), reviewUpdateOrigin);
                } finally {
                  reviewHydrating.current = false;
                }
                setRevision(saved.body_revision);
                setStatus('已保存到此设备');
                onSaved(saved, state);
              }}
            />
          </div>,
          reviewDock,
        )}
    </>
  );
}
