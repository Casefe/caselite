import { useOrdinaryCatalog } from '../shared/data/ordinary-catalog-query';
import { catalogMutation } from '../shared/data/catalogMutation';
import { Icon } from '../shared/ui/Icon';
import { useEffect, useState } from 'react';
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
  const docs = (c.data?.documents ?? []).filter(
    (d) =>
      (!library || d.in_library) &&
      (filter === 'archived' ? !!d.archived_at : !d.archived_at) &&
      (filter !== 'favorite' || d.favorite),
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
    >
      <div className="collection-main">
        <div className="collection-heading">
          <Icon name={library ? 'book' : 'file'} size={18} />
          <h1>{library ? '知识库' : '文档'}</h1>
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
          <table className="catalog-table">
            <thead>
              <tr>
                <th>文档</th>
                <th>分类</th>
                <th>标签</th>
                <th>修订</th>
                <th>收藏</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !blocked) onOpen(doc.task_id);
                  }}
                  key={doc.id}
                  data-document-id={doc.id}
                  aria-selected={d?.id === doc.id}
                  onClick={() => {
                    if (!blocked) setSelected(doc.id);
                  }}
                  onDoubleClick={() => {
                    if (!blocked) onOpen(doc.task_id);
                  }}
                >
                  <td>
                    <Icon name="file" size={14} /> {doc.title}
                  </td>
                  <td>{doc.collection || '未分类'}</td>
                  <td>{doc.tags.join('、') || '—'}</td>
                  <td>{doc.body_revision}</td>
                  <td>{doc.favorite ? '★' : '☆'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                      () => setAcknowledged({ id: d.id, version: d.version + 1 }),
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
      <DocumentInspector
        key={d?.id ?? 'empty'}
        document={d}
        project={c.data?.projects.find((project) => project.id === d?.matter_id)}
        blocked={blocked}
        tagDraft={tagDraft}
        tagsDisabled={
          read.isFetching || editing || c.pending || c.unknown || awaitingRead || !!d?.archived_at
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
    </section>
  );
}
