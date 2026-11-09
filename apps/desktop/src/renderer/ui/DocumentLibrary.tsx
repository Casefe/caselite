import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CatalogDocument, Task } from '../../preload/caselite-api';
import SplitPreviewWorkspace, {
  useSplitPreviewSelection,
  type PreviewPane,
} from '../shared/ui/SplitPreviewWorkspace';
import { Icon } from '../shared/ui/Icon';
import { useOrdinaryCatalog } from '../shared/data/ordinary-catalog-query';
import { catalogMutation } from '../shared/data/catalogMutation';
import DocumentCanvas from '../features/documents/DocumentCanvas';
import DocumentFolderTree, {
  documentFolderGroups,
  documentFolderPath,
} from '../features/documents/DocumentFolderTree';
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
  const groups = documentFolderGroups(available, c.data?.projects ?? []);
  const ids = { primary: selection.primary, secondary: selection.secondary };
  const primary = available.find((d) => d.id === ids.primary),
    secondary = available.find((d) => d.id === ids.secondary);
  const current = selection.active === 'primary' ? primary : secondary;
  const path = current
    ? [...documentFolderPath(groups, current.id), current.title].join(' / ')
    : '选择文件夹中的文档';
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
          onReload={() => {
            if (!dirty) void refresh();
          }}
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
            {library ? '知识库' : '文件夹'}
          </h1>
        </header>
        <DocumentFolderTree
          documents={available}
          projects={c.data?.projects ?? []}
          selected={current?.id ?? null}
          disabled={blocked}
          onSelect={(doc) => choose(doc.id)}
        />
        {c.error && <p role="alert">{c.error}</p>}
        {c.unknown && (
          <button disabled={c.pending} onClick={() => void c.retry()}>
            核对原提交
          </button>
        )}
        {(!c.data || c.error) && (
          <button
            disabled={read.isFetching || c.pending || c.unknown || bodyDirty}
            onClick={() => void refresh()}
          >
            重读目录
          </button>
        )}
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
          title={path}
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
          key={current?.id ?? 'empty'}
          document={current}
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
