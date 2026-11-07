import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import type { CatalogDocument } from '../../../preload/caselite-api';

const PreviewEditor = lazy(async () => ({
  default: (await import('../../editors/RichEditor')).DraftEditor,
}));
const ignoreEdit = () => {};

export default function DocumentPreview({ document }: { document: CatalogDocument }) {
  const read = useQuery({
    queryKey: ['document-preview', document.id, document.version, document.body_revision],
    gcTime: 0,
    staleTime: 0,
    queryFn: async () => {
      const result = await window.caselite.task({
        operation: 'read',
        protocol_version: 1,
        task_id: document.task_id,
      });
      if (!result.ok) throw new Error(result.message);
      const task = result.tasks[0];
      if (
        task?.id !== document.task_id ||
        task.document_id !== document.id ||
        task.matter_id !== document.matter_id ||
        task.body_revision !== document.body_revision ||
        Boolean(task.document_archived_at) !== Boolean(document.archived_at)
      )
        throw new Error('文档版本或归属已变化，请先刷新目录。');
      return { state: result.state, text: '' };
    },
  });
  if (read.error) return <p role="alert">{read.error.message}</p>;
  if (read.isFetching || !read.data) return <p role="status">正在读取文档预览…</p>;
  if (!read.data.state) return <p>此文档尚无已保存的正文。</p>;
  return (
    <Suspense fallback={<p role="status">正在载入预览…</p>}>
      <PreviewEditor value={read.data} label="文档正文预览" disabled onChange={ignoreEdit} />
    </Suspense>
  );
}
