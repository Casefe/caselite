import { useState, type FormEvent, type ReactNode } from 'react';
import type { FinanceResponse, Matter } from '../../../preload/caselite-api';
import type {
  FinanceManagementSuccess,
  Draft,
  FinanceCandidate,
  FinancePrefill,
  ContractSeed,
} from './types';
import type { FinanceManagementController } from './useFinanceManagement';
import FinanceIntake from './FinanceIntake';
import { FinanceExpenseFields } from './FinanceExpenses';
import { formatCents, parseCents } from './money';
import { localFinanceDate } from './FinanceSettings';
type Ledger = NonNullable<Extract<FinanceResponse, { kind: 'ledger' }>['ledger']>;
export default function FinanceEntry({
  project,
  ledger: storedLedger,
  contractForm,
  onIntakeBusy,
  finance,
  disabled: actionDisabled,
  onEdit,
  submit,
  entry,
  setEntry,
  intent,
  onEntrySaved,
}: {
  project: Matter;
  ledger: Ledger | null;
  contractForm?: (seed: ContractSeed) => ReactNode;
  onIntakeBusy(value: boolean): void;
  finance: FinanceManagementController;
  disabled: boolean;
  onEdit(): void;
  submit(draft: Draft): void;
  entry: boolean;
  setEntry(value: boolean): void;
  intent?: { kind: 'allocation' | 'reimbursement'; id: string };
  onEntrySaved(): void;
}) {
  const [intakeBusy, setIntakeBusy] = useState(false);
  const disabled = actionDisabled || !!project.archived_at || intakeBusy;
  const [activeCandidate, setActiveCandidate] = useState<FinanceCandidate>();
  const [prefill, setPrefill] = useState<FinancePrefill>({});
  const source = activeCandidate
    ? { candidate_id: activeCandidate.id, confirmed: true as const }
    : undefined;
  const hasContract = !!storedLedger;
  const ledger: Ledger = storedLedger ?? {
    number: '',
    amount_cents: 0,
    outstanding_cents: 0,
    due_cents: 0,
    installments: [],
    payments: [],
  };
  const [inputMode, setInputMode] = useState('manual');
  const [type, setType] = useState(intent?.kind ?? (hasContract ? 'payment' : 'contract'));
  const [selectedExpense] = useState(intent?.kind === 'reimbursement' ? intent.id : '');
  const [preview, setPreview] = useState<FinanceManagementSuccess['preview']>();
  const [localError, setLocalError] = useState('');
  const [previewDigest, setPreviewDigest] = useState<string>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const state = finance.state;
  const binding = state?.bindings.find((row) => row.project_id === project.id);
  const activePayments = ledger.payments.filter((row) => !row.reversed_at);
  const allocations =
    state?.allocations.filter((row) => row.project_id === project.id && !row.reversed_at) ?? [];
  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      if (source && fields.get('source_confirmed') !== 'on')
        throw new Error('请先核对来源并勾选确认。');
      if (type === 'choose') throw new Error('请选择记录类型。');
      if (type === 'allocation' && source)
        throw new Error('律师分配由已确认回款与规则计算，请先取消来源引用。');
      if (type === 'payment') {
        const amount = parseCents(String(fields.get('amount')));
        if (!amount) throw new Error('请填写有效收款金额。');
        submit({
          operation: 'record_payment',
          source,
          occurred_on: String(fields.get('date')),
          note: String(fields.get('note')),
          installment_id: String(fields.get('installment')),
          amount_cents: amount,
        });
        return;
      }
      if (type === 'expense' || type === 'reimbursement') {
        const amount = parseCents(String(fields.get('amount')));
        if (!amount) throw new Error('请填写有效金额。');
        const common = {
          project_id: project.id,
          source,
          amount_cents: amount,
          occurred_on: String(fields.get('date')),
          note: String(fields.get('note')),
        };
        if (
          await finance.submit(
            type === 'expense'
              ? {
                  operation: 'm_record_expense',
                  ...common,
                  description: String(fields.get('description')),
                  category: String(fields.get('category')) as
                    'case_cost' | 'travel' | 'client_advance' | 'other',
                  payer: String(fields.get('payer')) as 'lawyer' | 'firm' | 'client',
                  bearer: String(fields.get('bearer')) as 'lawyer' | 'firm' | 'client',
                  payee: String(fields.get('payee')),
                  reimbursable: fields.get('reimbursable') === 'on',
                }
              : {
                  operation: 'm_record_reimbursement',
                  ...common,
                  expense_id: String(fields.get('expense')),
                },
          )
        ) {
          setEntry(false);
          onEntrySaved();
        }
        return;
      }
      if (type === 'invoice' || type === 'red_invoice') {
        const amount = parseCents(String(fields.get('amount')));
        if (!amount) throw new Error('请填写有效发票金额。');
        const common = {
          project_id: project.id,
          source,
          installment_id: String(fields.get('installment')),
          invoice_number: String(fields.get('invoice_number')),
          amount_cents: amount,
          occurred_on: String(fields.get('date')),
          note: String(fields.get('note')),
        };
        if (
          await finance.submit(
            type === 'invoice'
              ? { operation: 'm_record_invoice', ...common }
              : {
                  operation: 'm_red_invoice',
                  ...common,
                  original_invoice_id: String(fields.get('original_invoice')),
                },
          )
        ) {
          setEntry(false);
          onEntrySaved();
        }
        return;
      }
      if (type === 'payout') {
        const amount = parseCents(String(fields.get('amount')));
        if (!amount) throw new Error('请填写有效到账金额。');
        if (
          await finance.submit({
            operation: 'm_record_payout',
            project_id: project.id,
            source,
            allocation_id: String(fields.get('allocation')),
            amount_cents: amount,
            occurred_on: String(fields.get('date')),
            note: String(fields.get('note')),
          })
        ) {
          {
            setEntry(false);
            onEntrySaved();
          }
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
        {
          setEntry(false);
          onEntrySaved();
        }
        setPreview(undefined);
      }
    } catch (error) {
      setLocalError((error as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }
  return (
    <>
      <section hidden={!entry} className="finance-entry" aria-label="记一笔">
        {localError && <p role="alert">{localError}</p>}
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
        {activeCandidate && (
          <div className="finance-candidate">
            <strong>引用：{activeCandidate.name}</strong>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setActiveCandidate(undefined);
                setPrefill({});
                setType(hasContract ? 'payment' : 'contract');
              }}
            >
              取消引用，手动填写
            </button>
          </div>
        )}
        <div hidden={inputMode !== 'manual'}>
          <label>
            记录类型
            <select
              name="kind"
              value={type}
              disabled={disabled || previewBusy}
              onChange={(event) => {
                setType(event.target.value);
                setPreview(undefined);
                setPreviewDigest(undefined);
              }}
            >
              {type === 'choose' && (
                <option value="choose" disabled>
                  选择记录类型
                </option>
              )}
              {!hasContract && <option value="contract">收费约定</option>}
              {hasContract && (
                <>
                  <option value="payment">客户回款</option>
                  <option value="allocation">确认律师分配</option>
                  <option value="payout">律师结算到账</option>
                  <option value="invoice">已开发票</option>
                  <option value="red_invoice">已开红字发票</option>
                </>
              )}
              <option value="expense">支出 / 垫付</option>
              <option value="reimbursement">实际报销</option>
            </select>
          </label>
          <div hidden={type !== 'contract'}>
            {contractForm?.({ ...prefill, source, sourceName: activeCandidate?.name })}
          </div>
          <form
            hidden={type === 'contract'}
            key={`${activeCandidate?.id ?? 'manual'}:${type}:${selectedExpense}:${prefill.amount ?? ''}:${prefill.date ?? ''}`}
            onSubmit={(event) => void record(event)}
            onChange={(event) => {
              if (event.target instanceof HTMLSelectElement && event.target.name === 'kind') return;
              if (type === 'payment') onEdit();
              else finance.markDirty(`entry:${project.id}`);
              setPreview(undefined);
              setPreviewDigest(undefined);
            }}
          >
            <fieldset disabled={disabled || previewBusy}>
              {type === 'choose' ? (
                <p>请选择记录类型后核对字段。</p>
              ) : type === 'payment' ? (
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
                    <input
                      name="amount"
                      required
                      inputMode="decimal"
                      defaultValue={
                        prefill.amount === undefined ? '' : (prefill.amount / 100).toFixed(2)
                      }
                    />
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
                    <input
                      name="amount"
                      required
                      inputMode="decimal"
                      defaultValue={
                        prefill.amount === undefined ? '' : (prefill.amount / 100).toFixed(2)
                      }
                    />
                  </label>
                </>
              ) : type === 'expense' || type === 'reimbursement' ? (
                <FinanceExpenseFields
                  key={`${type}:${selectedExpense}`}
                  type={type}
                  state={state}
                  projectId={project.id}
                  selected={selectedExpense}
                  prefill={prefill}
                />
              ) : type === 'invoice' || type === 'red_invoice' ? (
                <>
                  {type === 'red_invoice' && (
                    <label>
                      原蓝字发票
                      <select name="original_invoice" required defaultValue="">
                        <option value="" disabled>
                          选择原发票
                        </option>
                        {state?.invoices
                          .filter(
                            (item) => item.project_id === project.id && item.kind === 'invoice',
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.invoice_number} · {formatCents(item.amount_cents)} 元
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label>
                    对应期款
                    <select name="installment" required defaultValue="">
                      <option value="" disabled>
                        选择期款
                      </option>
                      {ledger.installments.map((item, index) => (
                        <option key={item.id} value={item.id}>
                          第 {index + 1} 期
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    发票号码
                    <input
                      name="invoice_number"
                      required
                      maxLength={80}
                      defaultValue={prefill.reference}
                    />
                  </label>
                  <label>
                    发票金额（元）
                    <input
                      name="amount"
                      required
                      inputMode="decimal"
                      defaultValue={
                        prefill.amount === undefined ? '' : (prefill.amount / 100).toFixed(2)
                      }
                    />
                  </label>
                  <p className="finance-muted">登记已开具的发票；确认后不改变客户回款与待收。</p>
                </>
              ) : (
                <>
                  <label>
                    对应回款
                    <select
                      name="payment"
                      required
                      defaultValue={intent?.kind === 'allocation' ? intent.id : ''}
                    >
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
              {
                <>
                  <label>
                    实际日期
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={prefill.date ?? (activeCandidate ? '' : localFinanceDate())}
                    />
                  </label>
                  <label>
                    备注
                    <input name="note" maxLength={1000} />
                  </label>
                </>
              }
              <div>
                {source && (
                  <label className="finance-checkbox">
                    <input name="source_confirmed" type="checkbox" required />
                    已核对原件、类型、金额、日期和关联期款；确认本笔记录。
                  </label>
                )}
              </div>
              {preview && (
                <div className="finance-preview">
                  可分 {formatCents(preview.distributable_cents)} 元 − 律所{' '}
                  {formatCents(preview.firm_cents)} 元 = 我的应分{' '}
                  {formatCents(preview.lawyer_cents)} 元；扣项后应发{' '}
                  {formatCents(preview.payable_cents)} 元。
                </div>
              )}
              <button className="primary">
                {type === 'payment'
                  ? '确认登记收款'
                  : type === 'payout'
                    ? '确认律师到账'
                    : type === 'expense'
                      ? '确认登记支出'
                      : type === 'reimbursement'
                        ? '确认登记报销'
                        : type === 'invoice' || type === 'red_invoice'
                          ? '确认登记发票'
                          : preview
                            ? '确认本次分配'
                            : '核对本次分配'}
              </button>
            </fieldset>
          </form>
        </div>
        <FinanceIntake
          projectId={project.id}
          mode={inputMode}
          finance={finance}
          disabled={actionDisabled || !!project.archived_at}
          onBusy={(value) => {
            setIntakeBusy(value);
            onIntakeBusy(value);
          }}
          onUse={(candidate, values) => {
            if (hasContract && candidate.kind === 'contract') {
              setLocalError('本项目已有收费约定；本条候选先保留，请核对现有合同。');
              return;
            }
            if (!hasContract && ['payment', 'invoice'].includes(candidate.kind)) {
              setLocalError('请先登记收费约定，再关联这条待确认记录。');
              return;
            }
            setActiveCandidate(candidate);
            setPrefill(values);
            setInputMode('manual');
            setType(candidate.kind === 'unknown' ? 'choose' : candidate.kind);
            setPreview(undefined);
            setPreviewDigest(undefined);
            if (['contract', 'payment'].includes(candidate.kind)) onEdit();
            else finance.markDirty(`entry:${project.id}`);
          }}
        />
      </section>
    </>
  );
}
