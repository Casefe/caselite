import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CatalogDocument, Task } from '../../preload/caselite-api';
import SplitPreviewWorkspace, {
  useSplitPreviewSelection,
  type PreviewPane,
} from '../shared/ui/SplitPreviewWorkspace';
import ReadTable from '../shared/ui/ReadTable';
import { Icon } from '../shared/ui/Icon';
import { useOrdinaryCatalog } from '../shared/data/ordinary-catalog-query';
import { catalogMutation } from '../shared/data/catalogMutation';
import DocumentCanvas from '../features/documents/DocumentCanvas';
import DocumentFolderTree, { documentFolderGroups } from '../features/documents/DocumentFolderTree';
import DocumentFormatExample, {
  formatExamples,
} from '../features/documents/DocumentFormatExamples';
import { FixedDocumentVersion } from '../features/documents/DocumentVersions';
import DocumentInspector from './DocumentInspector';
import { useCatalog } from './useCatalog';

export default function DocumentLibrary({
  library = false,
  onDirty,
}: {
  library?: boolean;
  onOpen(id: string): void;
  onDirty(value: boolean): void;
}) {
  const client = useQueryClient(),
    read = useOrdinaryCatalog(),
    c = useCatalog(false, read);
  const selection = useSplitPreviewSelection();
  const [reading, setReading] = useState(false);
  const [reload, setReload] = useState(0);
  const [folder, setFolder] = useState('all'),
    [text, setText] = useState(''),
    [page, setPage] = useState(0);
  const [visited, setVisited] = useState<Record<string, number>>({});
  const [tagDraft, setTagDraft] = useState(false),
    [tagEditor, setTagEditor] = useState(0);
  const [acknowledged, setAcknowledged] = useState<{ id: string; version: number } | null>(null);
  const [dirtyEditors, setDirtyEditors] = useState<Record<string, boolean>>({});
  const [versions, setVersions] = useState<Record<PreviewPane, string | null>>({
    primary: null,
    secondary: null,
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const all = c.data?.documents ?? [];
  const available = all.filter((d) => (!library || d.in_library) && !d.archived_at);
  const groups = documentFolderGroups(available, c.data?.projects ?? [], visited);
  const selectedFolder = groups.flatMap((g) => [g, ...g.children]).find((g) => g.id === folder);
  const docs = (selectedFolder?.documents ?? available)
    .filter((d) => d.title.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(docs.length / 20));
  const index = docs.findIndex((d) => d.id === selection.selectedId);
  const currentPage = index >= 0 ? Math.floor(index / 20) : Math.min(page, pages - 1);
  const visible = docs.slice(currentPage * 20, currentPage * 20 + 20);
  const ids = {
    primary: selection.primary ?? visible[0]?.id ?? null,
    secondary: selection.secondary,
  };
  const primary = docs.find((d) => d.id === ids.primary),
    secondary = docs.find((d) => d.id === ids.secondary);
  const current = selection.active === 'primary' ? primary : secondary;
  const example = formatExamples.find((e) => e.id === ids[selection.active]);
  const awaitingRead =
    !!acknowledged &&
    !all.some((d) => d.id === acknowledged.id && d.version >= acknowledged.version);
  const bodyDirty = Object.values(dirtyEditors).some(Boolean);
  const dirty = bodyDirty || tagDraft || c.pending || c.unknown || awaitingRead;
  const blocked = dirty || read.isFetching;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  function editorDirty(key: string, value: boolean) {
    if (value) {
      const divider = key.indexOf(':');
      selection.pin(key.slice(0, divider) as PreviewPane, key.slice(divider + 1));
    }
    setDirtyEditors((old) => (old[key] === value ? old : { ...old, [key]: value }));
  }
  function choose(id: string | null) {
    if (blocked) return;
    selection.select(id);
    setReading(true);
    setVersions((old) => ({ ...old, [selection.active]: null }));
    if (id && !id.startsWith('example:')) setVisited((old) => ({ ...old, [id]: Date.now() }));
  }
  function resetDirectory() {
    selection.reset();
    setReading(false);
    setVersions({ primary: null, secondary: null });
    setPage(0);
  }
  async function tags(tags: string[], added = false) {
    if (!current) return;
    const doc = current;
    await c.execute(
      catalogMutation({
        operation: 'organize_document',
        id: doc.id,
        expected_version: doc.version,
        collection: doc.collection,
        tags,
        favorite: doc.favorite,
        in_library: doc.in_library,
      }),
      () => {
        setAcknowledged({ id: doc.id, version: doc.version + 1 });
        if (added) {
          setTagDraft(false);
          setTagEditor((n) => n + 1);
        }
      },
    );
  }
  async function refresh() {
    const result = await c.load();
    if (result) setReload((n) => n + 1);
  }
  function saved(task: Task) {
    client.setQueriesData({ queryKey: ['catalog'] }, (old: unknown) => {
      const value = old as typeof c.data;
      return value?.ok
        ? {
            ...value,
            documents: value.documents.map((d) =>
              d.id === task.document_id
                ? {
                    ...d,
                    body_revision: task.body_revision,
                    version: task.document_metadata_version ?? d.version,
                    updated_at: task.updated_at,
                  }
                : d,
            ),
          }
        : old;
    });
    read.onCommit();
    void c.load();
  }
  function pane(slot: PreviewPane, doc: CatalogDocument | undefined) {
    const sample = formatExamples.find((e) => e.id === ids[slot]);
    if (sample)
      return {
        title: sample.title,
        content: (
          <DocumentFormatExample key={sample.id} example={sample} onClose={() => choose(null)} />
        ),
      };
    if (!doc) return null;
    const selectedVersion = versions[slot],
      key = slot + ':' + doc.id;
    const otherDirty = Object.entries(dirtyEditors).some(([id, value]) => id !== key && value);
    return {
      title: doc.title,
      content: selectedVersion ? (
        <FixedDocumentVersion key={selectedVersion} document={doc} id={selectedVersion} />
      ) : (
        <DocumentCanvas
          key={doc.id + ':' + reload}
          generation={reload}
          document={doc}
          mirror={slot === 'secondary' && primary?.id === doc.id && !versions.primary}
          disabled={
            read.isFetching || tagDraft || c.pending || c.unknown || awaitingRead || otherDirty
          }
          onDirty={(value) => editorDirty(key, value)}
          onSaved={saved}
        />
      ),
    };
  }
  return (
    <section
      className={`collection-workspace catalog-view document-workspace ${library ? 'knowledge-view' : ''}`}
      data-layout="three-column"
      data-collection={library ? 'knowledge' : 'documents'}
      data-directory-view={reading ? 'preview' : 'list'}
    >
      <div className="collection-main">
        <header className="collection-heading">
          <Icon name={library ? 'book' : 'folder'} size={18} />
          <h1 tabIndex={-1} ref={heading}>
            {library ? '知识库' : '文档'}
          </h1>
          <span>{available.length}</span>
        </header>
        <DocumentFolderTree
          documents={available}
          projects={c.data?.projects ?? []}
          visited={visited}
          selected={folder}
          disabled={blocked}
          onSelect={(value) => {
            setFolder(value.id);
            resetDirectory();
          }}
        />
        <section className="document-example-list" aria-label="合成格式示例">
          <h2>
            格式示例 <small>合成</small>
          </h2>
          {formatExamples.map((e) => (
            <button
              key={e.id}
              aria-label={e.title}
              disabled={blocked}
              aria-pressed={ids[selection.active] === e.id}
              onClick={() => choose(e.id)}
            >
              <span className="document-format-badge">{e.format === 'Word' ? 'W' : 'PDF'}</span>
              <span>{e.title}</span>
            </button>
          ))}
        </section>
        <div className="document-list-heading">
          <strong>{selectedFolder?.label ?? '全部文档'}</strong>
          <button
            disabled={bodyDirty || c.pending || c.unknown || tagDraft || (awaitingRead && !c.error)}
            onClick={() => void refresh()}
          >
            刷新
          </button>
        </div>
        <input
          className="document-directory-search"
          aria-label="搜索文档"
          placeholder="搜索文档…"
          value={text}
          disabled={blocked}
          onChange={(e) => {
            setText(e.target.value);
            resetDirectory();
          }}
        />
        {c.error && <p role="alert">{c.error}</p>}
        {c.unknown && (
          <button disabled={c.pending} onClick={() => void c.retry()}>
            核对原提交
          </button>
        )}
        <div className="collection-scroll">
          <ReadTable
            label={library ? '知识库列表' : '文档列表'}
            className="catalog-table document-directory-table"
            data={visible}
            getRowId={(d) => d.id}
            columns={[
              {
                id: 'title',
                header: '名称',
                cell: ({ row }) => (
                  <>
                    <Icon name="file" size={14} /> {row.original.title}
                  </>
                ),
              },
              { accessorKey: 'body_revision', header: '修订' },
            ]}
            rowProps={(doc) => ({
              tabIndex: 0,
              'data-document-id': doc.id,
              'aria-selected': current?.id === doc.id,
              onClick: () => choose(doc.id),
              onKeyDown: (event) => {
                if (
                  (event.key === 'Enter' || event.key === ' ') &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  choose(doc.id);
                }
              },
            })}
          />
          {!c.data && !c.error ? (
            <p className="catalog-empty">正在读取…</p>
          ) : (
            !docs.length && <p className="catalog-empty">没有符合条件的文档。</p>
          )}
        </div>
        {pages > 1 && (
          <nav className="document-pagination" aria-label="文档分页">
            <button
              disabled={blocked || currentPage === 0}
              onClick={() => {
                setPage(currentPage - 1);
                selection.select(null);
              }}
            >
              上一页
            </button>
            <span>
              第 {currentPage + 1} / {pages} 页 · 共 {docs.length} 份
            </span>
            <button
              disabled={blocked || currentPage + 1 === pages}
              onClick={() => {
                setPage(currentPage + 1);
                selection.select(null);
              }}
            >
              下一页
            </button>
          </nav>
        )}
        <footer className="collection-footer">{available.length} 份文档 · 仅此设备</footer>
      </div>
      <div className="document-center-workspace">
        <SplitPreviewWorkspace
          split={selection.split}
          activePane={selection.active}
          disabled={blocked}
          onActivate={(pane) => {
            if (!blocked) selection.activate(pane);
          }}
          onToggle={() => selection.toggle(ids.primary)}
          primary={pane('primary', primary)}
          secondary={pane('secondary', secondary)}
          actions={
            <button
              className="document-directory-back"
              onClick={() => {
                setReading(false);
                requestAnimationFrame(() => heading.current?.focus());
              }}
              disabled={dirty}
            >
              返回文件夹
            </button>
          }
        />
      </div>
      <div className="document-directory-sidebar">
        <DocumentInspector
          key={current?.id ?? example?.id ?? 'empty'}
          document={current}
          example={example}
          project={c.data?.projects.find((p) => p.id === current?.matter_id)}
          blocked={blocked}
          tagDraft={tagDraft}
          tagsDisabled={
            bodyDirty ||
            read.isFetching ||
            c.pending ||
            c.unknown ||
            awaitingRead ||
            !!current?.archived_at
          }
          tagsLocked={bodyDirty || c.pending || c.unknown}
          tagEditor={tagEditor}
          suggestions={[...new Set(all.flatMap((d) => d.tags))]}
          onTags={(value, added) => void tags(value, added)}
          onTagDraft={(value) => {
            if (value && current) selection.select(current.id);
            setTagDraft(value);
          }}
          selectedVersion={versions[selection.active]}
          onVersion={(id) => {
            if (!blocked) setVersions((old) => ({ ...old, [selection.active]: id }));
          }}
        />
      </div>
    </section>
  );
}
