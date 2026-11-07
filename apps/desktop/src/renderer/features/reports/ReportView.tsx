import { useState } from 'react';
import { useOrdinaryCatalog } from '../../shared/data/ordinary-catalog-query';
import ReadTable from '../../shared/ui/ReadTable';
import { formatCents } from '../finance/money';
import type { Task } from '../../../preload/caselite-api';

const stages = [
  { id: 'planned', title: '待开案' },
  { id: 'active', title: '开放' },
  { id: 'done', title: '已结案' },
] as const;

export default function ReportView({
  tasks,
  onFinance,
}: {
  tasks: Task[];
  onFinance(id: string): void;
}) {
  const read = useOrdinaryCatalog();
  const [tab, setTab] = useState('overview');
  const [owner, setOwner] = useState('');
  const projects = read.data?.projects ?? [];
  const owners = [
    ...new Set(projects.flatMap((p) => (p.attributes?.assignee ? [p.attributes.assignee] : []))),
  ].sort();
  const rows = projects.filter((p) => !owner || p.attributes?.assignee === owner);
  const scopedProjects = new Set(rows.map((p) => p.id));
  const scopedTasks = owner
    ? tasks.filter((t) => t.matter_id && scopedProjects.has(t.matter_id))
    : tasks;
  const docCount = read.data?.documents.filter(
    (doc) => !doc.archived_at && (!owner || (doc.matter_id && scopedProjects.has(doc.matter_id))),
  ).length;
  const balances = rows.flatMap((p) => (p.outstanding_cents == null ? [] : [p.outstanding_cents]));
  const balance = balances.length ? balances.reduce((sum, value) => sum + value, 0) : undefined;
  return (
    <main className="workspace-placeholder report-workbench">
      <header className="report-workbench-heading">
        <div>
          <h1>报告</h1>
          <p>从本机项目、任务、文档和收费台账查看业务概况。</p>
        </div>
        <label>
          负责人{' '}
          <select value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">所有负责人</option>
            {owners.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </header>
      <nav className="view-tabs" aria-label="报告分类">
        {Object.entries({ overview: '业务概览', finance: '财务', projects: '案件' }).map(
          ([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ),
        )}
        <button type="button" disabled title="尚无计时数据">
          工时
        </button>
        <button type="button" disabled title="尚无团队数据">
          团队
        </button>
      </nav>
      {read.error ? (
        <p role="alert">
          {read.error}{' '}
          <button type="button" onClick={() => void read.load().catch(() => {})}>
            重新读取报告
          </button>
        </p>
      ) : !read.data ? (
        <p role="status">正在读取报告…</p>
      ) : (
        <>
          {tab !== 'projects' && (
            <dl className="report-metrics">
              <div>
                <dt>项目</dt>
                <dd>{rows.length}</dd>
              </div>
              <div>
                <dt>任务</dt>
                <dd>{scopedTasks.length}</dd>
              </div>
              <div>
                <dt>有效文档</dt>
                <dd>{docCount}</dd>
              </div>
              <div>
                <dt>合同待收款</dt>
                <dd>{balance === undefined ? '—' : `¥${formatCents(balance)}`}</dd>
              </div>
            </dl>
          )}
          {tab !== 'finance' && (
            <section className="report-stages">
              <h2>项目阶段分布</h2>
              {stages.map(({ id, title }) => {
                const count = rows.filter(
                  (project) => !project.archived_at && project.status === id,
                ).length;
                return (
                  <div key={id}>
                    <span>{title}</span>
                    <meter
                      min={0}
                      max={Math.max(1, rows.length)}
                      value={count}
                      aria-label={title}
                    />
                    <strong>{count}</strong>
                  </div>
                );
              })}
              <div>
                <span>已归档</span>
                <meter
                  min={0}
                  max={Math.max(1, rows.length)}
                  value={rows.filter((p) => p.archived_at).length}
                  aria-label="已归档"
                />
                <strong>{rows.filter((p) => p.archived_at).length}</strong>
              </div>
            </section>
          )}
          <section className="report-project-list">
            <h2>项目明细</h2>
            <ReadTable
              data={rows}
              getRowId={(project) => project.id}
              label="项目报告明细"
              columns={[
                { accessorKey: 'title', header: '项目名称' },
                {
                  id: 'owner',
                  header: '负责人',
                  accessorFn: (project) => project.attributes?.assignee ?? '—',
                },
                { accessorKey: 'task_count', header: '任务数' },
                {
                  id: 'balance',
                  header: '待收款（元）',
                  cell: ({ row: { original: project } }) => (
                    <button
                      type="button"
                      aria-label={`查看 ${project.title} 的账本`}
                      onClick={() => onFinance(project.id)}
                    >
                      {formatCents(project.outstanding_cents)}
                    </button>
                  ),
                },
              ]}
            />
            {!rows.length && <p>暂无符合条件的项目。</p>}
            <p>待收款包括未到期合同余额。发票、收入和工时需要对应业务数据后才能统计。</p>
          </section>
        </>
      )}
    </main>
  );
}
