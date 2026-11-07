import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { FinanceRequest, FinanceResponse, Matter } from '../../preload/caselite-api';
import { formatCents, parseCents } from './money';

type Detail = Extract<FinanceResponse, { kind: 'ledger' }>;
type Write = Exclude<FinanceRequest, { operation: 'read' | 'status' }>;
type Draft =
  | Omit<
      Extract<Write, { operation: 'register_contract' }>,
      'protocol_version' | 'project_id' | 'request_id' | 'idempotency_key'
    >
  | { operation: 'record_payment'; installment_id: string; amount_cents: number }
  | { operation: 'reverse_payment'; payment_id: string };

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
}: {
  project: Matter;
  onBlocked(blocked: boolean): void;
}) {
  const [detail, setDetail] = useState<Detail>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Write>();
  const [canRetry, setCanRetry] = useState(false);
  const [reverse, setReverse] = useState<string>();
  const [formRevision, setFormRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const inFlight = useRef(false);
  const projectId = project.id;

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(async () => {
      try {
        const result = await window.caselite.finance({
          protocol_version: 1,
          operation: 'read',
          project_id: projectId,
        });
        if (!current) return;
        if (result.ok && result.kind === 'ledger' && result.project_id === projectId) {
          setDetail(result);
          return;
        }
        setError(result.ok ? '返回的账本不属于当前项目。' : result.message);
      } catch {
        if (current) setError('无法读取项目账本，请重试。');
      }
    });
    return () => {
      current = false;
    };
  }, [projectId, reload]);

  function edit() {
    setDirty(true);
    onBlocked(true);
  }

  function discardDraft() {
    setFormRevision((value) => value + 1);
    setDirty(false);
    setReverse(undefined);
    setError('');
    setMessage('');
    onBlocked(false);
  }

  function accept(result: Detail) {
    setDetail(result);
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
      <h2>{project.title}</h2>
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
              setReload(reload + 1);
            }}
          >
            重新读取账本
          </button>
        ) : (
          <p role="status">正在读取账本…</p>
        ))}
      {detail && (
        <>
          <p>
            币种为人民币。到期按本机时区 {detail.time_zone} 的自然日计算，包含当日（{detail.today}
            ）。
          </p>
          <p>若曾在回执未确认时退出，请先查看账本及收款记录，核对原操作是否已登记。</p>
          {project.archived_at && <p>此项目已归档，账本只读。</p>}
          {ledger ? (
            <>
              <dl className="finance-summary">
                <div>
                  <dt>合同编号</dt>
                  <dd>{ledger.number}</dd>
                </div>
                <div>
                  <dt>合同金额（元）</dt>
                  <dd>{formatCents(ledger.amount_cents)}</dd>
                </div>
                <div>
                  <dt>待收款（元）</dt>
                  <dd data-testid="finance-outstanding">{formatCents(ledger.outstanding_cents)}</dd>
                </div>
                <div>
                  <dt>已到期未收（元）</dt>
                  <dd data-testid="finance-due">{formatCents(ledger.due_cents)}</dd>
                </div>
              </dl>
              <h3>合同分期</h3>
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th>期款</th>
                    <th>到期日</th>
                    <th>约定（元）</th>
                    <th>未收（元）</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.installments.map((row, index) => (
                    <tr key={row.id}>
                      <td>第 {index + 1} 期</td>
                      <td>{row.due_date}</td>
                      <td>{formatCents(row.amount_cents)}</td>
                      <td>{formatCents(row.outstanding_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!project.archived_at && ledger.outstanding_cents > 0 && (
                <form
                  key={formRevision}
                  onChange={edit}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const fields = new FormData(event.currentTarget);
                    submit({
                      operation: 'record_payment',
                      installment_id: String(fields.get('installment')),
                      amount_cents: parseCents(String(fields.get('amount'))),
                    });
                  }}
                >
                  <fieldset disabled={!!pending || !!reverse}>
                    <legend>登记律所已确认收款</legend>
                    <label>
                      分配到期款
                      <select name="installment" required defaultValue="">
                        <option value="" disabled>
                          选择期款
                        </option>
                        {ledger.installments.map(
                          (row, index) =>
                            row.outstanding_cents > 0 && (
                              <option key={row.id} value={row.id}>
                                第 {index + 1} 期 · {row.due_date}
                              </option>
                            ),
                        )}
                      </select>
                    </label>
                    <label>
                      收款金额（元）
                      <input name="amount" inputMode="decimal" required />
                    </label>
                    <button className="primary">确认登记收款</button>
                  </fieldset>
                </form>
              )}
              <h3>收款与冲回记录</h3>
              {ledger.payments.length === 0 && <p>暂无确认收款。</p>}
              <ul className="finance-payments">
                {ledger.payments.map((payment) => (
                  <li key={payment.id}>
                    <span>
                      第{' '}
                      {ledger.installments.findIndex((row) => row.id === payment.installment_id) +
                        1}{' '}
                      期 · {formatCents(payment.amount_cents)} 元
                    </span>
                    <time dateTime={payment.committed_at}>
                      {new Date(payment.committed_at).toLocaleString()}
                    </time>
                    {payment.reversed_at ? (
                      <span>
                        已冲回 ·{' '}
                        <time dateTime={payment.reversed_at}>
                          {new Date(payment.reversed_at).toLocaleString()}
                        </time>
                      </span>
                    ) : (
                      !project.archived_at &&
                      (reverse === payment.id ? (
                        <div className="finance-fields">
                          <button
                            type="button"
                            disabled={!!pending}
                            onClick={() =>
                              submit({ operation: 'reverse_payment', payment_id: payment.id })
                            }
                          >
                            确认冲回原收款
                          </button>
                          <button
                            type="button"
                            disabled={!!pending}
                            onClick={() => {
                              setReverse(undefined);
                              if (!dirty) onBlocked(false);
                            }}
                          >
                            取消冲回
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!!pending || !!reverse || dirty}
                          onClick={() => {
                            setReverse(payment.id);
                            onBlocked(true);
                          }}
                        >
                          冲回这笔收款
                        </button>
                      ))
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p>待收款（元） — · 此项目尚未建账</p>
              {!project.archived_at && (
                <ContractForm
                  key={formRevision}
                  disabled={!!pending}
                  submit={submit}
                  onEdit={edit}
                />
              )}
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
  const [projects, setProjects] = useState<Matter[]>();
  const [selected, setSelected] = useState(initialProject);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(async () => {
      try {
        const result = await window.caselite.catalog({ protocol_version: 1, operation: 'list' });
        if (!current) return;
        if (result.ok) setProjects(result.projects);
        else setError(result.message);
      } catch {
        if (current) setError('无法读取项目，请重试。');
      }
    });
    return () => {
      current = false;
    };
  }, [reload]);
  const project = projects?.find((item) => item.id === selected);
  return (
    <section className="workspace-placeholder finance-view">
      <h1>财务</h1>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            onClick={() => {
              setError('');
              setReload(reload + 1);
            }}
          >
            重新读取项目
          </button>
        </p>
      )}
      {!projects && !error && <p role="status">正在读取项目…</p>}
      {projects?.length === 0 && <p>请先在「项目」创建一个项目。</p>}
      {!!projects?.length && (
        <label>
          选择项目
          <select
            value={project?.id ?? ''}
            disabled={blocked}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">请选择</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
                {item.archived_at ? '（已归档）' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {project && (
        <ProjectLedger
          key={project.id}
          project={project}
          onBlocked={(value) => {
            setBlocked(value);
            onDirty(value);
          }}
        />
      )}
    </section>
  );
}
