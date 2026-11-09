import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  invalidateOrdinaryCatalog,
  invalidateProjectCatalog,
  useOrdinaryCatalog,
} from '../../shared/data/ordinary-catalog-query';
import ReadTable from '../../shared/ui/ReadTable';
import { useState, useRef, useEffect, type FormEvent } from 'react';
import FinanceSettings from './FinanceSettings';
import ProjectFinancePanel from './ProjectFinancePanel';
import {
  useFinanceManagement,
  financeManagementKey,
  type FinanceManagementController,
} from './useFinanceManagement';
import { createPortal } from 'react-dom';
import InspectorLayout from '../../ui/InspectorLayout';
import SidebarAgent from '../../ui/SidebarAgent';
import AgentPanel from '../../ui/AgentPanel';
import type { FinanceRequest, FinanceResponse, Matter } from '../../../preload/caselite-api';
import { formatCents, parseCents } from './money';

type Detail = Extract<FinanceResponse, { kind: 'ledger' }>;
type Write = Exclude<FinanceRequest, { operation: 'read' | 'status' }>;
import type { Draft } from './types';

function matchesEvidence(result: Detail, request: Write, evidence: Detail['evidence']) {
  const ledger = result.ledger;
  if (!ledger || !evidence || evidence.operation !== request.operation) return false;
  if (request.operation === 'register_contract') {
    const expected = [...request.installments].sort((a, b) => a.due_date.localeCompare(b.due_date));
    return (
      evidence.target_id === request.project_id &&
      ledger.number === request.number.trim() &&
      ledger.amount_cents === request.amount_cents &&
      ledger.installments.length === expected.length &&
      ledger.installments.every(
        (row, index) =>
          row.due_date === expected[index].due_date &&
          row.amount_cents === expected[index].amount_cents,
      )
    );
  }
  const payment = ledger.payments.find((row) => row.id === evidence.target_id);
  if (request.operation === 'record_payment')
    return (
      payment?.installment_id === request.installment_id &&
      payment.amount_cents === request.amount_cents
    );
  return payment?.id === request.payment_id && Boolean(payment.reversed_at);
}

const blank = () => ({ id: crypto.randomUUID(), amount: '', date: '' });

function ContractForm({
  disabled,
  submit,
  onEdit,
}: {
  disabled: boolean;
  submit(draft: Draft): void;
  onEdit(): void;
}) {
  const [rows, setRows] = useState(() => [blank()]);
  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    submit({
      operation: 'register_contract',
      number: String(fields.get('number')),
      amount_cents: parseCents(String(fields.get('amount'))),
      installments: rows.map((row) => ({
        amount_cents: parseCents(row.amount),
        due_date: row.date,
      })),
    });
  }
  return (
    <form onSubmit={register} onChange={onEdit}>
      <fieldset disabled={disabled}>
        <legend>登记有效收费合同</legend>
        <label>
          合同编号
          <input name="number" required maxLength={120} />
        </label>
        <label>
          合同金额（元）
          <input name="amount" inputMode="decimal" required />
        </label>
        {rows.map((row, index) => (
          <div key={row.id} className="finance-fields">
            <label>
              第 {index + 1} 期金额（元）
              <input
                inputMode="decimal"
                required
                value={row.amount}
                onChange={(e) =>
                  setRows(
                    rows.map((item) =>
                      item.id === row.id ? { ...item, amount: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              第 {index + 1} 期到期日
              <input
                type="date"
                required
                value={row.date}
                onChange={(e) =>
                  setRows(
                    rows.map((item) =>
                      item.id === row.id ? { ...item, date: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  onEdit();
                  setRows(rows.filter((item) => item.id !== row.id));
                }}
              >
                移除第 {index + 1} 期
              </button>
            )}
          </div>
        ))}
        <div className="finance-fields">
          <button
            type="button"
            disabled={rows.length === 100}
            onClick={() => {
              onEdit();
              setRows([...rows, blank()]);
            }}
          >
            添加分期
          </button>
          <button className="primary">确认登记合同</button>
        </div>
      </fieldset>
    </form>
  );
}

function ProjectLedger({
  project,
  onBlocked,
  finance,
  propertySlot,
}: {
  project: Matter;
  finance: FinanceManagementController;
  propertySlot: HTMLDivElement | null;
  onBlocked(blocked: boolean): void;
}) {
  const client = useQueryClient();
  const [entry, setEntry] = useState(true);
  const [message, setMessage] = useState('');
  const [writeError, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Write>();
  const [canRetry, setCanRetry] = useState(false);
  const [reverse, setReverse] = useState<string>();
  const [formRevision, setFormRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef(false);
  const projectId = project.id;

  const queryKey = ['finance', 'ledger', projectId] as const;
  const read = useQuery({
    queryKey,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const result = await window.caselite
        .finance({
          protocol_version: 1,
          operation: 'read',
          project_id: projectId,
        })
        .catch(() => {
          throw new Error('无法读取项目账本，请重试。');
        });
      if (!result.ok) throw new Error(result.message);
      if (result.kind !== 'ledger' || result.project_id !== projectId) {
        throw new Error('返回的账本不属于当前项目。');
      }
      return result;
    },
  });
  const detail = read.data;
  const error = writeError || read.error?.message || '';

  function edit() {
    setDirty(true);
    onBlocked(true);
  }

  function discardDraft() {
    finance.discard();
    setEntry(false);
    setFormRevision((value) => value + 1);
    setDirty(false);
    setReverse(undefined);
    setError('');
    setMessage('');
    onBlocked(false);
  }

  function accept(result: Detail) {
    setEntry(false);
    void client.invalidateQueries({ queryKey: financeManagementKey });
    void invalidateOrdinaryCatalog(client, true, true);
    void invalidateProjectCatalog(client);
    // 只用已经核对项目、原提交身份及账本证据的回执更新读取缓存。
    void client.cancelQueries({ queryKey, exact: true });
    client.setQueryData<Detail>(queryKey, result);
    setReverse(undefined);
    setFormRevision((value) => value + 1);
    setDirty(false);
    onBlocked(false);
    setMessage('已保存并读回账本。');
  }

  async function process(request: Write, checkOnly = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    onBlocked(true);
    setBusy(true);
    setCanRetry(false);
    setPending(request);
    setError('');
    setMessage('');
    let resolved = false;
    try {
      if (checkOnly) {
        const result = await window.caselite.finance({
          operation: 'status',
          protocol_version: 1,
          project_id: projectId,
          idempotency_key: request.idempotency_key,
        });
        if (
          !result.ok ||
          result.kind !== 'status' ||
          result.project_id !== projectId ||
          result.receipt !== request.idempotency_key
        ) {
          setError(result.ok ? '返回的提交核对结果不匹配。' : result.message);
          return;
        }
        if (!result.evidence) {
          setMessage('暂未查到原提交。可用原金额和同一提交身份重试。');
          setCanRetry(true);
          return;
        }
        const proof = result.evidence;
        const read = await window.caselite.finance({
          operation: 'read',
          protocol_version: 1,
          project_id: projectId,
        });
        if (!read.ok || read.kind !== 'ledger' || read.project_id !== projectId || !read.ledger) {
          setError('已查到提交凭据，账本读回失败，请再次核对。');
          return;
        }
        if (!matchesEvidence(read, request, proof)) {
          setError('提交凭据与原操作不匹配，请保留原提交并核对。');
          return;
        }
        accept(read);
        resolved = true;
        return;
      }
      const result = await window.caselite.finance({ ...request, request_id: crypto.randomUUID() });
      if (!result.ok) {
        resolved = result.code !== 'RESULT_UNKNOWN' && result.code !== 'UNAVAILABLE';
        setError(result.message);
      } else if (
        result.kind === 'ledger' &&
        result.project_id === projectId &&
        result.receipt === request.idempotency_key &&
        matchesEvidence(result, request, result.evidence)
      ) {
        accept(result);
        resolved = true;
      } else {
        setError('无法确认账本回执，请先核对原提交。');
      }
    } catch {
      setError('无法确认账本回执，请先核对原提交。');
    } finally {
      if (resolved) {
        setPending(undefined);
        if (!dirty && !reverse) onBlocked(false);
      }
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submit(draft: Draft) {
    if (pending) return;
    void process({
      ...draft,
      protocol_version: 1,
      project_id: projectId,
      request_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
    });
  }

  const ledger = detail?.ledger;
  return (
    <section aria-label="项目财务明细">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">正在核对账本…</p>}
      {dirty && !pending && (
        <p>
          有未提交的财务输入。保存或放弃输入后可以切换项目。
          <button type="button" onClick={discardDraft}>
            放弃当前输入
          </button>
        </p>
      )}
      {pending && !busy && (
        <button type="button" onClick={() => void process(pending, !canRetry)}>
          {canRetry ? '重试原提交' : '核对原提交'}
        </button>
      )}
      {!detail &&
        (error ? (
          <button
            type="button"
            onClick={() => {
              setError('');
              void read.refetch();
            }}
          >
            重新读取账本
          </button>
        ) : (
          <p role="status">正在读取账本…</p>
        ))}
      {detail && (
        <>
          <details className="finance-ledger-help">
            <summary>人民币 · 账本说明</summary>
            <p>
              币种为人民币。到期按本机时区 {detail.time_zone} 的自然日计算，包含当日（{detail.today}
              ）。
            </p>
            <p>若曾在回执未确认时退出，请先查看账本及收款记录，核对原操作是否已登记。</p>
          </details>
          {project.archived_at && <p>此项目已归档，账本只读。</p>}
          {ledger ? (
            <>
              <ProjectFinancePanel
                key={formRevision}
                project={project}
                ledger={ledger}
                today={detail.today}
                finance={finance}
                disabled={!!pending || busy || !!reverse || finance.busy || !!finance.pending}
                onEdit={edit}
                submit={submit}
                reverse={(id) => {
                  setReverse(id);
                  onBlocked(true);
                }}
                entry={entry}
                setEntry={setEntry}
                propertySlot={propertySlot}
              />
              {reverse && (
                <div className="finance-preview">
                  <p>确认更正原收款登记；如已关联分配，需先核对相关到账和分配。</p>
                  <button
                    disabled={!!pending}
                    onClick={() => submit({ operation: 'reverse_payment', payment_id: reverse })}
                  >
                    确认冲回原收款
                  </button>
                  <button
                    disabled={!!pending}
                    onClick={() => {
                      setReverse(undefined);
                      if (!dirty) onBlocked(false);
                    }}
                  >
                    取消冲回
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <p>待收款（元） — · 此项目尚未建账</p>
              {!project.archived_at &&
                (propertySlot ? (
                  createPortal(
                    <ContractForm
                      key={formRevision}
                      disabled={!!pending}
                      submit={submit}
                      onEdit={edit}
                    />,
                    propertySlot,
                  )
                ) : (
                  <ContractForm
                    key={formRevision}
                    disabled={!!pending}
                    submit={submit}
                    onEdit={edit}
                  />
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

export default function FinanceView({
  initialProject,
  onDirty,
}: {
  initialProject: string;
  onDirty(blocked: boolean): void;
}) {
  const read = useOrdinaryCatalog();
  const projects = read.data?.projects;
  const [selected, setSelected] = useState(initialProject);
  const [opened, setOpened] = useState(Boolean(initialProject));
  const [search, setSearch] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState('all');
  const [blocked, setBlocked] = useState(false);
  const [settings, setSettings] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [propertySlot, setPropertySlot] = useState<HTMLDivElement | null>(null);
  const finance = useFinanceManagement();
  const isBlocked = blocked || finance.blocked;
  useEffect(() => {
    onDirty(isBlocked);
  }, [isBlocked, onDirty]);
  const project = projects?.find((item) => item.id === selected);
  const matches = (projects ?? []).filter(
    (item) =>
      item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
      (ledgerFilter === 'all' ||
        (item.outstanding_cents != null) === (ledgerFilter === 'registered')),
  );
  const registered = matches.filter((item) => item.outstanding_cents != null);
  const outstanding = registered.reduce(
    (sum, item) => sum + BigInt(item.outstanding_cents ?? 0),
    0n,
  );
  const allocations =
    finance.state?.allocations.filter(
      (row) => !row.reversed_at && matches.some((project) => project.id === row.project_id),
    ) ?? [];
  const payouts =
    finance.state?.payouts.filter(
      (row) => !row.reversed_at && matches.some((project) => project.id === row.project_id),
    ) ?? [];
  const payable = allocations.reduce((sum, row) => sum + BigInt(row.payable_cents), 0n);
  const paid = payouts.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n);
  const received = finance.state?.projects
    .filter((row) => matches.some((item) => item.id === row.project_id))
    .reduce((sum, row) => sum + BigInt(row.received_cents), 0n);
  const openProject = (id: string) => {
    if (isBlocked) return;
    setSelected(id);
    setOpened(true);
    setSettings(false);
  };
  return (
    <section
      className="collection-workspace catalog-view finance-workspace"
      data-layout="three-column"
      aria-label="财务工作区"
    >
      <div className="collection-main finance-main">
        <header className="collection-heading finance-workbench-heading">
          {opened && (
            <button disabled={isBlocked} onClick={() => setOpened(false)}>
              ← 财务一览
            </button>
          )}
          <h1>{opened && project ? project.title : '财务'}</h1>
          <button disabled={isBlocked} onClick={() => setSettings((value) => !value)}>
            {settings ? '关闭财务设置' : '财务设置'}
          </button>
          <button
            disabled={isBlocked || read.isFetching}
            onClick={() => void read.load().catch(() => {})}
          >
            刷新项目
          </button>
        </header>
        <div className="finance-main-scroll">
          {finance.error && (
            <p role="alert">
              {finance.error}{' '}
              <button disabled={finance.busy} onClick={() => void finance.reload()}>
                重新读取财务设置
              </button>
            </p>
          )}
          {finance.message && <p role="status">{finance.message}</p>}
          {finance.pending && !finance.busy && (
            <button onClick={() => void finance.recover()}>
              {finance.retry ? '重试原财务提交' : '核对原财务提交'}
            </button>
          )}
          {finance.dirty && !finance.pending && !blocked && (
            <p>
              有未保存的财务输入。
              <button
                onClick={() => {
                  finance.discard();
                  setDraftRevision((value) => value + 1);
                  setSettings(false);
                }}
              >
                放弃未保存的财务输入
              </button>
            </p>
          )}
          {read.error && (
            <p role="alert">
              {read.error}
              <button onClick={() => void read.load()}>重新读取项目</button>
            </p>
          )}
          {!projects && !read.error && <p>正在读取项目…</p>}
          {projects?.length === 0 && <p>请先在「项目」创建项目，再登记合同或款项。</p>}
          <div hidden={opened}>
            <dl className="finance-result-cards finance-summary" aria-label="筛选结果总览">
              <div>
                <dt>客户待收</dt>
                <dd>{formatCents(registered.length ? outstanding : null)}</dd>
                <small>
                  匹配项目 {matches.length} · 已建账 {registered.length}
                </small>
              </div>
              <div>
                <dt>客户已付</dt>
                <dd>{received === undefined ? '—' : formatCents(received)}</dd>
                <small>已确认有效回款</small>
              </div>
              <div>
                <dt>我的待结算</dt>
                <dd>
                  {finance.state && allocations.length ? formatCents(payable - paid) : '待核对'}
                </dd>
                <small>按已确认分配累计</small>
              </div>
              <div>
                <dt>我的已到账</dt>
                <dd>{finance.state ? formatCents(paid) : '—'}</dd>
                <small>报销另列</small>
              </div>
            </dl>
            <div className="finance-filters">
              <label>
                搜索财务项目
                <input
                  type="search"
                  aria-label="搜索财务项目"
                  placeholder="项目名称…"
                  value={search}
                  disabled={isBlocked}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                建账状态
                <select
                  value={ledgerFilter}
                  disabled={isBlocked}
                  onChange={(event) => setLedgerFilter(event.target.value)}
                >
                  <option value="all">全部</option>
                  <option value="registered">已建账</option>
                  <option value="unregistered">未建账</option>
                </select>
              </label>
              <button
                disabled={isBlocked || (!search && ledgerFilter === 'all')}
                onClick={() => {
                  setSearch('');
                  setLedgerFilter('all');
                }}
              >
                清除筛选
              </button>
            </div>
            <ReadTable
              data={matches}
              getRowId={(item) => item.id}
              label="财务项目列表"
              rowProps={(item) => ({
                'aria-selected': selected === item.id,
                onClick: () => {
                  if (!isBlocked) setSelected(item.id);
                },
              })}
              columns={[
                {
                  id: 'project',
                  header: '项目',
                  cell: ({ row: { original: item } }) => (
                    <button
                      disabled={isBlocked}
                      onClick={(event) => {
                        event.stopPropagation();
                        openProject(item.id);
                      }}
                    >
                      {item.title} →
                    </button>
                  ),
                },
                {
                  id: 'status',
                  header: '状态',
                  accessorFn: (item) => (item.archived_at ? '已归档' : '在用'),
                },
                {
                  id: 'received',
                  header: '客户已付（元）',
                  accessorFn: (item) =>
                    formatCents(
                      finance.state?.projects.find((row) => row.project_id === item.id)
                        ?.received_cents,
                    ),
                },
                {
                  id: 'outstanding',
                  header: '客户待收（元）',
                  accessorFn: (item) => formatCents(item.outstanding_cents),
                },
                {
                  id: 'mine',
                  header: '我的待结算',
                  accessorFn: (item) => {
                    const own = allocations.filter((row) => row.project_id === item.id);
                    if (!own.length) return '待核对';
                    return formatCents(
                      own.reduce((sum, row) => sum + BigInt(row.payable_cents), 0n) -
                        payouts
                          .filter((row) => row.project_id === item.id)
                          .reduce((sum, row) => sum + BigInt(row.amount_cents), 0n),
                    );
                  },
                },
                {
                  id: 'paid',
                  header: '我的已到账',
                  accessorFn: (item) =>
                    finance.state
                      ? formatCents(
                          payouts
                            .filter((row) => row.project_id === item.id)
                            .reduce((sum, row) => sum + BigInt(row.amount_cents), 0n),
                        )
                      : '—',
                },
              ]}
            />
            {matches.length === 0 && projects && <p>没有符合筛选条件的项目。</p>}
          </div>
          {opened && project && (
            <ProjectLedger
              key={`${project.id}:${draftRevision}`}
              project={project}
              finance={finance}
              propertySlot={propertySlot}
              onBlocked={setBlocked}
            />
          )}
        </div>
      </div>
      <aside className="project-properties finance-sidebar" aria-label="财务辅助栏">
        <InspectorLayout
          blocked={finance.busy}
          properties={
            <div className="finance-sidebar-properties">
              {settings ? (
                finance.state ? (
                  <FinanceSettings
                    key={`${draftRevision}:${finance.state.version}`}
                    finance={finance}
                  />
                ) : (
                  <p>正在读取财务设置…</p>
                )
              ) : (
                <>
                  <h2>{opened ? '记一笔' : '属性'}</h2>
                  {project ? (
                    <>
                      <h3>{project.title}</h3>
                      {!opened && (
                        <>
                          <dl className="finance-properties">
                            <div>
                              <dt>状态</dt>
                              <dd>{project.archived_at ? '已归档' : '进行中'}</dd>
                            </div>
                            <div>
                              <dt>客户待收</dt>
                              <dd>{formatCents(project.outstanding_cents)} 元</dd>
                            </div>
                            <div>
                              <dt>结算规则</dt>
                              <dd>
                                {finance.state?.rules.find(
                                  (rule) =>
                                    rule.id ===
                                    finance.state?.bindings.find(
                                      (row) => row.project_id === project.id,
                                    )?.rule_id,
                                )?.name ?? '尚未选择'}
                              </dd>
                            </div>
                          </dl>
                          <button disabled={isBlocked} onClick={() => openProject(project.id)}>
                            打开项目 →
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="finance-muted">
                      选择左侧项目查看属性，点击项目名称打开收付明细。
                    </p>
                  )}
                </>
              )}
              <div ref={setPropertySlot} hidden={settings || !opened} />
            </div>
          }
        >
          {project ? (
            <SidebarAgent
              project={{
                id: project.id,
                version: project.version,
                archived: !!project.archived_at,
              }}
              blocked={false}
            />
          ) : (
            <AgentPanel scope="home" variant="compact" />
          )}
        </InspectorLayout>
      </aside>
    </section>
  );
}
