import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CatalogDocument } from '../../../preload/caselite-api';
import { DraftEditor } from '../../editors/RichEditor';

export function DocumentVersions({
  document,
  selected,
  disabled,
  onSelect,
}: {
  document: CatalogDocument;
  selected: string | null;
  disabled: boolean;
  onSelect(id: string | null): void;
}) {
  const list = useInfiniteQuery({
    queryKey: ['delivery-snapshots', document.task_id, document.id],
    initialPageParam: 0,
    gcTime: 0,
    staleTime: 0,
    queryFn: async ({ pageParam }) => {
      const r = await window.caselite.task({
        protocol_version: 1,
        operation: 'list_snapshots',
        task_id: document.task_id,
        document_id: document.id,
        offset: pageParam,
      });
      if (
        !r.ok ||
        !r.snapshots ||
        !r.page ||
        r.snapshots.some(
          (s) =>
            s.task_id !== document.task_id ||
            s.document_id !== document.id ||
            s.body_id !== document.body_id,
        )
      )
        throw new Error('暂时无法读取文档版本。');
      return { rows: r.snapshots, page: r.page };
    },
    getNextPageParam: (last) =>
      last.page.has_more ? last.page.offset + last.rows.length : undefined,
  });
  const versions = list.data?.pages.flatMap((p) => p.rows) ?? [];
  return (
    <section className="document-versions" aria-label="文档版本">
      <h3>版本</h3>
      <button
        type="button"
        disabled={disabled}
        className="document-version-row"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        <strong>当前工作稿</strong>
        <span>修订 {document.body_revision}</span>
      </button>
      {versions.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={disabled}
          className="document-version-row"
          aria-pressed={selected === s.id}
          onClick={() => onSelect(s.id)}
        >
          <strong>{s.note || s.title}</strong>
          <span>固定版本 · 修订 {s.body_revision}</span>
          <small>{new Date(s.created_at).toLocaleString('zh-CN')}</small>
        </button>
      ))}
      {list.isPending && <p role="status">正在读取版本…</p>}
      {list.error && (
        <>
          <p role="alert">{list.error.message}</p>
          <button disabled={disabled || list.isFetching} onClick={() => void list.refetch()}>
            重读版本
          </button>
        </>
      )}
      {!list.isPending && !list.error && !versions.length && (
        <p className="caption">暂无固定版本。</p>
      )}
      {list.hasNextPage && (
        <button disabled={disabled || list.isFetching} onClick={() => void list.fetchNextPage()}>
          更多版本
        </button>
      )}
    </section>
  );
}

export function FixedDocumentVersion({ document, id }: { document: CatalogDocument; id: string }) {
  const read = useQuery({
    queryKey: ['document-fixed-version', document.id, id],
    gcTime: 0,
    queryFn: async () => {
      const r = await window.caselite.task({
        protocol_version: 1,
        operation: 'read_snapshot',
        task_id: document.task_id,
        document_id: document.id,
        snapshot_id: id,
      });
      const s = r.ok ? r.snapshots?.[0] : undefined;
      if (
        !r.ok ||
        !r.state ||
        s?.id !== id ||
        s.document_id !== document.id ||
        s.task_id !== document.task_id ||
        s.body_id !== document.body_id
      )
        throw new Error('固定版本不可读取，请重新选择版本。');
      return { snapshot: s, state: r.state };
    },
  });
  if (read.error) return <p role="alert">{read.error.message}</p>;
  if (!read.data) return <p role="status">正在读取固定版本…</p>;
  return (
    <>
      <p className="document-readonly-note">
        固定版本 · 修订 {read.data.snapshot.body_revision} · 只读
      </p>
      <DraftEditor
        key={id}
        value={{ state: read.data.state, text: '' }}
        disabled
        readTables
        label="固定版本正文"
        onChange={() => {}}
      />
    </>
  );
}
