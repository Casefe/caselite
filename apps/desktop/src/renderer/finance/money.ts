export function formatCents(cents: number | null | undefined) {
  if (cents == null) return '—';
  const amount = BigInt(cents);
  if (amount === 0n) return '0';
  return (amount / 100n).toLocaleString('zh-CN') + '.' + String(amount % 100n).padStart(2, '0');
}

export function parseCents(input: string) {
  const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return 0;
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : 0;
}
