import DocumentAnnotations from '../../editors/DocumentAnnotations';
import { hasDocumentAnnotations } from '../../editors/document-annotation-marks';
import {
  editorCapabilities,
  editorProfiles,
  reviewUpdateOrigin,
} from '../../editors/editor-config';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

export type BodySaveState = {
  bodyId: string;
  revision: number;
  phase: 'editing' | 'saving' | 'saved' | 'failed' | 'unknown';
  message: string;
  canRetry: boolean;
  retry(): void;
};
type SaveRequest = Extract<TaskRequest, { operation: 'save' }>;

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
  autosave = false,
  onSaveState,
}: {
  task: Task;
  initial: number[] | null;
  onSaved(task: Task, state: number[]): void | string | Promise<void | string>;
  onDirty(dirty: boolean): void;
  disabled?: boolean;
  reviewDock: HTMLElement | null;
  reviewSaving: boolean;
  onReviewSaving(value: boolean): void;
  reviewVariant?: 'review' | 'assistant';
  embedded?: boolean;
  autosave?: boolean;
  onSaveState?(state: BodySaveState | null): void;
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
  const [phase, setPhase] = useState<BodySaveState['phase']>('saved');
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
  const pending = useRef<{ request: SaveRequest; sequence: number } | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const failed = useRef(false);
  const confirmedRevision = useRef(revision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useRef(() => {});
  const saveLatest = useRef<() => Promise<void>>(async () => {});
  const stateCallback = useRef(onSaveState);
  useLayoutEffect(() => {
    stateCallback.current = onSaveState;
  }, [onSaveState]);
  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const editor = useEditor(
    {
      injectCSS: false,
      editable: !task.document_archived_at && !disabled,
      extensions: localExtensions(doc, editorCapabilities.document),
      editorProps: {
        attributes: { 'aria-label': '成果正文', 'data-testid': 'body-editor', role: 'textbox' },
        handleDOMEvents: {
          compositionstart: () => {
            composing.current = true;
            stopTimer();
            return false;
          },
          compositionend: () => {
            composing.current = false;
            // 先让 ProseMirror 结束组合态并接纳最终文字，再重新计时。
            queueMicrotask(() => schedule.current());
            return false;
          },
        },
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
        if (!failed.current) {
          setStatus('有未保存修改');
          setPhase('editing');
        }
        schedule.current();
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
      stopTimer();
      queueMicrotask(() => {
        if (!alive.current) doc.destroy();
      });
    };
  }, [doc, stopTimer]);
  async function save() {
    if (
      !alive.current ||
      !editor ||
      editor.isDestroyed ||
      inFlight.current ||
      disabled ||
      task.document_archived_at ||
      reviewSaving ||
      annotationDraft ||
      composing.current ||
      editor.view?.composing ||
      (autosave && !bodyDirty.current && !pending.current)
    )
      return;
    inFlight.current = true;
    stopTimer();
    setBusy(true);
    setStatus('正在保存…');
    setPhase('saving');
    const sequence = pending.current?.sequence ?? changes.current;
    let failurePhase: BodySaveState['phase'] = 'failed';
    try {
      const request: SaveRequest = pending.current?.request ?? {
        ...mutation(),
        operation: 'save',
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: confirmedRevision.current,
        editor_schema: editorSchema === 2 || hasDocumentAnnotations(editor) ? 2 : 1,
        state: Array.from(Y.encodeStateAsUpdate(doc)),
      };
      const reconciling = !!pending.current;
      pending.current = { request, sequence };
      setHasPending(true);
      failurePhase = 'unknown';
      // 已有待确认提交先核对原键；只有明确不存在回执时才重试同一请求。
      let result: Awaited<ReturnType<typeof window.caselite.task>>;
      let resultSource: 'save' | 'status';
      if (reconciling) {
        resultSource = 'status';
        result = await window.caselite.task({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: request.idempotency_key,
        });
      } else {
        resultSource = 'save';
        result = await window.caselite.task(request);
      }
      if (reconciling && !result.ok && result.code === 'NOT_FOUND') {
        resultSource = 'save';
        result = await window.caselite.task(request);
      }
      if (!result.ok && result.code === 'RESULT_UNKNOWN') {
        resultSource = 'status';
        result = await window.caselite.task({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: request.idempotency_key,
        });
        if (!result.ok) throw new Error('保存结果尚未确认，请保留输入并点击核对保存结果。');
      }
      if (!result.ok && result.code === 'INVALID_REQUEST' && resultSource === 'save') {
        // 只有实际 save 的结构化拒绝能证明该冻结请求未写入；status 错误仍须保留原键核对。
        pending.current = null;
        setHasPending(false);
      }
      if (!result.ok && result.code !== 'RESULT_UNKNOWN' && result.code !== 'READ_FAILED')
        failurePhase = 'failed';
      const response = check(result);
      const saved = response.tasks[0];
      // 回执必须属于冻结的原提交，不能用另一个对象或修订清除当前草稿。
      if (
        response.receipt !== request.idempotency_key ||
        saved?.id !== request.task_id ||
        saved.document_id !== request.document_id ||
        saved.body_id !== request.body_id ||
        saved.body_revision !== request.expected_revision + 1 ||
        saved.editor_schema !== request.editor_schema
      ) {
        failurePhase = 'unknown';
        throw new Error('保存回执与原提交不一致，请保留输入并核对保存结果。');
      }
      if (!alive.current) return;
      pending.current = null;
      failed.current = false;
      setHasPending(false);
      confirmedRevision.current = saved.body_revision;
      setEditorSchema(saved.editor_schema);
      setRevision(saved.body_revision);
      let projectionFailed = false;
      let notice: void | string = undefined;
      try {
        notice = await onSaved(saved, request.state);
      } catch {
        // 正文已经落盘，目录投影失败不能重新提交这个正文。
        projectionFailed = true;
      }
      if (!alive.current) return;
      const unchanged = sequence === changes.current;
      bodyDirty.current = !unchanged;
      setDirty(!unchanged);
      onDirty(!unchanged);
      setPhase(unchanged ? 'saved' : 'editing');
      setStatus(
        unchanged
          ? projectionFailed
            ? '正文已保存，目录刷新失败，请重新读取目录。'
            : notice || '已保存到此设备'
          : '较早修订已保存，仍有未保存修改',
      );
    } catch (error) {
      failed.current = true;
      if (alive.current) {
        setPhase(failurePhase);
        setStatus(error instanceof Error ? error.message : '保存失败，输入已保留。');
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setBusy(false);
        schedule.current();
      }
    }
  }
  useLayoutEffect(() => {
    // 只在已提交的渲染后更新回调，稳定事件入口不捕获旧 revision/锁状态。
    saveLatest.current = save;
    schedule.current = () => {
      stopTimer();
      if (
        !autosave ||
        !alive.current ||
        !editor ||
        inFlight.current ||
        failed.current ||
        !bodyDirty.current ||
        disabled ||
        task.document_archived_at ||
        reviewSaving ||
        annotationDraft ||
        composing.current ||
        editor.view?.composing
      )
        return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void saveLatest.current();
      }, 800);
    };
  });
  useEffect(() => {
    schedule.current();
  }, [autosave, editor, disabled, task.document_archived_at, reviewSaving, annotationDraft]);
  useEffect(() => {
    if (!autosave) return;
    const guard = (event: BeforeUnloadEvent) => {
      // ref 同步挡住输入与 React 父级 dirty 回报之间的关闭窗口。
      if (bodyDirty.current || pending.current || inFlight.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [autosave]);
  const retry = useCallback(() => void saveLatest.current(), []);
  const saveState = useMemo<BodySaveState>(
    () => ({
      bodyId: task.body_id,
      revision,
      phase,
      message: task.document_archived_at ? '文档已归档 · 只读' : status,
      canRetry:
        (hasPending || (phase === 'failed' && dirty)) &&
        !busy &&
        !disabled &&
        !reviewSaving &&
        !annotationDraft &&
        !task.document_archived_at,
      retry,
    }),
    [
      task.body_id,
      task.document_archived_at,
      revision,
      phase,
      status,
      hasPending,
      dirty,
      busy,
      disabled,
      reviewSaving,
      annotationDraft,
      retry,
    ],
  );
  useEffect(() => {
    if (autosave) stateCallback.current?.(saveState);
  }, [autosave, saveState]);
  useEffect(() => () => stateCallback.current?.(null), []);
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
        {embedded && !autosave && saveControls}
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
        {!embedded && !autosave && saveControls}
        {!embedded && (
          <p className="caption">仅已确认保存的内容可在退出后恢复。当前成果尚未进行法律核验。</p>
        )}
        <button
          type="button"
          className="delivery-entry"
          disabled={disabled || annotationDraft || busy || hasPending || reviewSaving}
          onClick={() => setDeliveryOpen(true)}
        >
          交付版本
        </button>
      </section>
      {deliveryOpen && (
        <DeliverySnapshots
          task={{ ...task, editor_schema: editorSchema }}
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
                confirmedRevision.current = saved.body_revision;
                setPhase('saved');
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
