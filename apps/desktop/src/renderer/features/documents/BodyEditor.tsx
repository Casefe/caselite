import { useWorkspacePageActions } from '../../ui/FourColumnWorkspace';
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
import {
  bodyPersistence,
  type BodyOwnerProps,
  type BodyRequest,
  type BodyResponse,
} from './body-persistence';
import { Icon } from '../../shared/ui/Icon';
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
type SaveRequest = BodyRequest;

export default function BodyEditor(
  props: BodyOwnerProps & {
    initial: number[] | null;
    onDirty(dirty: boolean): void;
    disabled?: boolean;
    reviewDock: HTMLElement | null;
    reviewSaving: boolean;
    onReviewSaving(value: boolean): void;
    reviewVariant?: 'review' | 'assistant';
    embedded?: boolean;
    autosave?: boolean;
    exportActive?: boolean;
    onSaveState?(state: BodySaveState | null): void;
  },
) {
  const {
    task,
    initial,
    onDirty,
    disabled = false,
    reviewDock,
    reviewSaving,
    onReviewSaving,
    reviewVariant = 'review',
    embedded = false,
    autosave = false,
    onSaveState,
    exportActive = true,
  } = props;
  const persistence = bodyPersistence(props);
  const identity = persistence.identity;
  const { preferences } = useLocalPreferences();
  const [doc] = useState(() => {
    const d = new Y.Doc();
    if (initial) Y.applyUpdate(d, Uint8Array.from(initial));
    return d;
  });
  const [editorSchema, setEditorSchema] = useState(identity.schema);
  const [annotationDraft, setAnnotationDraft] = useState(false);
  const [revision, setRevision] = useState(identity.revision);
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
      editable: !identity.archivedAt && !disabled,
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
      !identity.archivedAt && !disabled && !reviewSaving && !annotationDraft,
      false,
    );
  }, [editor, identity.archivedAt, disabled, reviewSaving, annotationDraft]);
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
      identity.archivedAt ||
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
      const request: SaveRequest =
        pending.current?.request ??
        persistence.request(
          confirmedRevision.current,
          editorSchema === 2 || hasDocumentAnnotations(editor) ? 2 : 1,
          Array.from(Y.encodeStateAsUpdate(doc)),
        );
      const reconciling = !!pending.current;
      pending.current = { request, sequence };
      setHasPending(true);
      failurePhase = 'unknown';
      // 已有待确认提交先核对原键；只有明确不存在回执时才重试同一请求。
      let result: BodyResponse;
      let resultSource: 'save' | 'status';
      if (reconciling) {
        resultSource = 'status';
        result = await persistence.status(request);
      } else {
        resultSource = 'save';
        result = await persistence.submit(request);
      }
      if (reconciling && !result.ok && result.code === 'NOT_FOUND') {
        resultSource = 'save';
        result = await persistence.submit(request);
      }
      if (!result.ok && result.code === 'RESULT_UNKNOWN') {
        resultSource = 'status';
        result = await persistence.status(request);
        if (!result.ok) throw new Error('保存结果尚未确认，请保留输入并点击核对保存结果。');
      }
      if (!result.ok && result.code === 'INVALID_REQUEST' && resultSource === 'save') {
        // 只有实际 save 的结构化拒绝能证明该冻结请求未写入；status 错误仍须保留原键核对。
        pending.current = null;
        setHasPending(false);
      }
      if (!result.ok && result.code !== 'RESULT_UNKNOWN' && result.code !== 'READ_FAILED')
        failurePhase = 'failed';
      if (!result.ok) throw new Error(result.message);
      failurePhase = 'unknown';
      const saved = persistence.accept(result, request);
      if (!alive.current) return;
      pending.current = null;
      failed.current = false;
      setHasPending(false);
      confirmedRevision.current = saved.revision;
      setEditorSchema(saved.schema);
      setRevision(saved.revision);
      let projectionFailed = false;
      let notice: void | string = undefined;
      try {
        notice = await saved.publish(request.state);
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
        identity.archivedAt ||
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
  }, [autosave, editor, disabled, identity.archivedAt, reviewSaving, annotationDraft]);
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
      bodyId: identity.bodyId,
      revision,
      phase,
      message: identity.archivedAt ? '文档已归档 · 只读' : status,
      canRetry:
        (hasPending || (phase === 'failed' && dirty)) &&
        !busy &&
        !disabled &&
        !reviewSaving &&
        !annotationDraft &&
        !identity.archivedAt,
      retry,
    }),
    [
      identity.bodyId,
      identity.archivedAt,
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
        {identity.archivedAt ? '文档已归档 · 只读' : status}
      </span>
      <button
        className="primary"
        data-testid="save-body"
        disabled={
          disabled ||
          annotationDraft ||
          reviewSaving ||
          !!identity.archivedAt ||
          busy ||
          (!dirty && !hasPending)
        }
        onClick={() => void save()}
      >
        {busy ? '保存中…' : hasPending ? '核对并保存' : '保存正文'}
      </button>
    </footer>
  );
  useWorkspacePageActions({
    export: exportActive
      ? {
          run: () => setDeliveryOpen(true),
          disabled:
            !task || disabled || dirty || annotationDraft || busy || hasPending || reviewSaving,
          reason: !task
            ? '独立文档暂不支持固定交付导出'
            : dirty
              ? '请先保存当前正文，再导出固定修订'
              : undefined,
        }
      : undefined,
  });
  return (
    <>
      <section className="document" hidden={deliveryOpen}>
        <div className="document-bar">
          <span>
            <Icon name="file" size={16} /> {embedded ? identity.title : '内部沟通初稿'}{' '}
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
            disabled={disabled || busy || hasPending || reviewSaving || !!identity.archivedAt}
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
          disabled={disabled || annotationDraft || reviewSaving || !!identity.archivedAt}
          mode={editorProfiles.document.mode}
          documentScheme={embedded ? 'word' : (preferences.editor_mode ?? 'markdown')}
          selectionActions={
            editor &&
            task &&
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
                  !identity.archivedAt
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
          disabled={!task || disabled || annotationDraft || busy || hasPending || reviewSaving}
          title={!task ? '独立文档暂不支持固定交付版本' : undefined}
          onClick={() => setDeliveryOpen(true)}
        >
          交付版本
        </button>
      </section>
      {task && deliveryOpen && (
        <DeliverySnapshots
          task={{ ...task, editor_schema: editorSchema }}
          revision={revision}
          dirty={dirty}
          disabled={disabled || busy || hasPending || !!identity.archivedAt}
          onBack={() => setDeliveryOpen(false)}
          onBusy={onReviewSaving}
        />
      )}
      {task &&
        reviewDock &&
        createPortal(
          <div hidden={deliveryOpen}>
            <DocumentReview
              title={identity.title}
              key={identity.documentId}
              variant={reviewVariant}
              editor={editor}
              skillHandle={skillHandle}
              onSkillAvailability={setSkillAvailable}
              identity={{
                task_id: task.id,
                document_id: identity.documentId,
                body_id: identity.bodyId,
                revision,
              }}
              blocked={
                editorSchema === 2 ||
                annotationDraft ||
                deliveryOpen ||
                disabled ||
                !!identity.archivedAt ||
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
                if (props.task) props.onSaved(saved, state);
              }}
            />
          </div>,
          reviewDock,
        )}
    </>
  );
}
