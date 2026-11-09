import type { FinanceRule } from '@caselite/contracts';

const portion = (amount: number, bps: number) =>
  Number((BigInt(amount) * BigInt(bps) + 5000n) / 10000n);
export function calculateFinanceShare(
  rule: FinanceRule,
  values: {
    base: number;
    tax: number;
    cost: number;
    post: number;
    previousBase: number;
    previousFirm: number;
  },
) {
  const { base, tax, cost, post, previousBase, previousFirm } = values;
  if (
    [base, tax, cost, post, previousBase, previousFirm].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error('金额或累计基数无效。');
  if (rule.method !== 'net_lawyer' && (tax || cost))
    throw new Error('直接比例分成不能扣分成前费用。');
  const distributable = base - tax - cost;
  if (!Number.isSafeInteger(previousBase + distributable))
    throw new Error('累计基数超出安全范围，请核对年度数据。');
  if (distributable < 0) throw new Error('分成前扣项超过回款。');
  let firm: number;
  let lawyer: number;
  if (rule.method === 'annual_tier') {
    if (
      !rule.annual_data_confirmed ||
      rule.threshold_cents <= 0 ||
      rule.second_rate_bps < rule.rate_bps
    )
      throw new Error('年度数据或超额分段规则尚未核定。');
    const cumulative = (value: number) =>
      portion(Math.min(value, rule.threshold_cents), rule.rate_bps) +
      portion(Math.max(0, value - rule.threshold_cents), rule.second_rate_bps);
    lawyer = cumulative(previousBase + distributable) - cumulative(previousBase);
    firm = distributable - lawyer;
  } else if (rule.method === 'annual_cap') {
    if (!rule.annual_data_confirmed || rule.cap_cents <= 0 || previousFirm > rule.cap_cents)
      throw new Error('年度封顶数据尚未核定。');
    firm = Math.min(
      portion(previousBase + distributable, rule.rate_bps) - portion(previousBase, rule.rate_bps),
      rule.cap_cents - previousFirm,
    );
    lawyer = distributable - firm;
  } else if (rule.method === 'firm_percent') {
    // 同一规则累计差额按分计算，避免多笔小额回款累计舍入多分配。
    firm =
      portion(previousBase + distributable, rule.rate_bps) - portion(previousBase, rule.rate_bps);
    lawyer = distributable - firm;
  } else {
    lawyer =
      portion(previousBase + distributable, rule.rate_bps) - portion(previousBase, rule.rate_bps);
    firm = distributable - lawyer;
  }
  if (firm < 0 || lawyer < 0 || post > lawyer) throw new Error('本人扣项或历史分成需要核对。');
  return {
    distributable_cents: distributable,
    firm_cents: firm,
    lawyer_cents: lawyer,
    payable_cents: lawyer - post,
  };
}
