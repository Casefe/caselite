import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
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
import { contactTimeline, readContactSources } from './contact-activity';
import ContactSourcePicker from './ContactSourcePicker';
import ContactProfileForm from './ContactProfileForm';
import ContactInlineProfile, { profileRequest } from './ContactInlineProfile';
import ContactEntryForm, { contactChannels } from './ContactEntryForm';
import ContactRecordCard from './ContactRecordCard';
import { contactKey, useContactsWrite, type ContactWrite } from './useContactsWrite';

function activityDate(value: string | null) {
  if (!value) return '日期未记录';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '日期未记录'
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}
type Tab = 'projects' | 'records' | 'documents' | 'tasks' | 'notes';
export default function ContactInspector({
  contact,
  creating = false,
  contactOptions = [],
  projects,
  documents,
  catalogReady,
  onDirty,
  onCreated,
  onCancel,
  onOpenProject,
  onOpenTask,
  onOpenDocument,
  onOpenFinance,
  detailTarget,
  onOpenDetail,
  onCloseDetail,
}: {
  contact?: Contact;
  creating?: boolean;
  contactOptions?: Contact[];
  projects: Matter[];
  documents: CatalogDocument[];
  catalogReady: boolean;
  onDirty(value: boolean): void;
  onCreated(contact: Contact): void;
  onCancel(): void;
  onOpenProject?(id: string): void;
  onOpenTask?(id: string): void;
  onOpenDocument?(id: string, taskId: string): void;
  onOpenFinance?(id: string): void;
  detailTarget?: HTMLElement | null;
  onOpenDetail?(): void;
  onCloseDetail?(): void;
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
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileRecovery, setProfileRecovery] = useState(0);
  const [identityTarget, setIdentityTarget] = useState<HTMLDivElement | null>(null);
  const [recordSearch, setRecordSearch] = useState('');
  const [sourceEditing, setSourceEditing] = useState(false);
  const [sourcePreviewId, setSourcePreviewId] = useState<string>();
  const [sourcePages, setSourcePages] = useState(1);
  const [entryForm, setEntryForm] = useState<{
    kind: 'communication' | 'note';
    entry?: ContactEntry;
  }>();
  const [linkForm, setLinkForm] = useState<{
    kind: 'task' | 'document' | 'project';
    snapshot?: Contact;
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
        throw new Error('联系人详情回执不符，请重新读取。');
      return result;
    },
  });
  const detailed = detail.data?.contacts.find((row) => row.id === contact?.id);
  const current = (detailed?.version ?? 0) >= (contact?.version ?? 0) ? detailed : contact;
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
    enabled: tab === 'tasks' || sourceEditing,
    queryFn: async () => {
      const result = await window.caselite.task({ protocol_version: 1, operation: 'list' });
      if (!result.ok) throw new Error('任务列表暂不可用，请重试。');
      return result.tasks;
    },
  });
  const tasks: Task[] = taskRead.data ?? [];
  const sourceRefs = detail.data?.detail?.source_links ?? [];
  const sourceRead = useQuery({
    queryKey: [
      'contacts',
      'activity',
      current?.id,
      current?.version,
      sourceRefs,
      taskIds,
      sourcePages,
    ],
    enabled: Boolean(
      current && detail.data?.detail && tab === 'records' && (sourceRefs.length || taskIds.length),
    ),
    refetchOnWindowFocus: true,
    queryFn: () => readContactSources(sourceRefs, taskIds, sourcePages),
  });
  const visibleSources =
    detail.error || sourceRead.error || sourceRead.isFetching ? [] : (sourceRead.data?.items ?? []);
  const timeline = contactTimeline(records, visibleSources);
  const sourcePreview = visibleSources.find((item) => item.id === sourcePreviewId);
  const sourceScopes = [
    { value: `contact:${current?.id}`, label: '此联系人对话' },
    { value: 'home', label: '主控台对话' },
    ...contactOptions
      .filter((row) => row.id !== current?.id)
      .map((row) => ({ value: `contact:${row.id}`, label: `联系人 · ${row.name}` })),
    ...projects.map((row) => ({ value: `project:${row.id}`, label: `项目 · ${row.title}` })),
    ...tasks.map((row) => ({ value: row.id, label: `任务 · ${row.title}` })),
    ...documents.map((row) => ({ value: `document:${row.id}`, label: `文档 · ${row.title}` })),
  ];
  const dirty = Boolean(
    editing ||
    profileDirty ||
    entryForm ||
    linkForm ||
    sourceEditing ||
    actions.pending ||
    actions.busy,
  );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const write = async (request: ContactWrite) => {
    const recovering = Boolean(actions.pending);
    const response = await actions.write(request);
    if (!response) return false;
    const savedContact = response.contacts.find((row) => row.id === request.contact_id);
    if (request.operation === 'save' && savedContact) {
      setEditing(false);
      if (creating) onCreated(savedContact);
      if (recovering) setProfileRecovery((value) => value + 1);
      if (linkForm?.kind === 'project') setLinkForm(undefined);
    } else if (request.operation === 'save_entry') {
      setEntryForm((form) =>
        form && form.kind === request.kind && (!form.entry || form.entry.id === request.entry_id)
          ? undefined
          : form,
      );
    } else if (request.operation === 'set_source_links') {
      setSourceEditing(false);
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
      contact={contact}
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
      <ContactInlineProfile
        key={profileRecovery}
        contact={current}
        identityTarget={detailTarget ? identityTarget : undefined}
        disabled={
          Boolean(editing || entryForm || linkForm || sourceEditing) ||
          !detailReady ||
          !catalogReady
        }
        busy={actions.busy}
        pending={actions.pending}
        onDirty={setProfileDirty}
        onCancel={actions.clearError}
        onSave={async (request) => {
          const response = await actions.write(request);
          return response?.contacts.find((row) => row.id === request.contact_id);
        }}
      />
    </>
  ) : (
    <p className="customer-empty">选择联系人查看详情，或新建联系人。</p>
  );
  const relations =
    current && !creating ? (
      <>
        <div className="customer-relation-tabs" role="tablist" aria-label="联系人关联内容">
          {(
            [
              ['projects', '项目', current.project_ids.length],
              ['records', '往来记录', timeline.length],
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
              disabled={dirty}
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
              records: '往来记录',
              documents: '文档',
              tasks: '任务',
              notes: '备注',
            }[tab]
          }
        >
          {detail.error && detail.data && (
            <p role="alert">
              刷新未成功，已保留当前内容和草稿。
              <button type="button" onClick={() => void detail.refetch()}>
                重新读取
              </button>
            </p>
          )}
          {detail.isPending ? (
            <p role="status">正在读取联系人详情…</p>
          ) : detail.error && !detail.data ? (
            <p role="alert">
              {detail.error.message}
              <button type="button" onClick={() => void detail.refetch()}>
                重新读取
              </button>
            </p>
          ) : (
            <>
              {(tab === 'records' || tab === 'notes') && (
                <>
                  <div className="customer-relation-toolbar">
                    {detailTarget && <h2>{tab === 'notes' ? '备注' : '往来记录'}</h2>}
                    <span>
                      共{tab === 'notes' ? notes.length : timeline.length}条
                      {tab === 'notes' ? '备注' : '记录'}
                    </span>
                    {detailTarget && (
                      <input
                        type="search"
                        aria-label="搜索往来记录"
                        placeholder="搜索记录"
                        disabled={Boolean(entryForm)}
                        value={recordSearch}
                        onChange={(event) => setRecordSearch(event.target.value)}
                      />
                    )}
                    {tab === 'records' && (
                      <button
                        type="button"
                        disabled={dirty || !detailReady || detail.data?.detail?.sources_unavailable}
                        onClick={() => setSourceEditing(true)}
                      >
                        关联来源
                      </button>
                    )}
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
                  {tab === 'records' && sourceRead.isFetching && (
                    <p role="status">正在读取关联往来…</p>
                  )}
                  {tab === 'records' &&
                    (sourceRead.error ||
                      sourceRead.data?.partial ||
                      detail.data?.detail?.sources_unavailable) && (
                      <p role="alert">
                        部分来源暂不可读，当前记录仍可使用。
                        <button
                          type="button"
                          disabled={dirty}
                          onClick={() => {
                            void detail.refetch();
                            void sourceRead.refetch();
                          }}
                        >
                          重新读取来源
                        </button>
                      </p>
                    )}
                  {sourceEditing && (
                    <ContactSourcePicker
                      contact={current}
                      refs={sourceRefs}
                      scopes={sourceScopes}
                      blocked={actions.busy}
                      pending={actions.pending}
                      onSave={write}
                      onCancel={() => {
                        setSourceEditing(false);
                        actions.clearError();
                      }}
                    />
                  )}
                  {sourcePreview && (
                    <section className="customer-source-preview" aria-label="原始对话">
                      <button type="button" onClick={() => setSourcePreviewId(undefined)}>
                        关闭原始对话
                      </button>
                      <h3>{sourcePreview.title}</h3>
                      <p>{sourcePreview.content}</p>
                    </section>
                  )}
                  {entryForm && !entryForm.entry && (
                    <ContactEntryForm
                      contactId={current.id}
                      kind={entryForm.kind}
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
                  )}
                  <ol className="customer-timeline">
                    {(tab === 'notes' ? contactTimeline(notes, []) : timeline)
                      .filter(
                        (item) =>
                          item.entry?.id === entryForm?.entry?.id ||
                          !recordSearch ||
                          `${item.title} ${item.content}`.includes(recordSearch),
                      )
                      .map((item) => {
                        const entry = item.entry;
                        return entry ? (
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
                              {entryForm?.entry?.id === entry.id ? (
                                <ContactEntryForm
                                  key={entry.id}
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
                                </>
                              )}
                            </article>
                          </li>
                        ) : (
                          <li key={item.id}>
                            <span className="customer-timeline-icon">
                              <Icon name="clock" size={16} />
                            </span>
                            <article>
                              <header>
                                <strong>{item.title}</strong>
                              </header>
                              <p className="caption">
                                {item.label} · {activityDate(item.date)}
                              </p>
                              <p>{item.content}</p>
                              <button
                                type="button"
                                className="customer-source"
                                disabled={dirty}
                                onClick={() => {
                                  if (item.source?.kind === 'run') {
                                    setSourcePreviewId(item.id);
                                    void sourceRead.refetch();
                                  } else if (item.source?.kind === 'payment')
                                    onOpenFinance?.(item.source.scope);
                                  else if (item.taskId) onOpenTask?.(item.taskId);
                                }}
                              >
                                查看原始来源
                              </button>
                            </article>
                          </li>
                        );
                      })}
                  </ol>
                  {tab === 'records' && sourceRead.data?.more && (
                    <button
                      type="button"
                      disabled={dirty || sourceRead.isFetching}
                      onClick={() => setSourcePages((value) => value + 1)}
                    >
                      加载更早的任务活动
                    </button>
                  )}
                  {!(tab === 'notes' ? notes : timeline).length && !sourceRead.isFetching && (
                    <p className="customer-empty">
                      {tab === 'notes'
                        ? '暂无备注。'
                        : '暂无往来记录。可手动填写，在下方 AI 对话中整理，或关联已有来源。'}
                    </p>
                  )}
                </>
              )}
              {tab === 'projects' && (
                <>
                  <div className="customer-relation-toolbar">
                    <span>关联项目</span>
                    <button
                      type="button"
                      disabled={!catalogReady || dirty || !detailReady}
                      onClick={() =>
                        setLinkForm({
                          kind: 'project',
                          contactId: current.id,
                          version: current.version,
                          ids: [...current.project_ids],
                          snapshot: structuredClone(current),
                        })
                      }
                    >
                      编辑关联
                    </button>
                  </div>
                  {linkForm?.kind === 'project' && (
                    <form
                      className="customer-link-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (!linkForm.snapshot) return;
                        await write(
                          actions.pending ?? {
                            ...profileRequest(linkForm.snapshot),
                            project_ids: linkForm.ids,
                          },
                        );
                      }}
                    >
                      <label>
                        选择已有项目
                        <select
                          multiple
                          aria-label="关联项目"
                          value={linkForm.ids}
                          disabled={actions.busy || Boolean(actions.pending)}
                          onChange={(event) =>
                            setLinkForm({
                              ...linkForm,
                              ids: Array.from(event.target.selectedOptions, (row) => row.value),
                            })
                          }
                        >
                          {projects
                            .filter((row) => !row.archived_at || linkForm.ids.includes(row.id))
                            .map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="contacts-actions">
                        <button
                          type="submit"
                          className="primary"
                          disabled={actions.busy || !catalogReady}
                        >
                          {actions.pending ? '核对原提交' : '保存关联'}
                        </button>
                        <button
                          type="button"
                          disabled={actions.busy || Boolean(actions.pending)}
                          onClick={() => {
                            setLinkForm(undefined);
                            actions.clearError();
                          }}
                        >
                          取消
                        </button>
                      </div>
                    </form>
                  )}
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
                        dirty ||
                        !detailReady ||
                        !catalogReady ||
                        (tab === 'tasks' && !taskRead.data)
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
                          kind: linkForm.kind === 'project' ? 'task' : linkForm.kind,
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
                              disabled={
                                !target || (tab === 'tasks' ? !onOpenTask : !onOpenDocument)
                              }
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
    ) : null;
  return (
    <>
      {detailTarget &&
        current &&
        createPortal(
          <div className="customer-detail-page">
            <nav aria-label="联系人详情导航">
              <span>联系人 / {current.name}</span>
              <button type="button" disabled={dirty} onClick={onCloseDetail}>
                ← 返回联系人列表
              </button>
            </nav>
            <div ref={setIdentityTarget} className="customer-detail-identity" />
            {relations}
          </div>,
          detailTarget,
        )}
      <aside ref={inspector} className="contacts-inspector" aria-label="联系人属性与AI">
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
              {!detailTarget && current && onOpenDetail && (
                <button
                  type="button"
                  className="customer-open-detail"
                  disabled={dirty}
                  onClick={onOpenDetail}
                >
                  打开详情 ↗
                </button>
              )}
              {profile}
              {!detailTarget && relations}
            </div>
          }
        >
          <SidebarAgent
            contact={current ? { id: current.id, version: current.version } : undefined}
            blocked={dirty}
            unavailable="新建或选择联系人后即可对话。"
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
                    blocked={
                      actions.busy ||
                      Boolean(editing || profileDirty || entryForm || linkForm || sourceEditing)
                    }
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
    </>
  );
}
