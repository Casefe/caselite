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
}: {
  document: CatalogDocument;
  generation?: number;
  disabled: boolean;
  mirror?: boolean;
  onDirty(value: boolean): void;
  onSaved(task: Task): void | string;
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
    queryFn: async () => {
      const result = await window.caselite.task({
        protocol_version: 1,
        operation: 'read',
        task_id: document.task_id,
      });
      if (!result.ok) throw new Error(result.message);
      const task = result.tasks[0];
      if (
        task?.id !== document.task_id ||
        task.document_id !== document.id ||
        task.body_id !== document.body_id ||
        task.matter_id !== document.matter_id ||
        task.body_revision !== document.body_revision ||
        Boolean(task.document_archived_at) !== Boolean(document.archived_at)
      )
        throw new Error('文档版本或归属已变化，请先刷新目录。');
      return { task, state: result.state };
    },
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
  const stale =
    read.data.task.body_revision !== document.body_revision ||
    (autosave && sessionRevision !== null && sessionRevision !== document.body_revision) ||
    read.data.task.matter_id !== document.matter_id;
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
        task={read.data.task}
        initial={read.data.state}
        disabled={disabled || !!document.archived_at || stale || !!read.error}
        embedded
        autosave={autosave}
        onSaveState={reportSaveState}
        reviewDock={null}
        reviewSaving={reviewSaving}
        onReviewSaving={reviewBusy}
        onDirty={bodyDirty}
        onSaved={async (task, state) => {
          if (autosave) await cancelCatalogReads(client);
          if (!alive.current) return;
          setSessionRevision(task.body_revision);
          // 更新读取投影，不替换BodyEditor实例；当前Y.Doc/选区和撤销历史继续由原会话持有。
          // 先完成旧查询的取消回滚，再同时发布两个投影，避免自己的 ACK 造成 stale 锁。
          return notifyManager.batch(() => {
            client.setQueryData<{ task: Task; state: number[] | null }>(key, (old) =>
              autosave && old && old.task.body_revision > task.body_revision
                ? old
                : { task, state },
            );
            return onSaved(task);
          });
        }}
      />
    </div>
  );
}
