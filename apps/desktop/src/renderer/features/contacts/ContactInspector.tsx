import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Contact,
  ContactEntry,
  Matter,
  CatalogDocument,
  Task,
} from '../../../preload/caselite-api';
import InspectorLayout from '../../ui/InspectorLayout';
import SidebarAgent from '../../ui/SidebarAgent';
import { Icon } from '../../shared/ui/Icon';
import ContactProfileForm from './ContactProfileForm';
import ContactEntryForm, { contactChannels } from './ContactEntryForm';
import ContactRecordCard from './ContactRecordCard';
import { contactKey, useContactsWrite, type ContactWrite } from './useContactsWrite';

type Tab = 'projects' | 'records' | 'documents' | 'tasks' | 'notes';
const names = { person: '个人', organization: '组织' };
export default function ContactInspector({
  contact,
  creating = false,
  projects,
  documents,
  catalogReady,
  onDirty,
  onCreated,
  onCancel,
  onOpenProject,
  onOpenTask,
  onOpenDocument,
}: {
  contact?: Contact;
  creating?: boolean;
  projects: Matter[];
  documents: CatalogDocument[];
  catalogReady: boolean;
  onDirty(value: boolean): void;
  onCreated(contact: Contact): void;
  onCancel(): void;
  onOpenProject?(id: string): void;
  onOpenTask?(id: string): void;
  onOpenDocument?(id: string, taskId: string): void;
}) {
  const inspector = useRef<HTMLElement>(null);
  const showSource = (id: string) => {
    inspector.current
      ?.querySelector<HTMLButtonElement>('.inspector-ai-heading button[aria-expanded="false"]')
      ?.click();
    requestAnimationFrame(() =>
      inspector.current
        ?.querySelector<HTMLElement>(`[data-contact-run="${id}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  };
  const [editing, setEditing] = useState(creating),
    [tab, setTab] = useState<Tab>('records');
  const [editSnapshot, setEditSnapshot] = useState<Contact | undefined>(contact);
  const [entryForm, setEntryForm] = useState<{
    kind: 'communication' | 'note';
    entry?: ContactEntry;
  }>();
  const [linkForm, setLinkForm] = useState<{
    kind: 'task' | 'document';
    ids: string[];
    contactId: string;
    version: number;
  }>();
  const actions = useContactsWrite(contact?.id ?? 'new');
  const detail = useQuery({
    queryKey: contactKey(contact?.id ?? ''),
    enabled: Boolean(contact),
    queryFn: async () => {
      const result = await window.caselite.contacts({
        protocol_version: 1,
        operation: 'read',
        contact_id: contact!.id,
      });
      if (!result.ok) throw new Error(result.message);
      if (result.detail?.contact_id !== contact!.id)
        throw new Error('客户详情回执不符，请重新读取。');
      return result;
    },
  });
  const current = detail.data?.contacts.find((row) => row.id === contact?.id) ?? contact;
  const detailReady = Boolean(
    detail.data?.detail?.contact_id === contact?.id &&
    current &&
    !detail.error &&
    !detail.isFetching,
  );
  const entries = detail.data?.detail?.entries ?? [];
  const records = entries.filter((row) => row.kind === 'communication'),
    notes = entries.filter((row) => row.kind === 'note');
  const taskIds = detail.data?.detail?.task_ids ?? [],
    documentIds = detail.data?.detail?.document_ids ?? [];
  const taskRead = useQuery({
    queryKey: ['contacts', 'task-options'],
    enabled: tab === 'tasks',
    queryFn: async () => {
      const result = await window.caselite.task({ protocol_version: 1, operation: 'list' });
      if (!result.ok) throw new Error('任务列表暂不可用，请重试。');
      return result.tasks;
    },
  });
  const tasks: Task[] = taskRead.data ?? [];
  const dirty = Boolean(editing || entryForm || linkForm || actions.pending || actions.busy);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const startProfile = () => {
    if (dirty || !detailReady || !current) return;
    setEditSnapshot(structuredClone(current));
    setEditing(true);
  };
  const write = async (request: ContactWrite) => {
    const response = await actions.write(request);
    if (!response) return false;
    const savedContact = response.contacts.find((row) => row.id === request.contact_id);
    if (request.operation === 'save' && savedContact) {
      setEditing(false);
      onCreated(savedContact);
    } else if (request.operation === 'save_entry') {
      setEntryForm((form) =>
        form && form.kind === request.kind && (!form.entry || form.entry.id === request.entry_id)
          ? undefined
          : form,
      );
    } else if (request.operation === 'set_links') {
      setLinkForm((form) =>
        form?.kind === request.kind &&
        form.contactId === request.contact_id &&
        form.version === request.expected_version
          ? undefined
          : form,
      );
    }
    return true;
  };
  const profile = editing ? (
    <ContactProfileForm
      contact={editSnapshot}
      projects={projects}
      blocked={actions.busy}
      saveBlocked={!catalogReady}
      pending={actions.pending}
      onCancel={() => {
        setEditing(false);
        actions.clearError();
        if (creating) onCancel();
      }}
      onSave={(request) => void write(request)}
    />
  ) : current ? (
    <>
      <header className="customer-identity">
        <span className="customer-avatar" aria-hidden="true">
          {current.name.slice(0, 1)}
        </span>
        <div>
          <h2>{current.name}</h2>
          <span className="customer-pill">{names[current.kind]}</span>
          {current.relationship && (
            <span className="customer-pill accent">{current.relationship}</span>
          )}
        </div>
        <button
          type="button"
          className="customer-edit"
          aria-label="编辑客户"
          disabled={dirty || !detailReady}
          onClick={startProfile}
        >
          编辑
        </button>
      </header>
      {(current.company || current.position) && (
        <p className="customer-affiliation">
          {[current.company, current.position].filter(Boolean).join(' · ')}
        </p>
      )}
      <dl className="customer-facts">
        {(
          [
            ['电话', current.phone],
            ['微信', current.wechat],
            ['邮箱', current.email],
            ['城市', current.city],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
            {value && (
              <button
                type="button"
                title={`复制${label}`}
                aria-label={`复制${label}`}
                onClick={() =>
                  void navigator.clipboard.writeText(value).catch(() => actions.clearError())
                }
              >
                ⧉
              </button>
            )}
          </div>
        ))}
      </dl>
      <div className="customer-tags">
        <span>标签</span>
        {(current.tags ?? []).length ? (
          current.tags.map((tag) => (
            <span className="customer-pill" key={tag}>
              {tag}
            </span>
          ))
        ) : (
          <span className="caption">未设置</span>
        )}
      </div>
      <div className="customer-relation-tabs" role="tablist" aria-label="客户关联内容">
        {(
          [
            ['projects', '项目', current.project_ids.length],
            ['records', '联系记录', records.length],
            ['documents', '文档', documentIds.length],
            ['tasks', '任务', taskIds.length],
            ['notes', '备注', notes.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-label={`${label}（${count}）`}
            key={value}
            disabled={Boolean(entryForm || linkForm || actions.pending)}
            onClick={() => setTab(value)}
          >
            {label}
            <small>{count}</small>
          </button>
        ))}
      </div>
      <section
        className="customer-relations"
        role="tabpanel"
        aria-label={
          {
            projects: '关联项目',
            records: '联系记录',
            documents: '文档',
            tasks: '任务',
            notes: '备注',
          }[tab]
        }
      >
        {detail.isPending ? (
          <p role="status">正在读取客户详情…</p>
        ) : detail.error ? (
          <p role="alert">
            {detail.error.message}
            <button type="button" onClick={() => void detail.refetch()}>
              重新读取
            </button>
          </p>
        ) : (
          <>
            {(tab === 'records' || tab === 'notes') &&
              (entryForm ? (
                <ContactEntryForm
                  contactId={current.id}
                  kind={entryForm.kind}
                  entry={entryForm.entry}
                  pending={actions.pending}
                  blocked={actions.busy}
                  onCancel={() => {
                    setEntryForm(undefined);
                    actions.clearError();
                  }}
                  onSave={async (request) => {
                    await write(request);
                  }}
                />
              ) : (
                <>
                  <div className="customer-relation-toolbar">
                    <span>
                      共{tab === 'notes' ? notes.length : records.length}条
                      {tab === 'notes' ? '备注' : '记录'}
                    </span>
                    <button
                      type="button"
                      disabled={dirty || !detailReady}
                      onClick={() =>
                        setEntryForm({ kind: tab === 'notes' ? 'note' : 'communication' })
                      }
                    >
                      ＋ {tab === 'notes' ? '添加备注' : '手动记录'}
                    </button>
                  </div>
                  <ol className="customer-timeline">
                    {(tab === 'notes' ? notes : records).map((entry) => (
                      <li key={entry.id}>
                        <span className="customer-timeline-icon">
                          <Icon
                            name={
                              entry.channel === 'meeting'
                                ? 'person'
                                : entry.kind === 'note'
                                  ? 'file'
                                  : 'clock'
                            }
                            size={16}
                          />
                        </span>
                        <article>
                          <header>
                            <strong>{entry.title}</strong>
                            <button
                              type="button"
                              aria-label={`编辑记录：${entry.title}`}
                              disabled={dirty || !detailReady}
                              onClick={() => setEntryForm({ kind: entry.kind, entry })}
                            >
                              编辑
                            </button>
                          </header>
                          <p className="caption">
                            {entry.kind === 'communication'
                              ? `${contactChannels[entry.channel]} · ${entry.occurred_on ?? '日期未注明'} · `
                              : ''}
                            {entry.source_run_id ? 'AI 辅助 · 已人工确认' : '手动记录'}
                          </p>
                          <p>{entry.content}</p>
                          {entry.source_run_id && (
                            <button
                              type="button"
                              className="customer-source"
                              onClick={() => showSource(entry.source_run_id!)}
                            >
                              查看对应AI对话
                            </button>
                          )}
                        </article>
                      </li>
                    ))}
                  </ol>
                  {!(tab === 'notes' ? notes : records).length && (
                    <p className="customer-empty">
                      {tab === 'notes'
                        ? '暂无备注。'
                        : '暂无联系记录，可手动填写，或在下方AI对话中输入沟通内容。'}
                    </p>
                  )}
                </>
              ))}
            {tab === 'projects' && (
              <>
                <div className="customer-relation-toolbar">
                  <span>关联项目</span>
                  <button
                    type="button"
                    disabled={!catalogReady || dirty || !detailReady}
                    onClick={startProfile}
                  >
                    编辑关联
                  </button>
                </div>
                {!catalogReady ? (
                  <p role="status">项目目录暂不可用。</p>
                ) : (
                  <ul className="customer-linked-list">
                    {current.project_ids.map((id) => {
                      const project = projects.find((row) => row.id === id);
                      return (
                        <li key={id}>
                          <Icon name="folder" size={17} />
                          <button
                            type="button"
                            disabled={!project || !onOpenProject}
                            onClick={() => onOpenProject?.(id)}
                          >
                            {project?.title ?? '项目暂不可读'}
                          </button>
                          {project && (
                            <small>{project.archived_at ? '已归档' : project.status}</small>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!current.project_ids.length && <p className="customer-empty">尚未关联项目。</p>}
              </>
            )}
            {(tab === 'tasks' || tab === 'documents') && (
              <>
                <div className="customer-relation-toolbar">
                  <span>关联{tab === 'tasks' ? '任务' : '文档'}</span>
                  <button
                    type="button"
                    disabled={
                      dirty || !detailReady || !catalogReady || (tab === 'tasks' && !taskRead.data)
                    }
                    onClick={() =>
                      setLinkForm({
                        contactId: current.id,
                        version: current.version,
                        kind: tab === 'tasks' ? 'task' : 'document',
                        ids: [...(tab === 'tasks' ? taskIds : documentIds)],
                      })
                    }
                  >
                    编辑关联
                  </button>
                </div>
                {tab === 'tasks' && taskRead.error && (
                  <p role="alert">
                    {taskRead.error.message}
                    <button type="button" onClick={() => void taskRead.refetch()}>
                      重读任务
                    </button>
                  </p>
                )}
                {linkForm ? (
                  <form
                    className="customer-link-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const request = actions.pending ?? {
                        protocol_version: 1 as const,
                        operation: 'set_links' as const,
                        contact_id: linkForm.contactId,
                        receipt: crypto.randomUUID(),
                        expected_version: linkForm.version,
                        kind: linkForm.kind,
                        target_ids: linkForm.ids,
                      };
                      await write(request);
                    }}
                  >
                    <label>
                      选择已有{tab === 'tasks' ? '任务' : '文档'}
                      <select
                        multiple
                        value={linkForm.ids}
                        disabled={actions.busy || Boolean(actions.pending)}
                        onChange={(event) =>
                          setLinkForm({
                            ...linkForm,
                            ids: Array.from(event.target.selectedOptions, (row) => row.value),
                          })
                        }
                      >
                        {(tab === 'tasks' ? tasks : documents).map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="contacts-actions">
                      <button type="submit" className="primary" disabled={actions.busy}>
                        {actions.pending ? '核对原提交' : '保存关联'}
                      </button>
                      <button
                        type="button"
                        disabled={actions.busy || Boolean(actions.pending)}
                        onClick={() => setLinkForm(undefined)}
                      >
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <ul className="customer-linked-list">
                    {(tab === 'tasks' ? taskIds : documentIds).map((id) => {
                      const target =
                        tab === 'tasks'
                          ? tasks.find((row) => row.id === id)
                          : documents.find((row) => row.id === id);
                      return (
                        <li key={id}>
                          <Icon name={tab === 'tasks' ? 'check' : 'file'} size={17} />
                          <button
                            type="button"
                            disabled={!target || (tab === 'tasks' ? !onOpenTask : !onOpenDocument)}
                            onClick={() => {
                              if (tab === 'tasks') onOpenTask?.(id);
                              else if (target && 'task_id' in target)
                                onOpenDocument?.(id, target.task_id);
                            }}
                          >
                            {target?.title ?? '关联对象暂不可读'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!(tab === 'tasks' ? taskIds : documentIds).length && !linkForm && (
                  <p className="customer-empty">尚未关联{tab === 'tasks' ? '任务' : '文档'}。</p>
                )}
              </>
            )}
          </>
        )}
      </section>
    </>
  ) : (
    <p className="customer-empty">选择客户查看详情，或新建客户。</p>
  );
  return (
    <aside ref={inspector} className="contacts-inspector" aria-label="客户属性与AI">
      <InspectorLayout
        blocked={dirty}
        properties={
          <div className="customer-properties">
            {actions.error && (
              <p role="alert" className="customer-save-error">
                {actions.error}
              </p>
            )}
            {actions.pending && (
              <p role="status" className="customer-pending-recovery">
                原提交尚待核对，内容与提交身份已保留。
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => actions.pending && void write(actions.pending)}
                >
                  核对原提交结果
                </button>
              </p>
            )}
            {profile}
          </div>
        }
      >
        <SidebarAgent
          contact={current ? { id: current.id, version: current.version } : undefined}
          blocked={dirty}
          unavailable="新建或选择客户后即可对话。"
          renderRun={(run, selectForEdit) => {
            if (
              !current ||
              !run.contact_record_candidate ||
              run.status !== 'succeeded' ||
              run.output_incomplete
            )
              return undefined;
            return (
              <div data-contact-run={run.id}>
                <ContactRecordCard
                  run={run}
                  contactId={current.id}
                  saved={entries.some((entry) => entry.source_run_id === run.id)}
                  blocked={actions.busy || Boolean(editing || entryForm || linkForm)}
                  pending={actions.pending}
                  onContinue={selectForEdit}
                  onSave={write}
                />
              </div>
            );
          }}
        />
      </InspectorLayout>
    </aside>
  );
}
