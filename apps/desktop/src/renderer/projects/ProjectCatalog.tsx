import { useEffect, useState, useRef } from 'react';
import type { Matter, Task, CatalogRequest } from '../../preload/caselite-api';
import { DraftEditor, emptyDraft, type RichDraft } from '../editors/RichEditor';
import { Icon } from '../ui/Workspace';
import AgentPanel from '../ui/AgentPanel';
import { useCatalog, catalogMutation } from '../ui/useCatalog';
import ProjectCreateDialog from './ProjectCreateDialog';
import ProjectSummary from './ProjectSummary';
import ProjectFiles from './ProjectFiles';
const names = { planned: '待开始', active: '进行中', done: '已完成' };
const sections = {
  overview: '概述',
  tasks: '任务',
  files: '文件',
  deliverables: '交付物',
  activity: '活动',
};
export default function ProjectCatalog({
  tasks,
  onOpen,
  onDirty,
  onChanged,
}: {
  tasks: Task[];
  onOpen(id: string): void;
  onDirty(v: boolean): void;
  onChanged(): void;
}) {
  const c = useCatalog(),
    [selected, setSelected] = useState<string | null>(null),
    [archived, setArchived] = useState(false),
    [creating, setCreating] = useState(false),
    [editor, setEditor] = useState<{
      project: Matter;
      state: number[] | null;
      epoch: number;
    } | null>(null),
    [dirty, setDirty] = useState(false),
    [assigning, setAssigning] = useState('');
  const [section, setSection] = useState<keyof typeof sections>('overview');
  const [side, setSide] = useState('properties'),
    [aiTask, setAiTask] = useState('');
  const alive = useRef(true),
    readId = useRef(0);
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState(''),
    [createdId, setCreatedId] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const list = (c.data?.projects ?? []).filter((p) => !!p.archived_at === archived),
    p = editor
      ? (c.data?.projects.find((x) => x.id === editor.project.id) ?? editor.project)
      : (list.find((x) => x.id === selected) ?? list[0]);
  useEffect(() => {
    onDirty(dirty || creating || reading || c.pending || c.unknown);
    return () => onDirty(false);
  }, [dirty, creating, reading, c.pending, c.unknown, onDirty]);
  const read = async (id: string) => {
    const sequence = ++readId.current;
    setReading(true);
    setReadError('');
    try {
      const r = await window.caselite.catalog({
        operation: 'read_project',
        protocol_version: 1,
        id,
      });
      if (!alive.current || sequence !== readId.current) return;
      if (r.ok) {
        const actual = r.projects.find((p) => p.id === id);
        if (actual) {
          setEditor({ project: actual, state: r.state, epoch: sequence });
          setCreatedId(null);
          setSection('overview');
        } else setReadError('未能读取该项目，请重试打开。');
      } else setReadError(r.message);
    } catch {
      if (alive.current && sequence === readId.current) setReadError('无法读取项目说明，请重试。');
    } finally {
      if (alive.current && sequence === readId.current) setReading(false);
    }
  };
  const open = async (project: Matter) => {
    if (!dirty && !creating && !reading && !c.pending && !c.unknown) await read(project.id);
  };
  const command = (
    input: CatalogRequest,
    done?: (
      r: Extract<Awaited<ReturnType<typeof c.execute>>, { ok: true }>,
    ) => void | Promise<void>,
  ) =>
    c.execute(input, async (r) => {
      onChanged();
      if (input.operation === 'archive_project') {
        setEditor(null);
        setSelected(null);
      }
      await done?.(r);
    });
  return (
    <section
      className="collection-workspace catalog-view"
      data-layout="three-column"
      data-testid="project-catalog"
    >
      <div className="collection-main">
        <div className="collection-heading">
          <Icon name="folder" size={18} />
          <h1>项目</h1>
          <span>{list.length}</span>
        </div>
        <div className="view-toolbar">
          <div className="view-tabs">
            {[false, true].map((a) => (
              <button
                key={String(a)}
                className={a === archived ? 'current' : ''}
                disabled={reading || dirty || creating || c.pending || c.unknown}
                onClick={() => {
                  setArchived(a);
                  setSelected(null);
                  setEditor(null);
                }}
              >
                {a ? '已归档' : '全部项目'}
              </button>
            ))}
          </div>
          <button
            disabled={reading || dirty || creating || c.pending || c.unknown}
            onClick={() => setCreating(true)}
          >
            创建项目
          </button>
        </div>
        {readError && <p role="alert">{readError}</p>}
        {createdId && readError && (
          <div className="project-open-recovery">
            <p>项目已保存，暂时无法打开。请重试打开这个项目。</p>
            <button disabled={reading} onClick={() => void read(createdId)}>
              重新打开已创建项目
            </button>
          </div>
        )}
        {c.error && !creating && (
          <p role="alert" className="assistant-error">
            {c.error}
          </p>
        )}
        {c.unknown && !creating && (
          <button disabled={c.pending} onClick={() => void c.retry()}>
            核对原提交
          </button>
        )}
        <div className="collection-scroll">
          {editor ? (
            <>
              <div className="project-detail-heading">
                <button
                  disabled={reading || dirty || c.pending || c.unknown}
                  onClick={() => setEditor(null)}
                >
                  返回项目列表
                </button>
                <strong>{(p ?? editor.project).title}</strong>
              </div>
              <div className="project-section-tabs" role="tablist" aria-label="项目栏目">
                {Object.entries(sections).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    id={`project-tab-${id}`}
                    aria-controls={`project-panel-${id}`}
                    aria-selected={section === id}
                    disabled={reading || dirty || c.pending || c.unknown}
                    onClick={() => setSection(id as keyof typeof sections)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                hidden={section !== 'overview'}
                role="tabpanel"
                id="project-panel-overview"
                aria-labelledby="project-tab-overview"
              >
                <ProjectSummary
                  project={p ?? editor.project}
                  tasks={tasks}
                  documents={c.data?.documents ?? []}
                  unavailable={!!c.error || !c.data}
                  disabled={reading || dirty || c.pending || c.unknown}
                  onOpen={onOpen}
                />
                <ProjectEditor
                  key={editor.project.id + ':' + editor.project.version + ':' + editor.epoch}
                  data={editor}
                  pending={reading || c.pending || c.unknown}
                  onDirty={setDirty}
                  onReload={() => {
                    setDirty(false);
                    void read(editor.project.id);
                  }}
                  onSave={async (values) => {
                    await command(
                      catalogMutation({
                        operation: 'update_project' as const,
                        id: editor.project.id,
                        expected_version: editor.project.version,
                        expected_body_revision: editor.project.body_revision,
                        ...values,
                      }),
                      async () => {
                        setDirty(false);
                        await read(editor.project.id);
                      },
                    );
                  }}
                />
              </div>
              <section
                hidden={section !== 'tasks'}
                role="tabpanel"
                id="project-panel-tasks"
                aria-labelledby="project-tab-tasks"
                className="project-record-panel"
              >
                <h2>项目任务</h2>
                {tasks
                  .filter((task) => task.matter_id === editor.project.id)
                  .map((task) => (
                    <button
                      key={task.id}
                      disabled={reading || c.pending || c.unknown}
                      onClick={() => onOpen(task.id)}
                    >
                      {task.title}
                    </button>
                  ))}
                {!tasks.some((task) => task.matter_id === editor.project.id) && (
                  <p>
                    {p?.task_count
                      ? '任务列表正在更新，请稍后重读。'
                      : '还没有任务。可在右侧归入已有任务，或从独立任务创建项目。'}
                  </p>
                )}
              </section>
              <section
                hidden={section !== 'files'}
                role="tabpanel"
                id="project-panel-files"
                aria-labelledby="project-tab-files"
                className="project-record-panel"
              >
                <h2>项目文件</h2>
                {section === 'files' && (
                  <ProjectFiles
                    key={editor.project.id}
                    projectId={editor.project.id}
                    disabled={reading || dirty || c.pending || c.unknown}
                  />
                )}
              </section>
              <section
                hidden={section !== 'deliverables'}
                role="tabpanel"
                id="project-panel-deliverables"
                aria-labelledby="project-tab-deliverables"
                className="project-record-panel"
              >
                <h2>交付物</h2>
                <p>正式交付物视图尚未接入。已保存文档可从概述打开，保存不代表正式交付。</p>
              </section>
              <section
                hidden={section !== 'activity'}
                role="tabpanel"
                id="project-panel-activity"
                aria-labelledby="project-tab-activity"
                className="project-record-panel"
              >
                <h2>活动</h2>
                <p>项目活动列表尚未接入。</p>
              </section>
            </>
          ) : (
            <>
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th>项目名称</th>
                    <th>状态</th>
                    <th>任务</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr
                      key={m.id}
                      data-project-id={m.id}
                      aria-selected={p?.id === m.id}
                      onClick={() => {
                        if (!reading && !creating && !dirty && !c.pending && !c.unknown)
                          setSelected(m.id);
                      }}
                      onDoubleClick={() => void open(m)}
                    >
                      <td>
                        <button
                          className="project-title-link"
                          disabled={reading || creating || dirty || c.pending || c.unknown}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(m.id);
                            void open(m);
                          }}
                        >
                          <Icon name="folder" size={14} /> {m.title}
                        </button>
                      </td>
                      <td>{names[m.status]}</td>
                      <td>{m.task_count}</td>
                      <td>{new Date(m.updated_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && (
                <p className="catalog-empty">
                  {c.data ? '暂无项目，独立任务仍可直接使用。' : '正在读取本地项目…'}
                </p>
              )}
            </>
          )}
        </div>
        <footer className="collection-footer">真实本地项目 · 仅此设备</footer>
      </div>
      <aside className="project-properties">
        <div className="inspector-tabs" role="tablist" aria-label="项目辅助栏">
          <button
            role="tab"
            aria-selected={side === 'properties'}
            onClick={() => setSide('properties')}
          >
            属性
          </button>
          <button role="tab" aria-selected={side === 'ai'} onClick={() => setSide('ai')}>
            AI 助手
          </button>
        </div>
        {side === 'ai' ? (
          <div className="project-ai-content">
            <h3>项目任务 AI</h3>
            <p>选择本项目中的任务，在其原有范围内工作。</p>
            <select
              aria-label="项目 AI 任务"
              value={tasks.some((t) => t.id === aiTask && t.matter_id === p?.id) ? aiTask : ''}
              onChange={(e) => setAiTask(e.target.value)}
            >
              <option value="">选择项目任务</option>
              {tasks
                .filter((t) => t.matter_id === p?.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
            {tasks.some((t) => t.id === aiTask && t.matter_id === p?.id) && (
              <AgentPanel key={aiTask} scope={aiTask} />
            )}
          </div>
        ) : p ? (
          <>
            <h3>{p.title}</h3>
            <p>
              {names[p.status]} · {p.task_count} 个任务
            </p>
            <p>
              {p.archived_at ? '已归档' : '本地项目'} · 版本 {p.version}
            </p>
            <div className="catalog-buttons">
              <button
                disabled={reading || creating || dirty || c.pending || c.unknown}
                onClick={() => void open(p)}
              >
                打开项目
              </button>
              <button
                disabled={reading || creating || dirty || c.pending || c.unknown}
                onClick={() =>
                  void command(
                    catalogMutation({
                      operation: 'archive_project' as const,
                      id: p.id,
                      expected_version: p.version,
                      archived: !p.archived_at,
                    }),
                  )
                }
              >
                {p.archived_at ? '恢复项目' : '归档项目'}
              </button>
            </div>
            <h3>项目任务</h3>
            {tasks
              .filter((t) => t.matter_id === p.id)
              .map((t) => (
                <div key={t.id}>
                  <button
                    disabled={reading || dirty || creating || c.pending || c.unknown}
                    onClick={() => onOpen(t.id)}
                  >
                    {t.title}
                  </button>
                  <button
                    disabled={reading || dirty || creating || c.pending || c.unknown}
                    onClick={() =>
                      void command(
                        catalogMutation({
                          operation: 'assign_task' as const,
                          task_id: t.id,
                          expected_version: t.version,
                          matter_id: null,
                        }),
                      )
                    }
                  >
                    移出项目
                  </button>
                </div>
              ))}
            {!p.archived_at && (
              <>
                <label>
                  归入已有任务
                  <select
                    aria-label="归入已有任务"
                    value={assigning}
                    disabled={reading || dirty || creating || c.pending || c.unknown}
                    onChange={(e) => setAssigning(e.target.value)}
                  >
                    <option value="">选择任务</option>
                    {tasks
                      .filter((t) => t.matter_id !== p.id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={reading || !assigning || dirty || creating || c.pending || c.unknown}
                  onClick={() => {
                    const t = tasks.find((t) => t.id === assigning);
                    if (t)
                      void command(
                        catalogMutation({
                          operation: 'assign_task' as const,
                          task_id: t.id,
                          expected_version: t.version,
                          matter_id: p.id,
                        }),
                        () => setAssigning(''),
                      );
                  }}
                >
                  归入项目
                </button>
              </>
            )}
            <p className="caption">归组保留任务、正文和历史身份。</p>
          </>
        ) : (
          <p>选择项目查看实际属性。</p>
        )}
      </aside>
      {creating && (
        <ProjectCreateDialog
          pending={c.pending}
          unknown={c.unknown}
          error={c.error}
          onCancel={() => setCreating(false)}
          onRetry={() => void c.retry()}
          onCreate={(title) => {
            void command(
              catalogMutation({ operation: 'create_project' as const, title }),
              async (r) => {
                setCreating(false);
                setArchived(false);
                setSelected(r.target_id);
                setEditor(null);
                if (r.target_id) {
                  setCreatedId(r.target_id);
                  await read(r.target_id);
                }
              },
            );
          }}
        />
      )}
    </section>
  );
}
function ProjectEditor({
  data,
  pending,
  onDirty,
  onSave,
  onReload,
}: {
  data: { project: Matter; state: number[] | null };
  pending: boolean;
  onDirty(v: boolean): void;
  onSave(v: { title: string; status: Matter['status']; state?: number[] }): Promise<void>;
  onReload(): void;
}) {
  const [title, setTitle] = useState(data.project.title),
    [status, setStatus] = useState(data.project.status),
    [draft, setDraft] = useState<RichDraft>(() => ({ text: '', state: data.state })),
    [dirty, setDirty] = useState(false);
  const change = () => {
    setDirty(true);
    onDirty(true);
  };
  return (
    <div className="catalog-actions" data-project-id={data.project.id}>
      <h2>项目概述</h2>
      <label>
        名称
        <input
          aria-label="编辑项目名称"
          value={title}
          maxLength={160}
          disabled={pending || !!data.project.archived_at}
          onChange={(e) => {
            setTitle(e.target.value);
            change();
          }}
        />
      </label>
      <label>
        状态
        <select
          aria-label="项目状态"
          value={status}
          disabled={pending || !!data.project.archived_at}
          onChange={(e) => {
            setStatus(e.target.value as Matter['status']);
            change();
          }}
        >
          {Object.entries(names).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <DraftEditor
        value={draft ?? emptyDraft()}
        onChange={(v) => {
          setDraft(v);
          change();
        }}
        label="项目概述"
        testId="project-overview-editor"
        disabled={pending || !!data.project.archived_at}
      />
      <button
        className="primary"
        disabled={!dirty || pending || !title.trim() || !!data.project.archived_at}
        onClick={() =>
          void onSave({ title, status, ...(draft.state ? { state: draft.state } : {}) })
        }
      >
        保存项目概述
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (!dirty || window.confirm('放弃当前未保存修改并重新读取项目？')) onReload();
        }}
      >
        放弃修改并重读
      </button>
      <p role="status">
        {dirty ? '有未保存修改，请保存后切换。' : `已保存 · 说明修订 ${data.project.body_revision}`}
      </p>
    </div>
  );
}
