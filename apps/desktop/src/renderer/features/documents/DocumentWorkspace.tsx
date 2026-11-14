import WorkspacePageChrome, {
  closeWorkspaceDisplayOnEscape,
} from '../../shared/ui/WorkspacePageChrome';
import { InlinePropertiesSlot } from '../../ui/ResponsiveWorkspace';
import { useChildPage, usePageNavigation } from '../../shared/navigation/PageNavigation';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CatalogDocument, Task } from '../../../preload/caselite-api';
import SplitPreviewWorkspace, {
  useSplitPreviewSelection,
  type PreviewPane,
  type PreviewSelection,
} from '../../shared/ui/SplitPreviewWorkspace';
import { Icon } from '../../shared/ui/Icon';
import {
  invalidateOrdinaryCatalog,
  useOrdinaryCatalog,
} from '../../shared/data/ordinary-catalog-query';
import type { BodySaveState } from './BodyEditor';
import { catalogMutation } from '../../shared/data/catalogMutation';
import DocumentCanvas from './DocumentCanvas';
import DocumentPageToolbar from './DocumentPageToolbar';
import DocumentFolderTree, { documentFolderGroups, documentFolderPath } from './DocumentFolderTree';
import { FixedDocumentVersion } from './DocumentVersions';
import DocumentInspector from '../../ui/DocumentInspector';
import PropertyResizeHandle from '../../ui/PropertyResizeHandle';
import { useCatalog } from '../../ui/useCatalog';
import { DocxOriginalReader } from '../../ui/DocxOriginalReader';
import { isDocx } from '../../ui/useMaterials';
import { useProjectOriginals } from './useProjectOriginals';
import { useLocalFolder } from './useLocalFolder';
import LocalFolderTree from './LocalFolderTree';
const PhotoReader = lazy(() => import('../../ui/PhotoReader'));
const PdfReader = lazy(() => import('../../ui/PdfReader'));
type DocumentPageState = {
  kind: 'documents' | 'knowledge';
  selection: PreviewSelection;
  reading: boolean;
  wide: boolean;
  versions: Record<PreviewPane, string | null>;
  title: string;
};

// 每个项目仅缓存自身展示状态；不把选择状态当作对象权限。
const projectViews = new Map<string, DocumentPageState>();
const scopeScroll = new Map<string, number[]>();

export default function DocumentWorkspace({
  library = false,
  onOpen,
  onDirty,
  projectId,
  initialDocumentId,
  externalBlocked = false,
  FavoriteButton,
}: {
  library?: boolean;
  projectId?: string;
  initialDocumentId?: string;
  externalBlocked?: boolean;
  FavoriteButton: ComponentType<{ kind: 'document'; id: string; disabled: boolean }>;
  onOpen(id: string): void;
  onDirty(value: boolean): void;
}) {
  const client = useQueryClient(),
    read = useOrdinaryCatalog(),
    c = useCatalog(false, read);
  const navigation = usePageNavigation();
  const originals = useProjectOriginals();
  const localFolder = useLocalFolder(!library, projectId);
  const [folderSettingsBlocked, setFolderSettingsBlocked] = useState(false);
  const loadOriginals = originals.load;
  useEffect(() => {
    if (projectId) void loadOriginals(projectId);
  }, [projectId, loadOriginals]);
  const kind = library ? 'knowledge' : 'documents';
  const candidate = navigation?.initial as DocumentPageState | null;
  const initial = projectId
    ? initialDocumentId
      ? {
          kind: 'documents' as const,
          selection: {
            primary: initialDocumentId,
            secondary: null,
            active: 'primary' as const,
            split: false,
          },
          reading: true,
          wide: false,
          versions: { primary: null, secondary: null },
          title: '文档',
        }
      : (projectViews.get(projectId) ?? null)
    : candidate?.kind === kind
      ? candidate
      : null;
  const selection = useSplitPreviewSelection(initial?.selection);
  const [reading, setReading] = useState(initial?.reading ?? false);
  const [wide, setWide] = useState(initial?.wide ?? false);
  const [reload, setReload] = useState(0);
  const [tagDraft, setTagDraft] = useState(false),
    [tagEditor, setTagEditor] = useState(0);
  const [acknowledged, setAcknowledged] = useState<{ id: string; version: number } | null>(null);
  const [dirtyEditors, setDirtyEditors] = useState<Record<string, boolean>>({});
  const [saveStates, setSaveStates] = useState<Record<string, BodySaveState | null>>({});
  const [versions, setVersions] = useState<Record<PreviewPane, string | null>>(
    initial?.versions ?? {
      primary: null,
      secondary: null,
    },
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLElement>(null);
  const scrollRestored = useRef(false);
  const scopeKey = projectId ? 'project:' + projectId : kind;
  const all = c.data?.documents ?? [];
  const available = all.filter(
    (d) =>
      (!library || d.in_library) && !d.archived_at && (!projectId || d.matter_id === projectId),
  );
  const groups = documentFolderGroups(available, c.data?.projects ?? [], projectId);
  const ids = { primary: selection.primary, secondary: selection.secondary };
  const selectedDocument = (slot: PreviewPane) =>
    available.find((d) => d.id === ids[slot]) ??
    (!library && dirtyEditors[slot + ':' + ids[slot]]
      ? all.find((d) => d.id === ids[slot] && (!projectId || d.matter_id === projectId))
      : undefined);
  const primary = selectedDocument('primary'),
    secondary = selectedDocument('secondary');
  const current = selection.active === 'primary' ? primary : secondary;
  useLayoutEffect(() => {
    if (scrollRestored.current || (selection.selectedId && !current && read.isFetching)) return;
    const element = root.current;
    if (!element) return;
    const saved = scopeScroll.get(scopeKey);
    if (!saved) {
      scrollRestored.current = true;
      return;
    }
    const restore = () => {
      const nodes = element.querySelectorAll<HTMLElement>(
        '.document-folder-tree, .split-preview-scroll',
      );
      let waiting = false;
      nodes.forEach((node, index) => {
        const target = saved[index] ?? 0;
        // 正文异步读取时短占位会把滚动值夹到零，等内容足够长后再恢复。
        if (target > node.scrollHeight - node.clientHeight) waiting = true;
        else node.scrollTop = target;
      });
      if (!waiting) {
        scrollRestored.current = true;
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(restore);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    restore();
    const cancel = () => {
      scrollRestored.current = true;
      observer.disconnect();
    };
    element.addEventListener('wheel', cancel, { once: true });
    element.addEventListener('pointerdown', cancel, { once: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', cancel);
      element.removeEventListener('pointerdown', cancel);
    };
  }, [scopeKey, selection.selectedId, current, read.isFetching]);
  useEffect(() => {
    const element = root.current;
    return () => {
      const nodes = element?.querySelectorAll<HTMLElement>(
        '.document-folder-tree, .split-preview-scroll',
      );
      if (nodes?.length)
        scopeScroll.set(
          scopeKey,
          Array.from(nodes, (node) => node.scrollTop),
        );
    };
  }, [scopeKey]);
  const path = current
    ? [...documentFolderPath(groups, current.id), current.title].join(' / ')
    : '选择文件夹中的文档';
  const awaitingRead =
    !!acknowledged &&
    !all.some((d) => d.id === acknowledged.id && d.version >= acknowledged.version);
  const bodyDirty = Object.values(dirtyEditors).some(Boolean);
  const dirty =
    bodyDirty ||
    tagDraft ||
    c.pending ||
    c.unknown ||
    awaitingRead ||
    originals.busy ||
    localFolder.busy ||
    folderSettingsBlocked;
  const blocked = dirty || read.isFetching || externalBlocked || originals.busy;
  // 只恢复既有审阅路由；镜像、固定版本和未确认保存的状态不能作为可写工作稿离开。
  const reviewMirror =
    selection.active === 'secondary' && primary?.id === current?.id && !versions.primary;
  const hasReviewRoute =
    !library && !projectId && !!current && !originals.selected && !localFolder.opened;
  const canReview =
    hasReviewRoute &&
    reading &&
    !blocked &&
    !!c.data &&
    !c.error &&
    !current?.archived_at &&
    !versions[selection.active] &&
    !reviewMirror;
  const page = () => ({
    key: `${kind}:${reading && selection.selectedId ? selection.selectedId : 'list'}`,
    title: reading ? (current?.title ?? initial?.title ?? '文档') : library ? '知识库' : '文档',
    icon: library ? 'book' : 'file',
    state: {
      kind,
      selection: {
        primary: selection.primary,
        secondary: selection.secondary,
        active: selection.active,
        split: selection.split,
      },
      reading,
      wide,
      versions,
      title: current?.title ?? initial?.title ?? '文档',
    } satisfies DocumentPageState,
  });
  useEffect(() => {
    if (projectId)
      projectViews.set(projectId, {
        kind,
        selection: {
          primary: selection.primary,
          secondary: selection.secondary,
          active: selection.active,
          split: selection.split,
        },
        reading,
        wide,
        versions,
        title: current?.title ?? initial?.title ?? '文档',
      });
  }, [
    projectId,
    selection.primary,
    selection.secondary,
    selection.active,
    selection.split,
    reading,
    wide,
    versions,
    current?.title,
    initial?.title,
    kind,
  ]);
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
    if (!projectId) navigation?.beforeChange();
    originals.close();
    localFolder.close();
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
    const latest = client
      .getQueryData<NonNullable<typeof c.data>>(['catalog', 'ordinary'])
      ?.documents.find((d) => d.id === task.document_id);
    const external =
      !library &&
      latest &&
      (latest.body_revision > task.body_revision ||
        latest.matter_id !== task.matter_id ||
        !!latest.archived_at);
    client.setQueriesData({ queryKey: ['catalog'] }, (old: unknown) => {
      const value = old as typeof c.data;
      return value?.ok
        ? {
            ...value,
            documents: value.documents.map((d) =>
              d.id === task.document_id
                ? {
                    ...d,
                    body_revision: library
                      ? task.body_revision
                      : Math.max(d.body_revision, task.body_revision),
                    version: library
                      ? (task.document_metadata_version ?? d.version)
                      : Math.max(d.version, task.document_metadata_version ?? d.version),
                    updated_at:
                      library || task.body_revision >= d.body_revision
                        ? task.updated_at
                        : d.updated_at,
                  }
                : d,
            ),
          }
        : old;
    });
    read.onCommit();
    if (library) void c.load();
    else void invalidateOrdinaryCatalog(client, false);
    if (external)
      return `修订 ${task.body_revision} 已保存，文档已有其他修订或归属变化，请保留输入并核对。`;
  }
  function pane(slot: PreviewPane, doc: CatalogDocument | undefined) {
    if (!doc) return null;
    const selectedVersion = versions[slot],
      key = slot + ':' + doc.id;
    const otherDirty = Object.entries(dirtyEditors).some(([id, value]) => id !== key && value);
    const content = selectedVersion ? (
      <FixedDocumentVersion key={selectedVersion} document={doc} id={selectedVersion} />
    ) : (
      <DocumentCanvas
        key={doc.id + ':' + reload}
        generation={reload}
        autosave={!library}
        document={doc}
        mirror={slot === 'secondary' && primary?.id === doc.id && !versions.primary}
        disabled={
          read.isFetching ||
          externalBlocked ||
          originals.busy ||
          tagDraft ||
          c.pending ||
          c.unknown ||
          awaitingRead ||
          otherDirty
        }
        onDirty={(value) => editorDirty(key, value)}
        onSaveState={
          library
            ? undefined
            : (state) =>
                setSaveStates((old) => (old[key] === state ? old : { ...old, [key]: state }))
        }
        onSaved={saved}
        onReload={() => {
          if (!dirty) void refresh();
        }}
      />
    );
    return {
      title: doc.title,
      content: library ? (
        <>
          {slot === selection.active && <InlinePropertiesSlot />}
          {content}
        </>
      ) : (
        <div className="document-page">
          <h1 className="document-page-heading">{doc.title}</h1>
          {slot === selection.active && <InlinePropertiesSlot />}
          {content}
        </div>
      ),
    };
  }
  // 失败/未知回执沿用目录里的原键核对入口；只切展示，保留阅读状态和正文实例。
  const directoryView = reading && (library || (!c.error && !c.unknown)) ? 'preview' : 'list';
  return (
    <section
      ref={root}
      className={`collection-workspace catalog-view document-workspace property-resizable ${library ? 'knowledge-view' : ''}${!library && !projectId ? ' workspace-has-page-chrome' : ''}`}
      data-layout="three-column"
      data-properties-resizable="true"
      data-collection={library ? 'knowledge' : 'documents'}
      data-page-ui={library ? undefined : 'document'}
      data-reading-width={library ? undefined : wide ? 'full' : 'standard'}
      data-directory-view={directoryView}
      data-focus-document={
        !library &&
        reading &&
        !!current &&
        !selection.split &&
        !originals.selected &&
        !localFolder.opened &&
        !c.error &&
        !c.unknown
          ? 'true'
          : undefined
      }
    >
      {!projectId && <DocumentNavigation read={page} ready={!read.isFetching} />}
      {!library && !projectId && (
        <WorkspacePageChrome
          title="文档"
          createLabel="新建文档"
          create={{ unavailableReason: '文档创建入口尚未接入' }}
          search={{ unavailableReason: '文档目录全范围搜索尚未接入' }}
          filter={{ unavailableReason: '文档目录筛选尚未接入' }}
          display={
            <details
              className="workspace-document-display"
              onKeyDown={closeWorkspaceDisplayOnEscape}
            >
              <summary aria-label="文档显示设置">
                <Icon name="settings" size={16} />
                显示设置
              </summary>
              <div>
                <button
                  type="button"
                  disabled={blocked || !current}
                  title={!current ? '请先选择文档' : undefined}
                  onClick={() => setWide((value) => !value)}
                >
                  {wide ? '标准宽度' : '宽屏显示'}
                </button>
              </div>
            </details>
          }
          inspector={
            navigation
              ? {
                  expanded: navigation.inspector.open,
                  disabled: blocked,
                  onClick: () => navigation.inspector.setOpen((open) => !open),
                }
              : undefined
          }
        />
      )}
      <div className="collection-main">
        {library || projectId ? (
          <header className="collection-heading">
            <Icon name={library ? 'book' : 'folder'} size={18} />
            <h1 tabIndex={-1} ref={heading}>
              {library ? '知识库' : '文件夹'}
            </h1>
          </header>
        ) : (
          <h2 className="sr-only" tabIndex={-1} ref={heading}>
            文件夹
          </h2>
        )}
        {!library && (
          <LocalFolderTree
            folder={localFolder}
            disabled={blocked}
            projectId={projectId}
            onSettingsBlocked={setFolderSettingsBlocked}
            onBeforeOpen={() => {
              if (!projectId) navigation?.beforeChange();
              originals.close();
              setReading(true);
            }}
            onOpen={(entry) => {
              if (!projectId) navigation?.beforeChange();
              originals.close();
              setReading(true);
              localFolder.open(entry);
            }}
          />
        )}
        <DocumentFolderTree
          documents={available}
          projects={
            projectId
              ? (c.data?.projects ?? []).filter((p) => p.id === projectId)
              : (c.data?.projects ?? [])
          }
          selected={current?.id ?? null}
          disabled={blocked}
          scopeKey={scopeKey}
          projectId={projectId}
          onSelect={(doc) => choose(doc.id)}
          onProjectOpen={
            library
              ? undefined
              : (id) => {
                  if (!projectId || id === projectId) void originals.load(id);
                }
          }
          projectContents={
            library
              ? undefined
              : (id) =>
                  originals.projectId !== id ? null : (
                    <>
                      {originals.busy && <p role="status">正在读取原件…</p>}
                      {originals.error && (
                        <div role="alert">
                          {originals.error}
                          <button disabled={blocked} onClick={() => void originals.load(id)}>
                            重试读取原件
                          </button>
                        </div>
                      )}
                      {originals.materials.map((material) => (
                        <button
                          key={material.id}
                          type="button"
                          className="document-folder-file"
                          data-source-id={material.id}
                          data-project-id={id}
                          disabled={
                            blocked ||
                            originals.busy ||
                            (!isDocx(material.name) && !/\.pdf$/i.test(material.name))
                          }
                          aria-pressed={originals.selected?.id === material.id}
                          onClick={() => {
                            if (!projectId) navigation?.beforeChange();
                            localFolder.close();
                            void originals.load(id, material);
                            setReading(true);
                          }}
                        >
                          <span className="document-file-badge">
                            {isDocx(material.name)
                              ? 'W'
                              : /\.pdf$/i.test(material.name)
                                ? 'PDF'
                                : '?'}
                          </span>
                          <span>{material.name}</span>
                        </button>
                      ))}
                    </>
                  )
          }
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
        {reading && selection.selectedId && c.data && !current && !read.isFetching && (
          <p role="status">该文档已归档或不在当前目录，请返回目录重新选择。</p>
        )}
        {localFolder.opened && (
          <Suspense fallback={<p>正在打开阅读器…</p>}>
            {localFolder.opened.source.kind === 'docx' ? (
              <DocxOriginalReader
                name={localFolder.opened.source.name}
                material={localFolder.opened.source}
                onClose={localFolder.close}
              />
            ) : localFolder.opened.source.kind === 'image' ? (
              <PhotoReader
                key={localFolder.opened.source.id}
                name={localFolder.opened.source.name}
                bytes={localFolder.opened.bytes}
                textPages={localFolder.opened.source.pages}
                onClose={localFolder.close}
              />
            ) : (
              <PdfReader
                key={localFolder.opened.source.id}
                name={localFolder.opened.source.name}
                bytes={localFolder.opened.bytes}
                textPages={localFolder.opened.source.pages}
                onClose={localFolder.close}
                initialWidth={320}
              />
            )}
          </Suspense>
        )}
        <div hidden={!!localFolder.opened} style={{ height: '100%', minHeight: 0 }}>
          {originals.selected && originals.bytes && originals.projectId ? (
            isDocx(originals.selected.name) ? (
              <DocxOriginalReader
                name={originals.selected.name}
                material={originals.selected}
                onClose={originals.close}
                onSaveOriginal={() => void originals.saveOriginal()}
              />
            ) : (
              <Suspense fallback={<p>正在打开阅读器…</p>}>
                <PdfReader
                  key={originals.selected.id}
                  bytes={originals.bytes}
                  name={originals.selected.name}
                  textPages={originals.selected.pages}
                  onClose={originals.close}
                  initialWidth={320}
                />
              </Suspense>
            )
          ) : (
            <SplitPreviewWorkspace
              split={selection.split}
              activePane={selection.active}
              disabled={blocked}
              onActivate={(pane) => {
                if (!blocked && pane !== selection.active) {
                  if (!projectId) navigation?.beforeChange();
                  selection.activate(pane);
                }
              }}
              onToggle={() => selection.toggle(ids.primary)}
              title={path}
              primary={pane('primary', primary)}
              secondary={pane('secondary', secondary)}
              renderToolbar={
                library
                  ? undefined
                  : ({ orientation, onToggleOrientation }) => (
                      <DocumentPageToolbar
                        documentId={current?.id}
                        title={current?.title ?? '选择文档'}
                        path={path}
                        disabled={blocked}
                        backDisabled={dirty}
                        onOpenReview={
                          hasReviewRoute
                            ? () => {
                                if (canReview && current) onOpen(current.task_id);
                              }
                            : undefined
                        }
                        reviewDisabled={!canReview}
                        split={selection.split}
                        orientation={orientation}
                        wide={wide}
                        showContextTitle={!!projectId || !navigation}
                        inspectorOpen={navigation?.inspector.open}
                        onToggleInspector={
                          navigation
                            ? () => navigation.inspector.setOpen((open) => !open)
                            : undefined
                        }
                        onToggleWide={() => setWide((value) => !value)}
                        onToggleSplit={() => selection.toggle(ids.primary)}
                        onToggleOrientation={onToggleOrientation}
                        onBack={() => {
                          if (!projectId) navigation?.beforeChange();
                          localFolder.close();
                          originals.close();
                          setReading(false);
                          requestAnimationFrame(() => heading.current?.focus());
                        }}
                        favorite={
                          current && (
                            <FavoriteButton
                              kind="document"
                              id={current.id}
                              disabled={blocked || !!versions[selection.active]}
                            />
                          )
                        }
                      />
                    )
              }
              actions={
                <>
                  {current && (
                    <FavoriteButton
                      kind="document"
                      id={current.id}
                      disabled={blocked || !!versions[selection.active]}
                    />
                  )}
                  <button
                    className="document-directory-back"
                    onClick={() => {
                      if (!projectId) navigation?.beforeChange();
                      localFolder.close();
                      originals.close();
                      setReading(false);
                      requestAnimationFrame(() => heading.current?.focus());
                    }}
                    disabled={dirty}
                  >
                    返回文件夹
                  </button>
                </>
              }
            />
          )}
        </div>
      </div>
      <div className="document-directory-sidebar">
        <DocumentInspector
          key={current?.id ?? 'empty'}
          document={originals.selected || localFolder.opened ? undefined : current}
          activeSource={localFolder.opened?.source}
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
          saveState={
            !library && current && !versions[selection.active]
              ? saveStates[selection.active + ':' + current.id]
              : null
          }
          onVersion={(id) => {
            if (!blocked) setVersions((old) => ({ ...old, [selection.active]: id }));
          }}
        />
      </div>
      <PropertyResizeHandle
        key={library ? 'knowledge' : 'documents'}
        module={library ? 'knowledge' : 'documents'}
      />
    </section>
  );
}

function DocumentNavigation({
  read,
  ready,
}: {
  read: () => import('../../shared/navigation/PageNavigation').ChildPage;
  ready: boolean;
}) {
  useChildPage(read, ready);
  return null;
}
