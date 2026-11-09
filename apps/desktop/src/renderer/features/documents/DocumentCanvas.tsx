import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogDocument, Task } from '../../../preload/caselite-api';
import BodyEditor from './BodyEditor';
import DocumentPreview from './DocumentPreview';

export default function DocumentCanvas({
  document,
  generation = 0,
  disabled,
  mirror = false,
  onDirty,
  onSaved,
  onReload,
}: {
  document: CatalogDocument;
  generation?: number;
  disabled: boolean;
  mirror?: boolean;
  onDirty(value: boolean): void;
  onSaved(task: Task): void;
  onReload?(): void;
}) {
  const client = useQueryClient();
  const dirtyCallback = useRef(onDirty);
  const blockers = useRef({ body: false, review: false });
  const [reviewSaving, setReviewSaving] = useState(false);
  // 正文草稿与导出未知结果分别持有导航锁，任一结束不能释放另一方的保护。
  const bodyDirty = useCallback((value: boolean) => {
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
  useEffect(() => () => dirtyCallback.current(false), []);
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
  if (read.error)
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
    read.data.task.matter_id !== document.matter_id;
  return (
    <div className="document-inline-editor">
      {stale && <p role="alert">文档已有其他修订，请保留当前输入并重新读取后核对。</p>}
      <BodyEditor
        key={document.id}
        task={read.data.task}
        initial={read.data.state}
        disabled={disabled || !!document.archived_at || stale}
        embedded
        reviewDock={null}
        reviewSaving={reviewSaving}
        onReviewSaving={reviewBusy}
        onDirty={bodyDirty}
        onSaved={(task, state) => {
          // 更新读取投影，不替换BodyEditor实例；当前Y.Doc/选区和撤销历史继续由原会话持有。
          client.setQueryData(key, { task, state });
          onSaved(task);
        }}
      />
    </div>
  );
}
