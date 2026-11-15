import { readDocument } from './read-document';
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
      const result = await readDocument(document);
      return { state: result.state, text: '' };
    },
  });
  if (read.error) return <p role="alert">{read.error.message}</p>;
  if (read.isFetching || !read.data) return <p role="status">正在读取文档预览…</p>;
  if (!read.data.state) return <p>此文档尚无已保存的正文。</p>;
  return (
    <Suspense fallback={<p role="status">正在载入预览…</p>}>
      <PreviewEditor
        value={read.data}
        label="文档正文预览"
        disabled
        readTables
        onChange={ignoreEdit}
      />
    </Suspense>
  );
}
