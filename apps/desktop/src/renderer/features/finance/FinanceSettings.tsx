import { useState, type FormEvent } from 'react';
import type { FinanceRule } from './types';
import type { FinanceManagementController } from './useFinanceManagement';
import { parseCents } from './money';

export function localFinanceDate() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
const templates = [
  ['firm_percent', 20, '自带案源 · 律所20% / 律师80%'],
  ['firm_percent', 15, '自带案源 · 律所15% / 律师85%'],
  ['firm_percent', 10, '自带案源 · 律所10% / 律师90%'],
  ['lawyer_percent', 20, '所内案源 · 律师20%'],
  ['net_lawyer', 30, '净额分成 · 律师30%'],
  ['annual_tier', 82, '年度超额分段（需核定）'],
  ['annual_cap', 10, '年度留所封顶（需核定）'],
] as const;
export default function FinanceSettings({ finance }: { finance: FinanceManagementController }) {
  const [template, setTemplate] = useState(0);
  const [revision, setRevision] = useState(0);
  const [defaultId, setDefaultId] = useState(finance.state?.default_rule_id ?? '');
  const [validation, setValidation] = useState('');
  const [defaultVersion] = useState(finance.state?.version ?? 0);
  const current = templates[template];
  const annual = current[0].startsWith('annual_');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setValidation('');
    const rate = String(data.get('rate'));
    if (!/^\d+(\.\d{1,2})?$/.test(rate) || Number(rate) > 100) {
      setValidation('比例应在0%至100%，最多两位小数。');
      return;
    }
    const values = {
      name: String(data.get('name')),
      firm_name: String(data.get('firm')),
      method: current[0] as FinanceRule['method'],
      rate_bps: Math.round(Number(rate) * 100),
      second_rate_bps: Math.round(Number(data.get('second_rate') ?? 85) * 100),
      threshold_cents: parseCents(String(data.get('threshold') ?? 0)),
      cap_cents: parseCents(String(data.get('cap') ?? 0)),
      settlement_trigger: String(data.get('trigger')) as FinanceRule['settlement_trigger'],
      effective_date: String(data.get('effective')),
      annual_year: Number(data.get('year') ?? new Date().getFullYear()),
      opening_base_cents: parseCents(String(data.get('opening_base') ?? 0)),
      opening_firm_cents: parseCents(String(data.get('opening_firm') ?? 0)),
      annual_data_confirmed: data.get('annual_confirmed') === 'on',
    };
    if (await finance.submit({ operation: 'm_save_rule', values })) {
      setRevision((value) => value + 1);
    }
  }
  return (
    <section className="finance-settings" aria-label="财务设置">
      <div className="finance-section-heading">
        <div>
          <h2>律所提成设置</h2>
          <p>保存本所约定，案件选用后计算。快捷比例为公开样例，须按实际约定核对。</p>
        </div>
      </div>
      <div className="finance-settings-grid">
        <form
          key={revision}
          onSubmit={(event) => void save(event)}
          onChange={() => finance.markDirty()}
        >
          <fieldset disabled={finance.busy || !!finance.pending}>
            <legend>保存为新规则</legend>
            <label>
              常见提成方式
              <select
                value={template}
                onChange={(event) => {
                  setTemplate(Number(event.target.value));
                  setRevision((value) => value + 1);
                  finance.markDirty();
                }}
              >
                {templates.map((item, index) => (
                  <option key={index} value={index}>
                    {item[2]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              规则名称
              <input name="name" required maxLength={80} defaultValue={current[2]} />
            </label>
            <label>
              所属律所
              <input name="firm" required maxLength={80} placeholder="填写实际所属律所" />
            </label>
            <div className="finance-fields">
              <label>
                {current[0] === 'firm_percent' || current[0] === 'annual_cap'
                  ? '律所留存比例（%）'
                  : '律师份额比例（%）'}
                <input
                  name="rate"
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={current[1]}
                />
              </label>
              <label>
                生效日期
                <input name="effective" required type="date" defaultValue={localFinanceDate()} />
              </label>
            </div>
            <label>
              可结算条件
              <select name="trigger" defaultValue="approval">
                <option value="approval">回款后逐笔核定</option>
                <option value="receipt" disabled={current[0] === 'net_lawyer'}>
                  回款确认即可分成（已确认无其他扣项）
                </option>
              </select>
            </label>
            {annual && (
              <>
                <div className="finance-fields">
                  <label>
                    核算年度
                    <input
                      name="year"
                      required
                      type="number"
                      min="2000"
                      max="9999"
                      defaultValue={new Date().getFullYear()}
                    />
                  </label>
                  <label>
                    启用前累计可分基数（元）
                    <input
                      name="opening_base"
                      required
                      inputMode="decimal"
                      placeholder="完整核定后填写，含确认的0"
                    />
                  </label>
                  <label>
                    启用前累计已提留所（元）
                    <input
                      name="opening_firm"
                      required
                      inputMode="decimal"
                      placeholder="完整核定后填写"
                    />
                  </label>
                </div>
                {current[0] === 'annual_tier' ? (
                  <div className="finance-fields">
                    <label>
                      首段年度上限（元）
                      <input name="threshold" required inputMode="decimal" defaultValue="600000" />
                    </label>
                    <label>
                      超出部分律师份额（%）
                      <input
                        name="second_rate"
                        required
                        type="number"
                        min={current[1]}
                        max="100"
                        step="0.01"
                        defaultValue="85"
                      />
                    </label>
                  </div>
                ) : (
                  <label>
                    年度留所上限（元）
                    <input name="cap" required inputMode="decimal" defaultValue="300000" />
                  </label>
                )}
                <label className="finance-checkbox">
                  <input name="annual_confirmed" type="checkbox" required />
                  已核定本年度完整数据；阶梯按超额分段，封顶按同一律所／本人累计。
                </label>
              </>
            )}
            <label className="finance-checkbox">
              <input type="checkbox" required />
              已核对比例归属、计算基数和扣项；本次保存新规则，不改旧结算。
            </label>
            {validation && <p role="alert">{validation}</p>}
            <button className="primary">保存新规则</button>
          </fieldset>
        </form>
        <div>
          <h3>我的规则</h3>
          {finance.loading && <p>正在读取…</p>}
          {!finance.state?.rules.length && (
            <p className="finance-muted">尚未保存规则；不会默认给案件套比例。</p>
          )}
          <ul className="finance-rule-list">
            {finance.state?.rules.map((rule) => (
              <li key={rule.id}>
                <strong>{rule.name}</strong>
                <span>
                  {rule.firm_name} ·{' '}
                  {rule.method === 'firm_percent' || rule.method === 'annual_cap'
                    ? '律所留存'
                    : '律师份额'}{' '}
                  {rule.rate_bps / 100}%
                </span>
                <small>
                  {rule.effective_date} 生效 ·{' '}
                  {rule.settlement_trigger === 'receipt' ? '回款即可计算' : '逐笔核定'}
                </small>
              </li>
            ))}
          </ul>
          <label>
            新建账案件默认规则
            <select
              value={defaultId}
              disabled={finance.busy || !!finance.pending}
              onChange={(event) => {
                setDefaultId(event.target.value);
                finance.markDirty();
              }}
            >
              <option value="">不自动选择</option>
              {finance.state?.rules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!finance.state || finance.busy || !!finance.pending}
            onClick={() =>
              void finance.submit({
                operation: 'm_set_default',
                rule_id: defaultId || null,
                expected_version: defaultVersion,
              })
            }
          >
            保存默认规则
          </button>
          <p className="finance-muted">
            已有案件保留其已选规则；切换规则只影响新的分配。净额税费使用核定金额，不自动报税或打款。
          </p>
        </div>
      </div>
    </section>
  );
}
