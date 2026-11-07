import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Contact, ContactsRequest } from '../../../preload/caselite-api';
import { useOrdinaryCatalog } from '../../shared/data/ordinary-catalog-query';
import ReadTable from '../../shared/ui/ReadTable';

type Draft = Pick<Contact, 'name' | 'kind' | 'phone' | 'email' | 'project_ids'>;
type Save = Extract<ContactsRequest, { operation: 'save' }>;
const names = { person: '个人', organization: '组织' };
const blank: Draft = { name: '', kind: 'person', phone: '', email: '', project_ids: [] };
const listKey = ['contacts', 'local'] as const;

export default function ContactsView({ onDirty }: { onDirty(value: boolean): void }) {
  const client = useQueryClient();
  const catalog = useOrdinaryCatalog();
  const read = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const result = await window.caselite.contacts({ protocol_version: 1, operation: 'list' });
      if (!result.ok) throw new Error(result.message);
      return result.contacts;
    },
  });
  const [text, setText] = useState('');
  const [kind, setKind] = useState<keyof typeof names | ''>('');
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [form, setForm] = useState<{ id: string; version: number; draft: Draft }>();
  const [pending, setPending] = useState<Save>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const dirty = Boolean(form || busy);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const contacts = read.error ? [] : (read.data ?? []);
  const projects = catalog.error ? [] : (catalog.data?.projects ?? []);
  const projectNames = new Map(projects.map((item) => [item.id, item.title]));
  const lookup = text.trim().toLocaleLowerCase();
  const rows = contacts
    .filter(
      (contact) =>
        (!kind || kind === contact.kind) &&
        (!projectFilter || contact.project_ids.includes(projectFilter)) &&
        [contact.name, contact.phone, contact.email].some((value) =>
          value.toLocaleLowerCase().includes(lookup),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
  const pageSize = 15;
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const contact = visible.find((item) => item.id === selected) ?? visible[0];

  async function save(request: Save) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setPending(request);
    try {
      const response = await window.caselite.contacts(request);
      if (!response.ok) {
        setError(response.message);
        if (response.code !== 'RESULT_UNKNOWN' && response.code !== 'UNAVAILABLE')
          setPending(undefined);
        return;
      }
      const confirmed = response.contacts[0];
      if (
        response.receipt !== request.receipt ||
        confirmed?.id !== request.contact_id ||
        confirmed.version <= request.expected_version
      ) {
        setError('无法确认联系人回执，请核对原提交。');
        return;
      }
      // 原回执确认后才能更新目录缓存，阻止迟到的旧查询覆盖该版本。
      await client.cancelQueries({ queryKey: listKey, exact: true });
      client.setQueryData<Contact[]>(listKey, (items = []) => [
        ...items.filter((item) => item.id !== confirmed.id),
        confirmed,
      ]);
      void client.invalidateQueries({ queryKey: listKey, exact: true, refetchType: 'none' });
      setSelected(confirmed.id);
      setText('');
      setKind('');
      setProjectFilter('');
      setPage(0);
      setPending(undefined);
      setForm(undefined);
    } catch {
      setError('无法确认联系人结果，请核对原提交。');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="collection-workspace catalog-view contacts-workbench"
      data-layout="three-column"
    >
      <div className="collection-main">
        <header className="collection-heading">
          <h1>联系人</h1>
          <button
            type="button"
            className="primary"
            disabled={dirty || Boolean(read.error) || !read.data}
            onClick={() => {
              setError('');
              setForm({ id: crypto.randomUUID(), version: 0, draft: blank });
            }}
          >
            新建联系人
          </button>
        </header>
        <p className="workbench-list-caption">管理本机个人、组织及其关联项目。</p>
        <div className="view-tabs contacts-tabs">
          {(['', 'person', 'organization'] as const).map((value) => (
            <button
              key={value || 'all'}
              type="button"
              disabled={dirty}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setPage(0);
              }}
            >
              {value ? names[value] : '全部'} (
              {contacts.filter((item) => !value || item.kind === value).length})
            </button>
          ))}
        </div>
        <div className="document-directory-filters">
          <input
            aria-label="搜索联系人"
            placeholder="搜索姓名、邮箱或电话…"
            value={text}
            disabled={dirty}
            onChange={(event) => {
              setText(event.target.value);
              setPage(0);
            }}
          />
          <select
            aria-label="筛选关联项目"
            value={projectFilter}
            disabled={dirty}
            onChange={(event) => {
              setProjectFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="">所有关联项目</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
        {read.error ? (
          <p role="alert">
            {read.error.message}{' '}
            <button type="button" onClick={() => void read.refetch()}>
              重新读取
            </button>
          </p>
        ) : !read.data ? (
          <p role="status">正在读取联系人…</p>
        ) : (
          <div className="collection-scroll">
            <ReadTable
              data={visible}
              getRowId={(item) => item.id}
              label="联系人列表"
              className="catalog-table document-directory-table"
              rowProps={(item) => ({ 'aria-selected': item.id === contact?.id })}
              columns={[
                {
                  id: 'name',
                  header: '姓名',
                  cell: ({ row: { original: item } }) => (
                    <button
                      className="project-title-link"
                      type="button"
                      disabled={dirty}
                      onClick={() => setSelected(item.id)}
                    >
                      {item.name}
                    </button>
                  ),
                },
                { id: 'kind', header: '类型', accessorFn: (item) => names[item.kind] },
                { accessorKey: 'phone', header: '电话' },
                { accessorKey: 'email', header: '电子邮箱' },
                {
                  id: 'projects',
                  header: '关联项目',
                  accessorFn: (item) => item.project_ids.length,
                },
                { id: 'last-contact', header: '上次联系', cell: () => null },
              ]}
            />
            {!rows.length && <p className="catalog-empty">暂无符合条件的联系人。</p>}
          </div>
        )}
        <footer className="collection-footer">
          <span>共 {rows.length} 条联系人</span>
          <div>
            <button
              type="button"
              disabled={dirty || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={dirty || currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </button>
          </div>
        </footer>
      </div>
      <aside className="contacts-inspector" aria-label="联系人详情">
        {error && <p role="alert">{error}</p>}
        {form ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) {
                void save(pending);
                return;
              }
              void save({
                ...form.draft,
                operation: 'save',
                protocol_version: 1,
                contact_id: form.id,
                expected_version: form.version,
                receipt: crypto.randomUUID(),
              });
            }}
          >
            <h2>{form.version ? '编辑联系人' : '新建联系人'}</h2>
            <fieldset disabled={busy || Boolean(pending)}>
              <label>
                姓名
                <input
                  aria-label="联系人姓名"
                  required
                  maxLength={120}
                  value={form.draft.name}
                  onChange={(event) =>
                    setForm({ ...form, draft: { ...form.draft, name: event.target.value } })
                  }
                />
              </label>
              <label>
                类型
                <select
                  value={form.draft.kind}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      draft: {
                        ...form.draft,
                        kind: event.target.value === 'person' ? 'person' : 'organization',
                      },
                    })
                  }
                >
                  <option value="person">个人</option>
                  <option value="organization">组织</option>
                </select>
              </label>
              <label>
                电话
                <input
                  type="tel"
                  maxLength={64}
                  value={form.draft.phone}
                  onChange={(event) =>
                    setForm({ ...form, draft: { ...form.draft, phone: event.target.value } })
                  }
                />
              </label>
              <label>
                电子邮箱
                <input
                  type="email"
                  maxLength={254}
                  value={form.draft.email}
                  onChange={(event) =>
                    setForm({ ...form, draft: { ...form.draft, email: event.target.value } })
                  }
                />
              </label>
              <label>
                关联项目
                <select
                  multiple
                  disabled={Boolean(catalog.error) || !catalog.data}
                  value={form.draft.project_ids}
                  onChange={(event) => {
                    setForm({
                      ...form,
                      draft: {
                        ...form.draft,
                        project_ids: Array.from(
                          event.target.selectedOptions,
                          (option) => option.value,
                        ),
                      },
                    });
                  }}
                >
                  {projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                      {item.archived_at ? '（归档）' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <div className="contacts-actions">
              <button type="submit" className="primary" disabled={busy}>
                {pending ? '核对原提交' : '保存联系人'}
              </button>
              <button
                type="button"
                disabled={busy || Boolean(pending)}
                onClick={() => {
                  setForm(undefined);
                  setError('');
                }}
              >
                取消
              </button>
            </div>
          </form>
        ) : contact ? (
          <>
            <h2>{contact.name}</h2>
            <p>{names[contact.kind]}</p>
            <button
              type="button"
              onClick={() => {
                setError('');
                setForm({
                  id: contact.id,
                  version: contact.version,
                  draft: {
                    name: contact.name,
                    kind: contact.kind,
                    phone: contact.phone,
                    email: contact.email,
                    project_ids: contact.project_ids,
                  },
                });
              }}
            >
              编辑
            </button>
            <dl>
              <dt>电话</dt>
              <dd>{contact.phone || '—'}</dd>
              <dt>电子邮箱</dt>
              <dd>{contact.email || '—'}</dd>
            </dl>
            <h3>关联项目</h3>
            {catalog.error ? (
              <p role="status">关联项目暂不可用。</p>
            ) : (
              <ul>
                {contact.project_ids.map((id) => (
                  <li key={id}>{projectNames.get(id) ?? '项目暂不可读'}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>选择联系人查看详情，或新建联系人。</p>
        )}
      </aside>
    </section>
  );
}
