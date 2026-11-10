import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Contact } from '../../../preload/caselite-api';
import { useOrdinaryCatalog } from '../../shared/data/ordinary-catalog-query';
import ReadTable from '../../shared/ui/ReadTable';
import { Icon } from '../../shared/ui/Icon';
import ContactInspector from './ContactInspector';
import ContactCreateDialog from './ContactCreateDialog';
import { contactsKey } from './useContactsWrite';

const names = { person: '个人', organization: '组织' };
export default function ContactsView({
  onDirty,
  onOpenProject,
  onOpenTask,
  onOpenDocument,
  onOpenFinance,
}: {
  onDirty(value: boolean): void;
  onOpenProject?(id: string): void;
  onOpenTask?(id: string): void;
  onOpenDocument?(id: string, taskId: string): void;
  onOpenFinance?(id: string): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const returnPosition = useRef({ top: 0, id: '' });
  const [detailId, setDetailId] = useState<string>();
  const [detailTarget, setDetailTarget] = useState<HTMLDivElement | null>(null);
  const catalog = useOrdinaryCatalog();
  const read = useQuery({
    queryKey: contactsKey,
    queryFn: async () => {
      const result = await window.caselite.contacts({ protocol_version: 1, operation: 'list' });
      if (!result.ok) throw new Error(result.message);
      return result.contacts;
    },
  });
  const [text, setText] = useState(''),
    [kind, setKind] = useState<keyof typeof names | ''>('');
  const [projectFilter, setProjectFilter] = useState(''),
    [relationship, setRelationship] = useState(''),
    [tag, setTag] = useState('');
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false),
    [blocked, setBlocked] = useState(false),
    [recent, setRecent] = useState(false);
  useEffect(() => {
    onDirty(blocked || creating);
    return () => onDirty(false);
  }, [blocked, creating, onDirty]);
  const contacts = read.data ?? [];
  const projects = catalog.error ? [] : (catalog.data?.projects ?? []);
  const documents = catalog.error ? [] : (catalog.data?.documents ?? []);
  const lookup = text.trim().toLocaleLowerCase();
  const rows = contacts
    .filter(
      (contact) =>
        (!kind || contact.kind === kind) &&
        (!projectFilter || contact.project_ids.includes(projectFilter)) &&
        (!relationship || contact.relationship === relationship) &&
        (!tag || contact.tags.includes(tag)) &&
        [
          contact.name,
          contact.phone,
          contact.email,
          contact.company,
          contact.wechat,
          contact.city,
          contact.address,
        ].some((value) => value.toLocaleLowerCase().includes(lookup)),
    )
    .sort(
      (a, b) =>
        (recent ? (b.last_contact ?? '').localeCompare(a.last_contact ?? '') : 0) ||
        a.name.localeCompare(b.name, 'zh-CN') ||
        a.id.localeCompare(b.id),
    );
  const lastPage = Math.max(0, Math.ceil(rows.length / 15) - 1),
    currentPage = Math.min(page, lastPage);
  const visible = rows.slice(currentPage * 15, (currentPage + 1) * 15);
  const contact = detailId
    ? contacts.find((row) => row.id === detailId)
    : (contacts.find((row) => row.id === selected) ?? visible[0]);
  const openDetail = (id: string) => {
    if (blocked) return;
    returnPosition.current = { top: list.current?.scrollTop ?? 0, id };
    setSelected(id);
    setCreating(false);
    setDetailId(id);
  };
  const closeDetail = () => {
    if (blocked) return;
    setDetailId(undefined);
    requestAnimationFrame(() => {
      list.current
        ?.querySelector<HTMLButtonElement>(`[data-customer-id="${returnPosition.current.id}"]`)
        ?.focus({ preventScroll: true });
      if (list.current) list.current.scrollTop = returnPosition.current.top;
    });
  };
  const select = (id: string) => {
    if (!blocked) {
      setSelected(id);
      setCreating(false);
    }
  };
  const filter = (change: () => void) => {
    change();
    setPage(0);
    setSelected(undefined);
  };
  function created(row: Contact) {
    setSelected(row.id);
    setCreating(false);
    setText('');
    setKind('');
    setProjectFilter('');
    setRelationship('');
    setTag('');
    setPage(0);
  }
  return (
    <section
      className="collection-workspace catalog-view contacts-workbench"
      data-layout="three-column"
    >
      <div className="collection-main">
        <div ref={setDetailTarget} className="customer-detail-slot" hidden={!detailId} />
        <div className="customer-list-page" hidden={Boolean(detailId)}>
          <header className="collection-heading">
            <h1>联系人</h1>
            <button
              type="button"
              className="primary"
              disabled={blocked || Boolean(read.error) || !read.data}
              onClick={() => setCreating(true)}
            >
              ＋ 新建联系人
            </button>
          </header>
          <p className="workbench-list-caption">管理联系人资料，记录每次沟通。</p>
          <div className="view-tabs contacts-tabs">
            {(['', 'person', 'organization'] as const).map((value) => (
              <button
                type="button"
                key={value || 'all'}
                disabled={blocked}
                aria-pressed={kind === value}
                onClick={() => filter(() => setKind(value))}
              >
                {value ? names[value] : '全部'}{' '}
                <small>{contacts.filter((row) => !value || row.kind === value).length}</small>
              </button>
            ))}
          </div>
          <div className="customer-list-filters">
            <label className="customer-search">
              <Icon name="search" size={16} />
              <input
                aria-label="搜索联系人"
                placeholder="搜索姓名、单位、电话或邮箱…"
                value={text}
                disabled={blocked}
                onChange={(event) => filter(() => setText(event.target.value))}
              />
            </label>
            <select
              aria-label="筛选联系人关系"
              disabled={blocked}
              value={relationship}
              onChange={(e) => filter(() => setRelationship(e.target.value))}
            >
              <option value="">关系</option>
              {[...new Set(contacts.map((row) => row.relationship).filter(Boolean))].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
            <select
              aria-label="筛选联系人标签"
              disabled={blocked}
              value={tag}
              onChange={(e) => filter(() => setTag(e.target.value))}
            >
              <option value="">标签</option>
              {[...new Set(contacts.flatMap((row) => row.tags))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="筛选关联项目"
              disabled={blocked || Boolean(catalog.error)}
              value={projectFilter}
              onChange={(e) => filter(() => setProjectFilter(e.target.value))}
            >
              <option value="">关联项目</option>
              {projects.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
          </div>
          <div className="customer-list-views">
            <button
              type="button"
              aria-pressed={!recent}
              disabled={blocked}
              onClick={() => filter(() => setRecent(false))}
            >
              全部联系人
            </button>
            <button
              type="button"
              aria-pressed={recent}
              disabled={blocked}
              onClick={() => filter(() => setRecent(true))}
            >
              最近联系
            </button>
          </div>
          {read.error ? (
            <p role="alert">
              {read.error.message}
              <button type="button" onClick={() => void read.refetch()}>
                重新读取
              </button>
            </p>
          ) : !read.data ? (
            <p role="status">正在读取联系人…</p>
          ) : (
            <div className="collection-scroll" ref={list}>
              <ReadTable
                data={visible}
                getRowId={(row) => row.id}
                label="联系人列表"
                className="catalog-table customer-table"
                rowProps={(row) => ({
                  'aria-selected': row.id === contact?.id,
                  onClick: () => select(row.id),
                  onDoubleClick: () => openDetail(row.id),
                })}
                columns={[
                  {
                    id: 'name',
                    header: '姓名／名称',
                    cell: ({ row: { original: row } }) => (
                      <button
                        type="button"
                        className="customer-name"
                        data-customer-id={row.id}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            openDetail(row.id);
                          }
                        }}
                        disabled={blocked}
                        onClick={() => select(row.id)}
                      >
                        <span className="customer-avatar" aria-hidden="true">
                          {row.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{row.name}</strong>
                          {row.company && (
                            <small>{[row.company, row.position].filter(Boolean).join(' · ')}</small>
                          )}
                        </span>
                      </button>
                    ),
                  },
                  {
                    id: 'relationship',
                    header: '关系',
                    cell: ({ row: { original: row } }) => (
                      <span className="customer-pill">{row.relationship || names[row.kind]}</span>
                    ),
                  },
                  {
                    id: 'contact',
                    header: '联系方式',
                    accessorFn: (row) => row.phone || row.email || row.wechat || '—',
                  },
                  {
                    id: 'projects',
                    header: '关联项目',
                    accessorFn: (row) =>
                      row.project_ids.length ? `${row.project_ids.length}个项目` : '未关联',
                  },
                  {
                    id: 'last-contact',
                    header: '上次联系',
                    accessorFn: (row) => row.last_contact ?? '—',
                  },
                ]}
              />
              {!rows.length && (
                <p className="catalog-empty">暂无符合条件的联系人，可新建联系人。</p>
              )}
            </div>
          )}
          <footer className="collection-footer">
            <span>共{rows.length}位联系人</span>
            <span className="caption">双击联系人可打开详情</span>
            <div>
              <button
                type="button"
                disabled={blocked || currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span>
                {currentPage + 1} / {lastPage + 1}
              </span>
              <button
                type="button"
                disabled={blocked || currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </div>
          </footer>
        </div>
      </div>
      <ContactInspector
        key={contact?.id ?? 'empty'}
        contact={contact}
        contactOptions={contacts}
        projects={projects}
        documents={documents}
        catalogReady={Boolean(catalog.data) && !catalog.error}
        detailTarget={detailId ? detailTarget : null}
        onOpenDetail={contact ? () => openDetail(contact.id) : undefined}
        onCloseDetail={closeDetail}
        onDirty={setBlocked}
        onCreated={created}
        onCancel={() => setCreating(false)}
        onOpenProject={onOpenProject}
        onOpenTask={onOpenTask}
        onOpenDocument={onOpenDocument}
        onOpenFinance={onOpenFinance}
      />
      {creating && (
        <ContactCreateDialog
          projects={projects}
          catalogReady={Boolean(catalog.data) && !catalog.error}
          onRetryProjects={() => void catalog.load().catch(() => undefined)}
          onCreated={created}
          onCancel={() => setCreating(false)}
        />
      )}
    </section>
  );
}
