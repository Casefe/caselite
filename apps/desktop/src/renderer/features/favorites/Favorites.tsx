import { createContext, useContext, useState, type ReactNode, type DragEvent } from 'react';
import type { LocalPreferenceValues, Task } from '../../../preload/caselite-api';
import { useLocalPreferences } from '../../shared/data/LocalPreferences';
import { useOrdinaryCatalog } from '../../shared/data/ordinary-catalog-query';
import { catalogMutation } from '../../shared/data/catalogMutation';
import { useCatalog } from '../../ui/useCatalog';
import { Icon } from '../../shared/ui/Icon';

type Navigation = NonNullable<LocalPreferenceValues['favorite_navigation']>;
export type FavoriteTarget = { kind: 'task' | 'project' | 'document'; id: string };
type Entry = FavoriteTarget & { title: string; folder_id: string | null };
const empty: Navigation = { folders: [], references: [], document_folders: [] };
const key = (target: FavoriteTarget) => `${target.kind}:${target.id}`;
const labels = { task: '任务', project: '项目', document: '文档' };
const Context = createContext({
  navigation: empty,
  blocked: true,
  isFavorite(_target: FavoriteTarget): boolean {
    void _target;
    return false;
  },
  async toggle(_target: FavoriteTarget) {
    void _target;
  },
  async save(_value: Navigation): Promise<boolean> {
    void _value;
    return false;
  },
  documents: [] as Array<{
    id: string;
    task_id: string;
    title: string;
    favorite: boolean;
    archived_at: string | null;
  }>,
  projects: [] as Array<{ id: string; title: string; archived_at: string | null }>,
  feedback: null as ReactNode,
});
export const useFavorites = () => useContext(Context);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const preferences = useLocalPreferences();
  const read = useOrdinaryCatalog();
  const catalog = useCatalog(false, read);
  const navigation = preferences.preferences.favorite_navigation ?? empty;
  const documents = catalog.data?.documents ?? [];
  const projects = catalog.data?.projects ?? [];
  const blocked =
    !preferences.ready ||
    preferences.pending ||
    preferences.phase !== 'idle' ||
    !!preferences.error ||
    catalog.pending ||
    catalog.unknown ||
    !catalog.data ||
    !!catalog.error;
  const isFavorite = (target: FavoriteTarget) =>
    target.kind === 'document'
      ? documents.some((d) => d.id === target.id && d.favorite)
      : navigation.references.some((r) => key(r) === key(target));
  async function toggle(target: FavoriteTarget) {
    if (blocked) return;
    if (target.kind === 'document') {
      const doc = documents.find((d) => d.id === target.id && !d.archived_at);
      if (!doc) return;
      await catalog.execute(
        catalogMutation({
          operation: 'organize_document',
          id: doc.id,
          expected_version: doc.version,
          collection: doc.collection,
          tags: doc.tags,
          in_library: doc.in_library,
          favorite: !doc.favorite,
        }),
      );
    } else {
      await preferences.saveFavoriteNavigation({
        ...navigation,
        references: isFavorite(target)
          ? navigation.references.filter((r) => key(r) !== key(target))
          : [...navigation.references, { kind: target.kind, id: target.id, folder_id: null }],
      });
    }
  }
  return (
    <Context.Provider
      value={{
        navigation,
        blocked,
        isFavorite,
        toggle,
        save: (value) =>
          blocked ? Promise.resolve(false) : preferences.saveFavoriteNavigation(value),
        documents,
        projects,
        feedback: (
          <>
            {(preferences.error || catalog.error) && (
              <p role="alert">{preferences.error || catalog.error}</p>
            )}
            {preferences.phase === 'verify' && (
              <button disabled={preferences.pending} onClick={() => void preferences.verify()}>
                核对收藏提交
              </button>
            )}
            {preferences.phase === 'retry' && (
              <button disabled={preferences.pending} onClick={() => void preferences.retry()}>
                重试收藏提交
              </button>
            )}
            {preferences.phase === 'idle' && preferences.error && (
              <button disabled={preferences.pending} onClick={() => void preferences.reload()}>
                重读收藏设置
              </button>
            )}
            {catalog.unknown && (
              <button disabled={catalog.pending} onClick={() => void catalog.retry()}>
                核对文档收藏提交
              </button>
            )}
            {catalog.error && !catalog.unknown && (
              <button disabled={catalog.pending} onClick={() => void catalog.load()}>
                重读收藏目录
              </button>
            )}
          </>
        ),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function FavoriteButton({
  kind,
  id,
  disabled = false,
}: FavoriteTarget & { disabled?: boolean }) {
  const favorites = useFavorites();
  const target = { kind, id },
    active = favorites.isFavorite(target);
  return (
    <button
      type="button"
      className="favorite-toggle"
      data-testid={kind === 'task' ? 'toggle-favorite' : `toggle-favorite-${kind}`}
      aria-label={`${active ? '取消收藏' : '收藏'}${labels[kind]}`}
      aria-pressed={active}
      disabled={disabled || favorites.blocked}
      onClick={() => void favorites.toggle(target)}
    >
      <Icon name="star" size={16} />
    </button>
  );
}

const dragType = 'application/x-caselite-favorite';
export function FavoritesSidebar({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen(target: FavoriteTarget): void;
}) {
  const favorites = useFavorites(),
    { navigation } = favorites;
  const [adding, setAdding] = useState(false),
    [name, setName] = useState('');
  const [newFolderId, setNewFolderId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragged, setDragged] = useState<string | null>(null),
    [over, setOver] = useState<string | null>(null);
  const entries: Entry[] = navigation.references.flatMap((r) => {
    const object =
      r.kind === 'task'
        ? tasks.find((t) => t.id === r.id)
        : favorites.projects.find((p) => p.id === r.id && !p.archived_at);
    return object ? [{ ...r, title: object.title }] : [];
  });
  entries.push(
    ...favorites.documents
      .filter((d) => d.favorite && !d.archived_at)
      .map((d) => ({
        kind: 'document' as const,
        id: d.id,
        title: d.title,
        folder_id: navigation.document_folders.find((r) => r.id === d.id)?.folder_id ?? null,
      })),
  );
  async function move(entry: Entry, folder_id: string | null) {
    if (favorites.blocked || entry.folder_id === folder_id) return;
    const value =
      entry.kind === 'document'
        ? {
            ...navigation,
            document_folders: [
              ...navigation.document_folders.filter((r) => r.id !== entry.id),
              ...(folder_id ? [{ id: entry.id, folder_id }] : []),
            ],
          }
        : {
            ...navigation,
            references: navigation.references.map((r) =>
              key(r) === key(entry) ? { ...r, folder_id } : r,
            ),
          };
    if (await favorites.save(value)) {
      if (folder_id) setCollapsed((old) => ({ ...old, [folder_id]: false }));
    }
  }
  function drop(event: DragEvent, folder: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const entry = entries.find(
      (e) => key(e) === dragged && key(e) === event.dataTransfer.getData(dragType),
    );
    setOver(null);
    setDragged(null);
    if (entry) void move(entry, folder);
  }
  function dropProps(folder: string | null) {
    const value = folder ?? 'root';
    return {
      'data-drop-active': over === value,
      onDragOver: (event: DragEvent) => {
        if (!dragged || favorites.blocked) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setOver(value);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
      },
      onDrop: (event: DragEvent) => drop(event, folder),
    };
  }
  function item(entry: Entry) {
    return (
      <div
        className="favorite-entry"
        key={key(entry)}
        draggable={!favorites.blocked}
        data-favorite-id={key(entry)}
        onDragStart={(event) => {
          event.dataTransfer.setData(dragType, key(entry));
          event.dataTransfer.effectAllowed = 'move';
          setDragged(key(entry));
        }}
        onDragEnd={() => {
          setDragged(null);
          setOver(null);
        }}
      >
        <button
          data-task-id={entry.kind === 'task' ? entry.id : undefined}
          onClick={() => onOpen(entry)}
          title={`${labels[entry.kind]} · ${entry.title}`}
        >
          <Icon
            name={entry.kind === 'task' ? 'check' : entry.kind === 'project' ? 'folder' : 'file'}
            size={15}
          />
          <span>{entry.title}</span>
        </button>
        <select
          className="favorite-move"
          aria-label={`移动收藏 ${entry.title}`}
          value={entry.folder_id ?? ''}
          disabled={favorites.blocked}
          onChange={(event) => void move(entry, event.target.value || null)}
        >
          <option value="">收藏根目录</option>
          {navigation.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <section className="shortcuts favorites-tree" aria-label="收藏">
      <div className="favorites-heading" {...dropProps(null)}>
        <button
          className="favorites-root"
          aria-label="收藏"
          data-dragging={Boolean(dragged)}
          aria-expanded={!collapsed.root}
          onClick={() => setCollapsed((old) => ({ ...old, root: !old.root }))}
        >
          <span className="favorite-root-label">收藏</span>
          <Icon name="chevron" size={12} />
          {dragged && (
            <span className="favorite-drop-hint" aria-hidden="true">
              拖到这里移出文件夹
            </span>
          )}
        </button>
        <button
          className="favorite-create-folder"
          title="新建收藏文件夹"
          aria-label="新建收藏文件夹"
          disabled={favorites.blocked || navigation.folders.length >= 100}
          onClick={() => {
            setAdding(true);
            setNewFolderId(null);
            setName('');
          }}
        >
          <Icon name="folder" size={16} />
          <Icon name="plus" size={10} />
        </button>
      </div>
      {adding && !navigation.folders.some((folder) => folder.id === newFolderId) && (
        <form
          className="favorite-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            const title = name.trim();
            if (!title) return;
            const id = crypto.randomUUID();
            setNewFolderId(id);
            void favorites
              .save({
                ...navigation,
                folders: [...navigation.folders, { id, name: title }],
              })
              .then((ok) => {
                if (ok) {
                  setName('');
                  setAdding(false);
                  setCollapsed((old) => ({ ...old, root: false }));
                }
              });
          }}
        >
          <input
            autoFocus
            aria-label="收藏文件夹名称"
            maxLength={80}
            value={name}
            disabled={favorites.blocked}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) {
                if (e.key === 'Enter') e.preventDefault();
                return;
              }
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <button type="submit" disabled={favorites.blocked || !name.trim()}>
            创建
          </button>
          <button type="button" disabled={favorites.blocked} onClick={() => setAdding(false)}>
            取消
          </button>
        </form>
      )}
      {!collapsed.root && (
        <div className="favorites-contents">
          <div className="favorites-root-items" data-favorite-folder="root" {...dropProps(null)}>
            {entries.filter((e) => !e.folder_id).map(item)}
          </div>
          {navigation.folders.map((folder) => (
            <div
              className="favorite-folder"
              key={folder.id}
              data-favorite-folder={folder.id}
              {...dropProps(folder.id)}
            >
              <button
                className="favorite-folder-title"
                aria-expanded={!collapsed[folder.id]}
                onClick={() => setCollapsed((old) => ({ ...old, [folder.id]: !old[folder.id] }))}
              >
                <Icon name="folder" size={16} />
                <span>{folder.name}</span>
                <Icon name="chevron" size={12} />
              </button>
              {!collapsed[folder.id] && (
                <div className="favorite-folder-items">
                  {entries.filter((e) => e.folder_id === folder.id).map(item)}
                  {!entries.some((e) => e.folder_id === folder.id) && (
                    <p className="sidebar-empty">拖动收藏到此文件夹</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {!entries.length && !navigation.folders.length && (
            <p className="sidebar-empty">在任务、项目或文档旁点 ☆ 收藏</p>
          )}
        </div>
      )}
      {favorites.feedback}
    </section>
  );
}
