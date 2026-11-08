import DocumentPreview from '../features/documents/DocumentPreview';
import ReadTable from '../shared/ui/ReadTable';
import { useOrdinaryCatalog } from '../shared/data/ordinary-catalog-query';
import { catalogMutation } from '../shared/data/catalogMutation';
import { Icon } from '../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import type { CatalogDocument } from '../../preload/caselite-api';

import DocumentInspector from './DocumentInspector';
import { useCatalog } from './useCatalog';
export default function DocumentLibrary({
  library = false,
  onOpen,
  onDirty,
}: {
  library?: boolean;
  onOpen(id: string): void;
  onDirty(dirty: boolean): void;
}) {
  const read = useOrdinaryCatalog();
  const c = useCatalog(false, read);
  const [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState('active');
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [sort, setSort] = useState('updated');
  const [preview, setPreview] = useState(false);
  const directoryHeading = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState(false),
    [collection, setCollection] = useState(''),
    [tagDraft, setTagDraft] = useState(false),
    [tagEditor, setTagEditor] = useState(0),
    [acknowledged, setAcknowledged] = useState<{ id: string; version: number } | null>(null);
  const awaitingRead = Boolean(
    acknowledged &&
    !c.data?.documents.some(
      (doc) => doc.id === acknowledged.id && doc.version >= acknowledged.version,
    ),
  );
  const dirty = editing || tagDraft || c.pending || c.unknown || awaitingRead;
  const blocked = dirty || read.isFetching;
  const projectNames = new Map(c.data?.projects.map((project) => [project.id, project.title]));
  const allDocuments = c.data?.documents ?? [];
  const groups = [...new Set(allDocuments.map((doc) => doc.collection).filter(Boolean))].sort();
  const docs = allDocuments
    .filter(
      (d) =>
        (!library || d.in_library) &&
        (filter === 'archived' ? !!d.archived_at : !d.archived_at) &&
        (filter !== 'favorite' || d.favorite) &&
        (!group || d.collection === group) &&
        (!projectFilter || d.matter_id === projectFilter) &&
        d.title.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)
        : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
    );
  const d =
    docs.find((x) => x.id === selected) ??
    (blocked ? c.data?.documents.find((x) => x.id === selected) : undefined) ??
    docs[0];
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const organize = async (
    doc: CatalogDocument,
    change: Partial<Pick<CatalogDocument, 'collection' | 'tags' | 'favorite' | 'in_library'>>,
    addedTag = false,
  ) => {
    await c.execute(
      catalogMutation({
        operation: 'organize_document' as const,
        id: doc.id,
        expected_version: doc.version,
        collection: doc.collection,
        tags: doc.tags,
        favorite: doc.favorite,
        in_library: doc.in_library,
        ...change,
      }),
      () => {
        // 回执确认写入；目录读失败时仅允许重读，避免用旧版本再次整理。
        setAcknowledged({ id: doc.id, version: doc.version + 1 });
        setEditing(false);
        if (addedTag) {
          setTagDraft(false);
          setTagEditor((value) => value + 1);
        }
      },
    );
  };
  return (
    <section
      className={`collection-workspace catalog-view ${library ? 'knowledge-view' : ''}`}
      data-layout="three-column"
      data-collection={library ? 'knowledge' : 'documents'}
      data-directory-view={preview && d ? 'preview' : 'list'}
    >
      <div className="collection-main">
        <div className="collection-heading">
          <Icon name={library ? 'book' : 'file'} size={18} />
          <h1 tabIndex={-1} ref={directoryHeading}>
            {library ? '知识库' : '文档'}
          </h1>
          <span>{docs.length}</span>
        </div>
        <div className="document-intro">
          <h2>{library ? '个人资料' : '工作成果'}</h2>
          <p>
            {library
              ? '组织选定的原文档；此处保持原稿身份与当前修订，可返回任务继续编辑。'
              : '读取本地已保存的成果正文。归档保留正文与历史，恢复后可继续编辑。'}
          </p>
        </div>
        <div className="view-toolbar">
          <div className="view-tabs">
            {[
              ['active', '全部文档'],
              ['favorite', '收藏'],
              ['archived', '已归档'],
            ].map(([value, label]) => (
              <button
                key={value}
                disabled={blocked}
                aria-pressed={filter === value}
                className={filter === value ? 'current' : ''}
                onClick={() => {
                  setFilter(value);
                  setSelected(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            disabled={read.isFetching || c.pending || c.unknown || (blocked && !c.error)}
            onClick={() => void c.load()}
          >
            刷新
          </button>
        </div>
        {!library && (
          <div className="document-directory-filters" aria-label="文件夹与文档筛选">
            <input
              aria-label="搜索文档"
              placeholder="搜索文档…"
              disabled={blocked}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setSelected(null);
              }}
            />
            <select
              aria-label="文档文件夹"
              disabled={blocked}
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
                setSelected(null);
              }}
            >
              <option value="">所有文件夹</option>
              {groups.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              aria-label="文档关联项目"
              disabled={blocked}
              value={projectFilter}
              onChange={(event) => {
                setProjectFilter(event.target.value);
                setSelected(null);
              }}
            >
              <option value="">所有项目</option>
              {[...projectNames].map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
            <select
              aria-label="文档排序"
              disabled={blocked}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="updated">修改时间</option>
              <option value="name">名称</option>
            </select>
          </div>
        )}
        {c.error && (
          <div role="alert" className="assistant-error">
            {c.error}
          </div>
        )}
        {c.unknown && (
          <button disabled={c.pending} onClick={() => void c.retry()}>
            核对原提交
          </button>
        )}
        <div className="collection-scroll">
          <ReadTable
            label={library ? '知识库列表' : '文档列表'}
            className={library ? 'catalog-table' : 'catalog-table document-directory-table'}
            data={docs}
            getRowId={(doc) => doc.id}
            groupBy={
              library
                ? undefined
                : (doc) => ({
                    id: doc.matter_id ?? 'ungrouped',
                    label: doc.matter_id
                      ? (projectNames.get(doc.matter_id) ?? '关联项目不可用')
                      : '未归组',
                  })
            }
            columns={[
              {
                id: 'title',
                header: library ? '文档' : '名称',
                cell: ({ row }) => (
                  <>
                    <Icon name="file" size={14} /> {row.original.title}
                  </>
                ),
              },
              ...(library
                ? [
                    {
                      id: 'collection',
                      header: '分类',
                      accessorFn: (doc: CatalogDocument) => doc.collection || '未分类',
                    },
                    {
                      id: 'tags',
                      header: '标签',
                      accessorFn: (doc: CatalogDocument) => doc.tags.join('、') || '—',
                    },
                    { accessorKey: 'body_revision', header: '修订' },
                    {
                      id: 'favorite',
                      header: '收藏',
                      accessorFn: (doc: CatalogDocument) => (doc.favorite ? '★' : '☆'),
                    },
                  ]
                : [
                    {
                      id: 'project',
                      header: '关联项目',
                      accessorFn: (doc: CatalogDocument) =>
                        projectNames.get(doc.matter_id ?? '') ?? '—',
                    },
                    { id: 'owner', header: '所有者', cell: () => null },
                    {
                      id: 'modified',
                      header: '修改时间',
                      accessorFn: (doc: CatalogDocument) =>
                        new Date(doc.updated_at).toLocaleString('zh-CN'),
                    },
                    { accessorKey: 'body_revision', header: '版本' },
                    { id: 'sharing', header: '共享状态', cell: () => null },
                  ]),
            ]}
            rowProps={(doc) => ({
              tabIndex: 0,
              'data-document-id': doc.id,
              'aria-selected': d?.id === doc.id,
              onClick: () => {
                if (!blocked) {
                  setSelected(doc.id);
                  if (!library) setPreview(true);
                }
              },
              onDoubleClick: () => {
                if (!blocked) onOpen(doc.task_id);
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !blocked) onOpen(doc.task_id);
                if (event.key === ' ' && !blocked && !library) {
                  event.preventDefault();
                  setSelected(doc.id);
                  setPreview(true);
                }
              },
            })}
          />
          {!c.data && !c.error ? (
            <p className="catalog-empty">正在读取…</p>
          ) : (
            !docs.length && (
              <p className="catalog-empty">
                {library ? '知识库暂无选定文档，可从“文档”中加入。' : '没有符合条件的文档。'}
              </p>
            )
          )}
          {d && (
            <div className="catalog-actions" key={d.id}>
              <h3>{d.title}</h3>
              <p>
                Document {d.id.slice(0, 8)} · {d.archived_at ? '已归档 · 只读' : '本地文档'} ·{' '}
                {d.in_library ? '知识库已收录' : '未加入知识库'}
              </p>
              <div className="catalog-buttons">
                <button
                  data-testid="inspector-open"
                  disabled={blocked}
                  onClick={() => onOpen(d.task_id)}
                >
                  打开正文
                </button>
                <button
                  disabled={blocked}
                  onClick={() =>
                    void c.execute(
                      catalogMutation({
                        operation: 'archive_document' as const,
                        id: d.id,
                        expected_version: d.version,
                        archived: !d.archived_at,
                      }),
                      () => {
                        setAcknowledged({ id: d.id, version: d.version + 1 });
                      },
                    )
                  }
                >
                  {d.archived_at ? '恢复文档' : '归档文档'}
                </button>
                {!d.archived_at && (
                  <>
                    <button
                      disabled={blocked}
                      onClick={() => void organize(d, { favorite: !d.favorite })}
                    >
                      {d.favorite ? '取消收藏' : '收藏文档'}
                    </button>
                    <button
                      disabled={blocked}
                      onClick={() => void organize(d, { in_library: !d.in_library })}
                    >
                      {d.in_library ? '移出知识库' : '加入知识库'}
                    </button>
                    <button
                      disabled={blocked}
                      onClick={() => {
                        setSelected(d.id);
                        setCollection(d.collection);
                        setEditing(true);
                      }}
                    >
                      编辑分类
                    </button>
                  </>
                )}
              </div>
              {editing && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void organize(d, { collection });
                  }}
                >
                  <label>
                    分类
                    <input
                      aria-label="文档分类"
                      maxLength={80}
                      value={collection}
                      disabled={c.pending || c.unknown}
                      onChange={(e) => setCollection(e.target.value)}
                    />
                  </label>
                  <button disabled={c.pending || c.unknown || !!d.archived_at} className="primary">
                    保存分类
                  </button>
                  <button
                    type="button"
                    disabled={c.pending || c.unknown}
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
        <footer className="collection-footer">
          {docs.length} 份文档 · 仅此设备 · 单击查看，双击打开
        </footer>
      </div>
      <div className="document-directory-sidebar">
        {!library && d && (
          <section className="document-directory-preview" aria-label="文档预览">
            {preview && (
              <button
                className="document-directory-back"
                onClick={() => {
                  setPreview(false);
                  requestAnimationFrame(() => directoryHeading.current?.focus());
                }}
              >
                返回文档列表
              </button>
            )}
            <h2>{d.title}</h2>
            <div className="view-tabs">
              <button aria-pressed={preview} disabled={blocked} onClick={() => setPreview(true)}>
                预览
              </button>
              <button aria-pressed={!preview} onClick={() => setPreview(false)}>
                属性
              </button>
            </div>
            {preview && !blocked && <DocumentPreview key={d.id} document={d} />}
            {preview && (
              <div className="document-preview-actions">
                <button disabled={blocked} onClick={() => onOpen(d.task_id)}>
                  {d.archived_at ? '打开只读正文' : '打开编辑'}
                </button>
                <button disabled={blocked} onClick={() => void c.load()}>
                  重新读取文档
                </button>
              </div>
            )}
          </section>
        )}
        {(!preview || library || tagDraft) && (
          <DocumentInspector
            key={d?.id ?? 'empty'}
            document={d}
            project={c.data?.projects.find((project) => project.id === d?.matter_id)}
            blocked={blocked}
            tagDraft={tagDraft}
            tagsDisabled={
              read.isFetching ||
              editing ||
              c.pending ||
              c.unknown ||
              awaitingRead ||
              !!d?.archived_at
            }
            tagsLocked={c.pending || c.unknown}
            tagEditor={tagEditor}
            suggestions={[...new Set(c.data?.documents.flatMap((doc) => doc.tags))]}
            onTags={(tags, added) => d && void organize(d, { tags }, added)}
            onTagDraft={(dirty) => {
              if (dirty && d) setSelected(d.id);
              setTagDraft(dirty);
            }}
          />
        )}
      </div>
    </section>
  );
}
