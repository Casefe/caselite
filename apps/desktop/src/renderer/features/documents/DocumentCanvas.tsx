import { readDocument, type EditableDocument } from './read-document';
import { notifyManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CatalogDocument, Task } from '../../../preload/caselite-api';
import BodyEditor, { type BodySaveState } from './BodyEditor';
import { cancelCatalogReads } from '../../shared/data/ordinary-catalog-query';
import DocumentPreview from './DocumentPreview';

export default function DocumentCanvas({
  document,
  generation = 0,
  disabled,
  mirror = false,
  onDirty,
  onSaved,
  onReload,
  autosave = false,
  onSaveState,
  exportActive = true,
}: {
  document: CatalogDocument;
  generation?: number;
  disabled: boolean;
  mirror?: boolean;
  onDirty(value: boolean): void;
  onSaved(document: Task | CatalogDocument): void | string;
  exportActive?: boolean;
  onReload?(): void;
  autosave?: boolean;
  onSaveState?(state: BodySaveState | null): void;
}) {
  const client = useQueryClient();
  const dirtyCallback = useRef(onDirty);
  const stateCallback = useRef(onSaveState);
  const alive = useRef(true);
  const [sessionRevision, setSessionRevision] = useState<number | null>(null);
  const [bodyBlocked, setBodyBlocked] = useState(false);
  useLayoutEffect(() => {
    stateCallback.current = onSaveState;
  }, [onSaveState]);
  const reportSaveState = useCallback((state: BodySaveState | null) => {
    if (state) setSessionRevision(state.revision);
    stateCallback.current?.(state);
  }, []);
  const blockers = useRef({ body: false, review: false });
  const [reviewSaving, setReviewSaving] = useState(false);
  // 正文草稿与导出未知结果分别持有导航锁，任一结束不能释放另一方的保护。
  const bodyDirty = useCallback((value: boolean) => {
    setBodyBlocked(value);
    blockers.current.body = value;
    dirtyCallback.current(blockers.current.body || blockers.current.review);
  }, []);
  const reviewBusy = useCallback((value: boolean) => {
    blockers.current.review = value;
    setReviewSaving(value);
    dirtyCallback.current(blockers.current.body || blockers.current.review);
  }, []);
  useEffect(() => {
    dirtyCallback.current = onDirty;
  }, [onDirty]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      dirtyCallback.current(false);
    };
  }, []);
  const key = ['document-edit', document.id, generation];
  const read = useQuery({
    queryKey: key,
    enabled: !mirror,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: () => readDocument(document),
  });
  if (mirror)
    return (
      <>
        <p className="document-readonly-note">同一文档的对照栏 · 只读，请在主栏修改。</p>
        <DocumentPreview document={document} />
      </>
    );
  if (read.error && !read.data)
    return (
      <>
        <p role="alert">{read.error.message}</p>
        {onReload && (
          <button disabled={disabled} onClick={onReload}>
            重新读取文档
          </button>
        )}
      </>
    );
  if (!read.data) return <p role="status">正在读取文档…</p>;
  const loaded = read.data.kind === 'task' ? read.data.task : read.data.document;
  const stale =
    loaded.body_revision !== document.body_revision ||
    (autosave && sessionRevision !== null && sessionRevision !== document.body_revision) ||
    loaded.matter_id !== document.matter_id;
  const publish = async (saved: Task | CatalogDocument, state: number[]) => {
    if (autosave) await cancelCatalogReads(client);
    if (!alive.current) return;
    setSessionRevision(saved.body_revision);
    return notifyManager.batch(() => {
      client.setQueryData<EditableDocument>(key, (old) => {
        const revision =
          old?.kind === 'task' ? old.task.body_revision : old?.document.body_revision;
        if (autosave && revision !== undefined && revision > saved.body_revision) return old;
        return 'document_id' in saved
          ? { kind: 'task', task: saved, state }
          : { kind: 'personal', document: saved, state };
      });
      return onSaved(saved);
    });
  };
  const owner =
    read.data.kind === 'task'
      ? { task: read.data.task, onSaved: publish }
      : { document: read.data.document, onSaved: publish };
  return (
    <div className="document-inline-editor">
      {stale && <p role="alert">文档已有其他修订，请保留当前输入并重新读取后核对。</p>}
      {read.error && (
        <div>
          <p role="alert">文档读取失败，当前输入已保留。{read.error.message}</p>
          <button disabled={read.isFetching} onClick={() => void read.refetch()}>
            重试读取文档
          </button>
        </div>
      )}
      {autosave && document.archived_at && bodyBlocked && (
        <p role="alert">文档已归档，未保存输入已保留；恢复后继续保存。</p>
      )}
      <BodyEditor
        key={document.id}
        {...owner}
        exportActive={exportActive}
        initial={read.data.state}
        disabled={disabled || !!document.archived_at || stale || !!read.error}
        embedded
        autosave={autosave}
        onSaveState={reportSaveState}
        reviewDock={null}
        reviewSaving={reviewSaving}
        onReviewSaving={reviewBusy}
        onDirty={bodyDirty}
      />
    </div>
  );
}
