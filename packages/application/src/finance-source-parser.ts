export function extractFinanceSuggestions(text: string) {
  const kind = /增值税.*发票|电子发票|发票号码/u.test(text)
    ? 'invoice'
    : /委托.*合同|法律服务合同|委托协议/u.test(text)
      ? 'contract'
      : /收款|转账成功|电子回单|到账|交易成功/u.test(text)
        ? 'payment'
        : /支出|消费|差旅|费用|付款/u.test(text)
          ? 'expense'
          : 'unknown';
  const amounts = new Set<number>();
  // 只提取带金额标签或币种的值，案号、账号和票号不能被当作款项。
  const pattern =
    /(?:金额|合计|律师费|服务费|价税合计|人民币|[¥￥])\s*[:：]?\s*[¥￥]?\s*([\d,，]+(?:\.\d{1,2})?)(?![\d.])\s*(万)?(?:\s*元)?/gu;
  for (const match of text.matchAll(pattern)) {
    if (/[,，]/.test(match[1]) && !/^\d{1,3}(?:[,，]\d{3})+(?:\.\d{1,2})?$/.test(match[1]))
      continue;
    const raw = match[1].replace(/[,，]/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) continue;
    const [whole, fraction = ''] = raw.split('.');
    const cents =
      (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (match[2] ? 10000n : 1n);
    if (cents > 0n && cents <= 1_000_000_000_000n) amounts.add(Number(cents));
    if (amounts.size >= 100) break;
  }
  const dates = new Set<string>();
  for (const match of text.matchAll(
    /(?<!\d)(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?!\d)/gu,
  )) {
    if (
      kind === 'contract' &&
      !/(到期|付款|支付|应付)/u.test(
        text.slice(Math.max(0, (match.index ?? 0) - 20), (match.index ?? 0) + match[0].length + 12),
      )
    )
      continue;
    const value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value)
      dates.add(value);
    if (dates.size >= 100) break;
  }
  const reference =
    /(?:合同(?:编号|号码)|发票号码|票号|交易(?:单号|编号))\s*[:：]?\s*([A-Za-z0-9\-一-龥]{3,80})/u.exec(
      text,
    )?.[1] ?? null;
  return { kind, amount_options: [...amounts], date_options: [...dates], reference } as {
    kind: 'contract' | 'payment' | 'invoice' | 'expense' | 'unknown';
    amount_options: number[];
    date_options: string[];
    reference: string | null;
  };
}
