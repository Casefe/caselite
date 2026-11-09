import type { FinanceManagementController } from './useFinanceManagement';
import type { FinanceManagementSuccess } from './types';
import { formatCents } from './money';
const parties = { lawyer: '我', firm: '律所', client: '客户' };
type State = FinanceManagementSuccess['state'];
export function FinanceExpenseFields({
  type,
  state,
  projectId,
  selected,
}: {
  type: string;
  state: State | undefined;
  projectId: string;
  selected: string;
}) {
  return type === 'expense' ? (
    <>
      <label>
        支出事项
        <input name="description" required maxLength={160} />
      </label>
      <label>
        支出类型
        <select name="category" defaultValue="case_cost">
          <option value="case_cost">办案费用</option>
          <option value="travel">差旅</option>
          <option value="client_advance">代客户支付</option>
          <option value="other">其他</option>
        </select>
      </label>
      <label>
        付款人
        <select name="payer" defaultValue="lawyer">
          {Object.entries(parties).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        最终承担方
        <select name="bearer" defaultValue="client">
          {Object.entries(parties).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        收款方
        <input name="payee" required maxLength={80} placeholder="例如法院、鉴定机构、酒店" />
      </label>
      <label>
        支出金额（元）
        <input name="amount" required inputMode="decimal" />
      </label>
      <label className="finance-checkbox">
        <input type="checkbox" name="reimbursable" defaultChecked />
        这是一笔待报销垫付
      </label>
    </>
  ) : (
    <>
      <label>
        对应垫付
        <select name="expense" required defaultValue={selected || ''}>
          <option value="" disabled>
            选择待报销支出
          </option>
          {state?.expenses
            .filter(
              (item) => item.project_id === projectId && !item.reversed_at && item.reimbursable,
            )
            .map((item) => {
              const paid = state.reimbursements
                .filter((row) => row.expense_id === item.id && !row.reversed_at)
                .reduce((sum, row) => sum + row.amount_cents, 0);
              return (
                <option key={item.id} value={item.id}>
                  {item.description} · 待报销 {formatCents(item.amount_cents - paid)} 元
                </option>
              );
            })}
        </select>
      </label>
      <label>
        实际报销金额（元）
        <input name="amount" required inputMode="decimal" />
      </label>
      <p className="finance-muted">
        报销收付按原垫付的承担方和付款人关联，不计入律师费回款或提成。
      </p>
    </>
  );
}
export default function FinanceExpenses({
  projectId,
  finance,
  disabled,
  onRecord,
}: {
  projectId: string;
  finance: FinanceManagementController;
  disabled: boolean;
  onRecord(id: string): void;
}) {
  const state = finance.state;
  const expenses = state?.expenses.filter((row) => row.project_id === projectId) ?? [];
  const reimbursements = state?.reimbursements.filter((row) => row.project_id === projectId) ?? [];
  const pending = expenses
    .filter((row) => !row.reversed_at && row.reimbursable && row.payer === 'lawyer')
    .reduce(
      (sum, row) =>
        sum +
        BigInt(row.amount_cents) -
        reimbursements
          .filter((item) => item.expense_id === row.id && !item.reversed_at)
          .reduce((s, item) => s + BigInt(item.amount_cents), 0n),
      0n,
    );
  return (
    <section className="finance-expenses" aria-label="支出与报销">
      <div className="finance-section-heading">
        <h3>支出与报销</h3>
        <span>我的待报销 {state ? formatCents(pending) : '待核对'} 元</span>
      </div>
      {expenses.length === 0 ? (
        <p className="finance-muted">尚未登记支出。</p>
      ) : (
        <div className="finance-table-scroll">
          <table aria-label="项目支出与报销">
            <thead>
              <tr>
                <th>事项 / 日期</th>
                <th>付款人 / 收款方</th>
                <th>承担方</th>
                <th>支出金额</th>
                <th>待报销</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => {
                const rows = reimbursements.filter((row) => row.expense_id === expense.id);
                const paid = rows
                  .filter((row) => !row.reversed_at)
                  .reduce((sum, row) => sum + row.amount_cents, 0);
                return (
                  <tr key={expense.id}>
                    <td>
                      <strong>{expense.description}</strong>
                      <small>
                        {expense.occurred_on} ·{' '}
                        {expense.reversed_at ? '已冲回' : expense.reimbursable ? '垫付' : '支出'}
                      </small>
                      <details>
                        <summary>收付与更正</summary>
                        <div className="finance-flow">
                          {expense.note && <p>{expense.note}</p>}
                          {rows.map((row) => (
                            <div key={row.id}>
                              {parties[row.from_party]} → {parties[row.to_party]}：
                              {formatCents(row.amount_cents)} 元 · {row.occurred_on} ·{' '}
                              {row.reversed_at ? '已冲回' : '已报销'}
                              <small>{row.note}</small>
                              {!row.reversed_at && (
                                <button
                                  disabled={disabled}
                                  onClick={() =>
                                    void finance.submit({
                                      operation: 'm_reverse_reimbursement',
                                      project_id: projectId,
                                      reimbursement_id: row.id,
                                      note: '用户确认更正误记报销，不代表实际退回资金',
                                    })
                                  }
                                >
                                  冲回报销登记
                                </button>
                              )}
                            </div>
                          ))}
                          {!expense.reversed_at && (
                            <>
                              <button
                                disabled={disabled}
                                onClick={() =>
                                  void finance.submit({
                                    operation: 'm_reverse_expense',
                                    project_id: projectId,
                                    expense_id: expense.id,
                                    note: '用户确认更正误记支出，不代表实际退款',
                                  })
                                }
                              >
                                冲回支出登记
                              </button>
                              {expense.reimbursable && paid < expense.amount_cents && (
                                <button disabled={disabled} onClick={() => onRecord(expense.id)}>
                                  登记报销
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </details>
                    </td>
                    <td>
                      {parties[expense.payer]} → {expense.payee}
                    </td>
                    <td>{parties[expense.bearer]}</td>
                    <td>{formatCents(expense.amount_cents)}</td>
                    <td>
                      {expense.reversed_at
                        ? '已冲回'
                        : expense.reimbursable
                          ? formatCents(expense.amount_cents - paid)
                          : '不报销'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
