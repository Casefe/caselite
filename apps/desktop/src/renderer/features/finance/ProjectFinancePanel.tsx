import { Fragment, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FinanceResponse, Matter } from '../../../preload/caselite-api';
import type { Draft, ContractSeed } from './types';
import type { FinanceManagementController } from './useFinanceManagement';
import { formatCents } from './money';
import FinanceEntry from './FinanceEntry';
import FinanceRuleBinding from './FinanceRuleBinding';
import FinanceExpenses from './FinanceExpenses';
import { FinanceSourceNote } from './FinanceIntake';
type Ledger = NonNullable<Extract<FinanceResponse, { kind: 'ledger' }>['ledger']>;
export default function ProjectFinancePanel({
  project,
  ledger: storedLedger,
  contractForm,
  onIntakeBusy,
  entryDirty,
  entryRevision,
  onEntrySaved,
  today,
  finance,
  disabled: actionDisabled,
  onEdit,
  submit,
  reverse,
  entry,
  setEntry,
  propertySlot,
}: {
  project: Matter;
  ledger: Ledger | null;
  contractForm?: (seed: ContractSeed) => ReactNode;
  onIntakeBusy(value: boolean): void;
  entryDirty: boolean;
  entryRevision: number;
  onEntrySaved(): void;
  today: string;
  finance: FinanceManagementController;
  disabled: boolean;
  onEdit(): void;
  submit(draft: Draft): void;
  reverse(id: string): void;
  entry: boolean;
  setEntry(value: boolean): void;
  propertySlot: HTMLDivElement | null;
}) {
  const [expanded, setExpanded] = useState<string>();
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [intent, setIntent] = useState<{
    kind: 'allocation' | 'reimbursement';
    id: string;
    revision: number;
    sequence: number;
  }>();
  const disabled = actionDisabled || !!project.archived_at || intakeBusy;
  const rowDisabled = disabled || entryDirty || finance.dirty;
  const hasContract = !!storedLedger;
  const ledger: Ledger = storedLedger ?? {
    number: '',
    amount_cents: 0,
    outstanding_cents: 0,
    due_cents: 0,
    installments: [],
    payments: [],
  };
  const state = finance.state;
  const activePayments = ledger.payments.filter((row) => !row.reversed_at);
  const allocations =
    state?.allocations.filter((row) => row.project_id === project.id && !row.reversed_at) ?? [];
  const payouts =
    state?.payouts.filter((row) => row.project_id === project.id && !row.reversed_at) ?? [];
  const totalPaid = payouts.reduce((sum, row) => sum + row.amount_cents, 0);
  const totalPayable = allocations.reduce((sum, row) => sum + row.payable_cents, 0);
  const unallocated =
    activePayments.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n) -
    allocations.reduce((sum, row) => sum + BigInt(row.base_cents), 0n);
  const tools = (
    <>
      <FinanceRuleBinding project={project} finance={finance} disabled={disabled} />
      <FinanceEntry
        key={`${entryRevision}:${intent?.sequence ?? 0}`}
        intent={
          intent?.revision === entryRevision ? { id: intent.id, kind: intent.kind } : undefined
        }
        project={project}
        ledger={storedLedger}
        contractForm={contractForm}
        finance={finance}
        disabled={actionDisabled}
        onEdit={onEdit}
        submit={submit}
        entry={entry}
        setEntry={setEntry}
        onEntrySaved={onEntrySaved}
        onIntakeBusy={(value) => {
          setIntakeBusy(value);
          onIntakeBusy(value);
        }}
      />
    </>
  );
  return (
    <>
      {hasContract ? (
        <>
          <div className="finance-section-heading">
            <div>
              <h2>项目收付明细</h2>
              <span className="finance-muted">
                合同 {ledger.number} · {formatCents(ledger.amount_cents)} 元
              </span>
            </div>
            <button
              className="primary"
              disabled={disabled}
              onClick={() => {
                setEntry(true);
              }}
            >
              记一笔
            </button>
          </div>
          <dl className="finance-summary finance-result-cards">
            <div>
              <dt>客户待收</dt>
              <dd data-testid="finance-outstanding">{formatCents(ledger.outstanding_cents)}</dd>
              <small>
                到期未收 <span data-testid="finance-due">{formatCents(ledger.due_cents)}</span>
              </small>
            </div>
            <div>
              <dt>客户已付</dt>
              <dd>{formatCents(ledger.amount_cents - ledger.outstanding_cents)}</dd>
            </div>
            <div>
              <dt>我的待结算</dt>
              <dd>
                {state && (allocations.length || !activePayments.length)
                  ? formatCents(totalPayable - totalPaid)
                  : '待核对'}
              </dd>
              {state && unallocated > 0n && (
                <small>另有 {formatCents(unallocated)} 元回款待核定分配</small>
              )}
            </div>
            <div>
              <dt>我的已到账</dt>
              <dd>{state ? formatCents(totalPaid) : '—'}</dd>
            </div>
          </dl>
          <div className="finance-table-scroll">
            <table aria-label="项目收付明细">
              <thead>
                <tr>
                  <th>收费事项 / 到期</th>
                  <th>约定金额</th>
                  <th>客户已付</th>
                  <th>客户待收</th>
                  <th>律所应留</th>
                  <th>我的待结算</th>
                </tr>
              </thead>
              <tbody>
                {ledger.installments.map((row, index) => {
                  const parts = allocations.filter((item) => item.installment_id === row.id);
                  const ownPayouts = payouts.filter((paid) =>
                    parts.some((part) => part.id === paid.allocation_id),
                  );
                  const ownPaid = ownPayouts.reduce((sum, item) => sum + item.amount_cents, 0);
                  const share = parts.reduce((sum, item) => sum + item.lawyer_cents, 0);
                  const payable = parts.reduce((sum, item) => sum + item.payable_cents, 0);
                  const payments = ledger.payments.filter((item) => item.installment_id === row.id);
                  const known = payments
                    .filter((item) => !item.reversed_at)
                    .every((item) => parts.some((part) => part.payment_id === item.id));
                  return (
                    <Fragment key={row.id}>
                      <tr>
                        <td>
                          <button
                            aria-expanded={expanded === row.id}
                            onClick={() => setExpanded(expanded === row.id ? undefined : row.id)}
                          >
                            第 {index + 1} 期律师费 {expanded === row.id ? '⌃' : '⌄'}
                          </button>
                          <small>
                            {row.due_date} ·{' '}
                            {row.outstanding_cents === 0
                              ? '已收齐'
                              : row.due_date <= today
                                ? '已到期'
                                : '未到期'}
                          </small>
                          <small>
                            {!state
                              ? '开票待核对'
                              : !state.invoices.some((item) => item.installment_id === row.id)
                                ? '未开票'
                                : `开票净额 ${formatCents(state.invoices.filter((item) => item.installment_id === row.id).reduce((sum, item) => sum + (item.kind === 'red_invoice' ? -item.amount_cents : item.amount_cents), 0))} 元`}
                          </small>
                        </td>
                        <td>{formatCents(row.amount_cents)}</td>
                        <td>{formatCents(row.amount_cents - row.outstanding_cents)}</td>
                        <td>{formatCents(row.outstanding_cents)}</td>
                        <td>
                          {known
                            ? formatCents(parts.reduce((sum, item) => sum + item.firm_cents, 0))
                            : '待核对'}
                        </td>
                        <td>
                          {known ? formatCents(payable - ownPaid) : '待核对'}
                          <small>已到账 {formatCents(ownPaid)}</small>
                        </td>
                      </tr>
                      {expanded === row.id && (
                        <tr className="finance-expanded-row">
                          <td colSpan={6}>
                            <div>
                              <h4>
                                本期收付与结算 · 我的应分 {known ? formatCents(share) : '待核对'} 元
                              </h4>
                              {state?.invoices
                                .filter((item) => item.installment_id === row.id)
                                .map((item) => (
                                  <div className="finance-flow" key={item.id}>
                                    <span>
                                      {item.kind === 'red_invoice' ? '红字发票' : '已开发票'}{' '}
                                      {formatCents(item.amount_cents)} 元 · {item.invoice_number} ·{' '}
                                      {item.occurred_on}
                                    </span>
                                    <FinanceSourceNote targetId={item.id} finance={finance} />
                                    {item.kind === 'red_invoice' && (
                                      <small>
                                        对应原发票{' '}
                                        {
                                          state.invoices.find(
                                            (original) => original.id === item.original_invoice_id,
                                          )?.invoice_number
                                        }
                                      </small>
                                    )}
                                  </div>
                                ))}
                              {payments.length === 0 ? (
                                <p>暂无实际回款。</p>
                              ) : (
                                payments.map((payment) => {
                                  const part = parts.find((item) => item.payment_id === payment.id);
                                  const partPaid = ownPayouts.filter(
                                    (item) => item.allocation_id === part?.id,
                                  );
                                  return (
                                    <div className="finance-flow" key={payment.id}>
                                      <strong>
                                        客户回款 {formatCents(payment.amount_cents)} 元
                                      </strong>
                                      <time>
                                        {payment.occurred_on ??
                                          `登记于 ${new Date(payment.committed_at).toLocaleString()}`}
                                      </time>
                                      <FinanceSourceNote targetId={payment.id} finance={finance} />
                                      {payment.reversed_at ? (
                                        <span>已冲回</span>
                                      ) : (
                                        <>
                                          <span>
                                            {part
                                              ? `律所 ${formatCents(part.firm_cents)} / 我的应分 ${formatCents(part.lawyer_cents)}`
                                              : '尚未核定分成'}
                                          </span>
                                          {partPaid.map((paid) => (
                                            <div key={paid.id}>
                                              律所 → 我：{formatCents(paid.amount_cents)} 元 ·{' '}
                                              {paid.occurred_on}
                                              <FinanceSourceNote
                                                targetId={paid.id}
                                                finance={finance}
                                              />
                                              <button
                                                disabled={rowDisabled}
                                                onClick={() =>
                                                  void finance.submit({
                                                    operation: 'm_reverse_payout',
                                                    project_id: project.id,
                                                    payout_id: paid.id,
                                                    note: '用户确认更正原到账登记，不代表真实退款',
                                                  })
                                                }
                                              >
                                                冲回到账登记
                                              </button>
                                            </div>
                                          ))}
                                          {!project.archived_at && (
                                            <div className="finance-fields">
                                              {part ? (
                                                <button
                                                  disabled={rowDisabled}
                                                  onClick={() =>
                                                    void finance.submit({
                                                      operation: 'm_reverse_allocation',
                                                      project_id: project.id,
                                                      allocation_id: part.id,
                                                      note: '用户确认更正分配',
                                                    })
                                                  }
                                                >
                                                  冲回本次分配
                                                </button>
                                              ) : (
                                                <button
                                                  disabled={rowDisabled}
                                                  onClick={() => {
                                                    setIntent({
                                                      kind: 'allocation',
                                                      id: payment.id,
                                                      revision: entryRevision,
                                                      sequence: (intent?.sequence ?? 0) + 1,
                                                    });
                                                    setEntry(true);
                                                  }}
                                                >
                                                  核对分配
                                                </button>
                                              )}
                                              <button
                                                disabled={rowDisabled}
                                                onClick={() => reverse(payment.id)}
                                              >
                                                冲回这笔收款
                                              </button>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="finance-section-heading">
            <h2>项目收付明细</h2>
            <button disabled={disabled} onClick={() => setEntry(true)}>
              记一笔
            </button>
          </div>
          <p className="finance-muted">尚未登记收费约定，可先记录支出与报销。</p>
        </>
      )}
      <FinanceSourceNote targetId={project.id} finance={finance} />
      <FinanceExpenses
        projectId={project.id}
        finance={finance}
        disabled={rowDisabled}
        onRecord={(id) => {
          setIntent({
            kind: 'reimbursement',
            id,
            revision: entryRevision,
            sequence: (intent?.sequence ?? 0) + 1,
          });
          setEntry(true);
        }}
      />
      <details className="finance-all-records">
        <summary>全部收款与更正记录（{ledger.payments.length}笔）</summary>
        <ul className="finance-payments">
          {ledger.payments.map((payment) => (
            <li key={payment.id}>
              第 {ledger.installments.findIndex((row) => row.id === payment.installment_id) + 1} 期
              · {formatCents(payment.amount_cents)} 元 · {payment.reversed_at ? '已冲回' : '已确认'}{' '}
              · {new Date(payment.committed_at).toLocaleString()}
              <FinanceSourceNote targetId={payment.id} finance={finance} />
            </li>
          ))}
        </ul>
        {state && (
          <>
            <h4>律师分配与到账历史</h4>
            {state.allocations
              .filter((item) => item.project_id === project.id)
              .map((part) => (
                <div className="finance-flow" key={part.id}>
                  <span>
                    {part.occurred_on} ·{' '}
                    {state.rules.find((rule) => rule.id === part.rule_id)?.name} · 应发{' '}
                    {formatCents(part.payable_cents)} 元 · {part.reversed_at ? '已冲回' : '有效'}
                  </span>
                  {part.note && <small>{part.note}</small>}
                  {state.payouts
                    .filter((paid) => paid.allocation_id === part.id)
                    .map((paid) => (
                      <div key={paid.id}>
                        {paid.occurred_on} · 律师到账 {formatCents(paid.amount_cents)} 元 ·{' '}
                        {paid.reversed_at ? '已冲回' : '有效'} {paid.note}
                        <FinanceSourceNote targetId={paid.id} finance={finance} />
                      </div>
                    ))}
                </div>
              ))}
          </>
        )}
      </details>
      {propertySlot ? createPortal(tools, propertySlot) : tools}
    </>
  );
}
