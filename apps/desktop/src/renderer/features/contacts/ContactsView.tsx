import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Contact } from '../../../preload/caselite-api';
import { useOrdinaryCatalog } from '../../shared/data/ordinary-catalog-query';
import ReadTable from '../../shared/ui/ReadTable';
import { Icon } from '../../shared/ui/Icon';
import ContactInspector from './ContactInspector';
import { contactsKey } from './useContactsWrite';

const names = { person: '个人', organization: '组织' };
export default function ContactsView({
  onDirty,
  onOpenProject,
  onOpenTask,
  onOpenDocument,
}: {
  onDirty(value: boolean): void;
  onOpenProject?(id: string): void;
  onOpenTask?(id: string): void;
  onOpenDocument?(id: string, taskId: string): void;
}) {
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
    onDirty(blocked);
    return () => onDirty(false);
  }, [blocked, onDirty]);
  const contacts = read.error ? [] : (read.data ?? []);
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
  const contact = rows.find((row) => row.id === selected) ?? visible[0];
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
        <header className="collection-heading">
          <h1>客户</h1>
          <button
            type="button"
            className="primary"
            disabled={blocked || Boolean(read.error) || !read.data}
            onClick={() => setCreating(true)}
          >
            ＋ 新建客户
          </button>
        </header>
        <p className="workbench-list-caption">管理客户资料，记录每次沟通。</p>
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
              aria-label="搜索客户"
              placeholder="搜索姓名、单位、电话或邮箱…"
              value={text}
              disabled={blocked}
              onChange={(event) => filter(() => setText(event.target.value))}
            />
          </label>
          <select
            aria-label="筛选客户关系"
            disabled={blocked}
            value={relationship}
            onChange={(e) => filter(() => setRelationship(e.target.value))}
          >
            <option value="">关系</option>
            {[...new Set(contacts.map((row) => row.relationship).filter(Boolean))].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="筛选客户标签"
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
            全部客户
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
          <p role="status">正在读取客户…</p>
        ) : (
          <div className="collection-scroll">
            <ReadTable
              data={visible}
              getRowId={(row) => row.id}
              label="客户列表"
              className="catalog-table customer-table"
              rowProps={(row) => ({ 'aria-selected': row.id === contact?.id })}
              columns={[
                {
                  id: 'name',
                  header: '姓名／名称',
                  cell: ({ row: { original: row } }) => (
                    <button
                      type="button"
                      className="customer-name"
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
            {!rows.length && <p className="catalog-empty">暂无符合条件的客户，可新建客户。</p>}
          </div>
        )}
        <footer className="collection-footer">
          <span>共{rows.length}位客户</span>
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
      <ContactInspector
        key={creating ? 'new' : (contact?.id ?? 'empty')}
        contact={creating ? undefined : contact}
        creating={creating}
        projects={projects}
        documents={documents}
        catalogReady={Boolean(catalog.data) && !catalog.error}
        onDirty={setBlocked}
        onCreated={created}
        onCancel={() => setCreating(false)}
        onOpenProject={onOpenProject}
        onOpenTask={onOpenTask}
        onOpenDocument={onOpenDocument}
      />
    </section>
  );
}
