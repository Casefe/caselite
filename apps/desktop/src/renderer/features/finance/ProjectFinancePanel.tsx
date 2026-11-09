import { Fragment, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FinanceResponse, Matter } from '../../../preload/caselite-api';
import type { FinanceManagementSuccess, Draft } from './types';
import type { FinanceManagementController } from './useFinanceManagement';
import { formatCents, parseCents } from './money';
import { localFinanceDate } from './FinanceSettings';

type Ledger = NonNullable<Extract<FinanceResponse, { kind: 'ledger' }>['ledger']>;
type Props = {
  project: Matter;
  ledger: Ledger;
  today: string;
  finance: FinanceManagementController;
  disabled: boolean;
  onEdit(): void;
  submit(draft: Draft): void;
  reverse(id: string): void;
  entry: boolean;
  setEntry(value: boolean): void;
  propertySlot: HTMLDivElement | null;
};
export default function ProjectFinancePanel({
  project,
  ledger,
  today,
  finance,
  disabled,
  onEdit,
  submit,
  reverse,
  entry,
  setEntry,
  propertySlot,
}: Props) {
  const [inputMode, setInputMode] = useState('manual');
  const [expanded, setExpanded] = useState<string>();
  const [type, setType] = useState('payment');
  const [ruleId, setRuleId] = useState('');
  const [preview, setPreview] = useState<FinanceManagementSuccess['preview']>();
  const [localError, setLocalError] = useState('');
  const [previewDigest, setPreviewDigest] = useState<string>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const state = finance.state;
  const binding = state?.bindings.find((row) => row.project_id === project.id);
  const activePayments = ledger.payments.filter((row) => !row.reversed_at);
  const allocations =
    state?.allocations.filter((row) => row.project_id === project.id && !row.reversed_at) ?? [];
  const payouts =
    state?.payouts.filter((row) => row.project_id === project.id && !row.reversed_at) ?? [];
  const totalPaid = payouts.reduce((sum, row) => sum + row.amount_cents, 0);
  const totalPayable = allocations.reduce((sum, row) => sum + row.payable_cents, 0);
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      if (type === 'payment') {
        const amount = parseCents(String(fields.get('amount')));
        if (!amount) throw new Error('请填写有效收款金额。');
        submit({
          operation: 'record_payment',
          installment_id: String(fields.get('installment')),
          amount_cents: amount,
        });
        return;
      }
      if (type === 'payout') {
        const amount = parseCents(String(fields.get('amount')));
        if (!amount) throw new Error('请填写有效到账金额。');
        if (
          await finance.submit({
            operation: 'm_record_payout',
            project_id: project.id,
            allocation_id: String(fields.get('allocation')),
            amount_cents: amount,
            occurred_on: String(fields.get('date')),
            note: String(fields.get('note')),
          })
        ) {
          setEntry(false);
        }
        return;
      }
      if (!binding) throw new Error('请先为本案选择并保存提成规则。');
      const draft = {
        project_id: project.id,
        payment_id: String(fields.get('payment')),
        rule_id: binding.rule_id,
        pre_tax_cents: parseCents(String(fields.get('tax'))),
        pre_cost_cents: parseCents(String(fields.get('cost'))),
        post_deduction_cents: parseCents(String(fields.get('post'))),
        deductions_confirmed: true as const,
        occurred_on: String(fields.get('date')),
        note: String(fields.get('note')),
      };
      for (const key of ['tax', 'cost', 'post'])
        if (!/^\d+(\.\d{1,2})?$/.test(String(fields.get(key))))
          throw new Error('请填写核定扣项金额；确认无扣项填0。');
      if (!preview) {
        setPreviewBusy(true);
        const result = await window.caselite.finance({
          protocol_version: 1,
          operation: 'm_preview_allocation',
          ...draft,
        });
        if (!result.ok || result.kind !== 'management' || !result.preview)
          throw new Error(result.ok ? '无法核对本次分配。' : result.message);
        setPreview(result.preview);
        setPreviewDigest(result.preview_digest);
      } else if (
        await finance.submit({
          operation: 'm_allocate',
          ...draft,
          expected_preview_digest: previewDigest ?? '',
        })
      ) {
        setEntry(false);
        setPreview(undefined);
      }
    } catch (error) {
      setLocalError((error as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }
  const entryContent = (
    <>
      <div className="finance-rule-binding">
        <label>
          本案结算规则
          <select
            aria-label="本案结算规则"
            disabled={disabled || !!project.archived_at}
            value={ruleId || binding?.rule_id || ''}
            onChange={(event) => {
              setRuleId(event.target.value);
              finance.markDirty();
            }}
          >
            <option value="">选择已保存规则</option>
            {state?.rules.map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || !ruleId || !!project.archived_at}
          onClick={() =>
            void finance.submit({
              operation: 'm_bind_rule',
              project_id: project.id,
              rule_id: ruleId,
              expected_rule_id: binding?.rule_id ?? null,
            })
          }
        >
          采用此规则
        </button>
        <span className="finance-muted">历史结算按原快照保留。</span>
      </div>
      <section hidden={!entry} className="finance-entry" aria-label="记一笔">
        <div className="finance-section-heading">
          <h3>记一笔</h3>
          <button
            disabled={disabled}
            onClick={() => {
              setEntry(false);
              setPreview(undefined);
              setPreviewDigest(undefined);
            }}
          >
            收起录入
          </button>
        </div>
        <div className="finance-entry-modes">
          {[
            ['manual', '手动输入'],
            ['file', '从文件导入'],
            ['photo', '拍照录入'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={inputMode === id}
              disabled={disabled}
              onClick={() => setInputMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div hidden={inputMode !== 'manual'}>
          <form
            onSubmit={(event) => void record(event)}
            onChange={(event) => {
              if (event.target instanceof HTMLSelectElement && event.target.name === 'kind') return;
              if (type === 'payment') onEdit();
              else finance.markDirty();
              setPreview(undefined);
              setPreviewDigest(undefined);
            }}
          >
            <fieldset disabled={disabled || previewBusy}>
              <label>
                记录类型
                <select
                  name="kind"
                  value={type}
                  onChange={(event) => {
                    setType(event.target.value);
                    setPreview(undefined);
                    setPreviewDigest(undefined);
                  }}
                >
                  <option value="payment">客户回款</option>
                  <option value="allocation">确认律师分配</option>
                  <option value="payout">律师结算到账</option>
                </select>
              </label>
              {type === 'payment' ? (
                <>
                  <label>
                    分配到期款
                    <select name="installment" required defaultValue="">
                      <option value="" disabled>
                        选择期款
                      </option>
                      {ledger.installments
                        .filter((row) => row.outstanding_cents > 0)
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            第 {ledger.installments.indexOf(row) + 1} 期 · {row.due_date}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    收款金额（元）
                    <input name="amount" required inputMode="decimal" />
                  </label>
                </>
              ) : type === 'payout' ? (
                <>
                  <label>
                    对应结算分配
                    <select name="allocation" required defaultValue="">
                      <option value="" disabled>
                        选择已核定分配
                      </option>
                      {allocations.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.occurred_on} · 应发 {formatCents(row.payable_cents)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    实际到账金额（元）
                    <input name="amount" required inputMode="decimal" />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    对应回款
                    <select name="payment" required defaultValue="">
                      <option value="" disabled>
                        选择未分配回款
                      </option>
                      {activePayments
                        .filter((row) => !allocations.some((part) => part.payment_id === row.id))
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {formatCents(row.amount_cents)} 元 · 第{' '}
                            {ledger.installments.findIndex(
                              (period) => period.id === row.installment_id,
                            ) + 1}{' '}
                            期
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="finance-fields">
                    {[
                      ['tax', '分成前核定税费'],
                      ['cost', '分成前核定费用'],
                      ['post', '本人核定扣项'],
                    ].map(([id, label]) => (
                      <label key={id}>
                        {label}（元）
                        <input
                          name={id}
                          required
                          inputMode="decimal"
                          placeholder="已确认无此扣项填0"
                          defaultValue="0"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="finance-checkbox">
                    <input type="checkbox" required />
                    扣项和可结算收入已核定；0表示确认无此扣项。
                  </label>
                </>
              )}
              {type !== 'payment' && (
                <>
                  <label>
                    实际日期
                    <input name="date" type="date" required defaultValue={localFinanceDate()} />
                  </label>
                  <label>
                    备注
                    <input name="note" maxLength={1000} />
                  </label>
                </>
              )}
              {preview && (
                <div className="finance-preview">
                  可分 {formatCents(preview.distributable_cents)} 元 − 律所{' '}
                  {formatCents(preview.firm_cents)} 元 = 我的应分{' '}
                  {formatCents(preview.lawyer_cents)} 元；扣项后应发{' '}
                  {formatCents(preview.payable_cents)} 元。
                </div>
              )}
              {localError && <p role="alert">{localError}</p>}
              <button className="primary">
                {type === 'payment'
                  ? '确认登记收款'
                  : type === 'payout'
                    ? '确认律师到账'
                    : preview
                      ? '确认本次分配'
                      : '核对本次分配'}
              </button>
            </fieldset>
          </form>
        </div>
        {inputMode !== 'manual' && (
          <p className="finance-muted">材料录入正在与本机来源接线；手动录入不受影响。</p>
        )}
      </section>
    </>
  );
  return (
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
          disabled={disabled || !!project.archived_at}
          onClick={() => {
            setEntry(true);
            setLocalError('');
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
          <dd>{state && allocations.length ? formatCents(totalPayable - totalPaid) : '待核对'}</dd>
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
                                  <strong>客户回款 {formatCents(payment.amount_cents)} 元</strong>
                                  <time>{new Date(payment.committed_at).toLocaleString()}</time>
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
                                          <button
                                            disabled={disabled || !!project.archived_at}
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
                                              disabled={disabled}
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
                                              disabled={disabled}
                                              onClick={() => {
                                                setType('allocation');
                                                setPreview(undefined);
                                                setPreviewDigest(undefined);
                                                setEntry(true);
                                              }}
                                            >
                                              核对分配
                                            </button>
                                          )}
                                          <button
                                            disabled={disabled}
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
      <details className="finance-all-records">
        <summary>全部收款与更正记录（{ledger.payments.length}笔）</summary>
        <ul className="finance-payments">
          {ledger.payments.map((payment) => (
            <li key={payment.id}>
              第 {ledger.installments.findIndex((row) => row.id === payment.installment_id) + 1} 期
              · {formatCents(payment.amount_cents)} 元 · {payment.reversed_at ? '已冲回' : '已确认'}{' '}
              · {new Date(payment.committed_at).toLocaleString()}
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
                      <span key={paid.id}>
                        {paid.occurred_on} · 律师到账 {formatCents(paid.amount_cents)} 元 ·{' '}
                        {paid.reversed_at ? '已冲回' : '有效'} {paid.note}
                      </span>
                    ))}
                </div>
              ))}
          </>
        )}
      </details>
      {propertySlot ? createPortal(entryContent, propertySlot) : entryContent}
    </>
  );
}
