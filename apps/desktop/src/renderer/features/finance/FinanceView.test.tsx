// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FinanceRequest, FinanceResponse, Matter } from '../../../preload/caselite-api';
import FinanceView from './FinanceView';
import { formatCents, parseCents } from './money';

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);
const project = {
  id: crypto.randomUUID(),
  title: '合成收费项目',
  status: 'active',
  version: 1,
  archived_at: null,
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-07T00:00:00.000Z',
  task_count: 0,
} satisfies Matter;
const ledger = {
  number: 'SYNTH',
  amount_cents: 100,
  due_cents: 100,
  outstanding_cents: 100,
  installments: [
    { id: crypto.randomUUID(), due_date: '2020-01-01', amount_cents: 100, outstanding_cents: 100 },
  ],
  payments: [],
};
const read = (saved: boolean, receipt: string | null = null): FinanceResponse => ({
  ok: true,
  kind: 'ledger',
  project_id: project.id,
  today: '2026-11-07',
  time_zone: 'Asia/Shanghai',
  receipt,
  evidence: receipt
    ? { operation: 'register_contract', target_id: project.id, activity_id: crypto.randomUUID() }
    : null,
  ledger: saved ? ledger : null,
});
const ruleA = crypto.randomUUID(),
  ruleB = crypto.randomUUID();
const ruleValue = {
  name: '合成规则A',
  firm_name: '合成律所',
  method: 'firm_percent',
  rate_bps: 2000,
  second_rate_bps: 8500,
  threshold_cents: 0,
  cap_cents: 0,
  settlement_trigger: 'approval',
  effective_date: '2020-01-01',
  annual_year: 2026,
  opening_base_cents: 0,
  opening_firm_cents: 0,
  annual_data_confirmed: false,
  created_at: '2026-11-09T00:00:00.000Z',
};
function show(
  handler: (request: FinanceRequest) => Promise<FinanceResponse>,
  projects: Matter[] = [project],
) {
  const finance = vi.fn((request: FinanceRequest | { operation: string }) =>
    request.operation.startsWith('m_')
      ? Promise.resolve({
          ok: true,
          kind: 'management',
          receipt: null,
          evidence: null,
          effect: null,
          state: {
            version: 0,
            default_rule_id: null,
            projects: [],
            rules: [
              { ...ruleValue, id: ruleA },
              { ...ruleValue, id: ruleB, name: '合成规则B' },
            ],
            bindings: [{ project_id: project.id, rule_id: ruleA }],
            allocations: [],
            payouts: [],
          },
        })
      : handler(request as FinanceRequest),
  );
  window.caselite = {
    finance,
    agent: vi.fn(async () => ({
      ok: true,
      configured: false,
      model: 'gpt-4.1-mini',
      providers: { openai: false, deepseek: false },
      runs: [],
    })),
    catalog: vi.fn(async () => ({ ok: true, projects, documents: [] })),
  } as unknown as Window['caselite'];
  const onDirty = vi.fn();
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <FinanceView initialProject={project.id} onDirty={onDirty} />
    </QueryClientProvider>,
  );
  return { finance, onDirty };
}
async function register() {
  fireEvent.change(await screen.findByLabelText('合同编号'), { target: { value: 'SYNTH' } });
  fireEvent.change(screen.getByLabelText('合同金额（元）'), { target: { value: '1.00' } });
  fireEvent.change(screen.getByLabelText('第 1 期金额（元）'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('第 1 期到期日'), { target: { value: '2020-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: '确认登记合同' }));
}

it('checks the lost ACK without writing again and waits for a successful readback', async () => {
  let saved = false;
  let readsAfterWrite = 0;
  const { finance, onDirty } = show(async (request) => {
    if (request.operation === 'register_contract') {
      saved = true;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' };
    }
    if (request.operation === 'status')
      return {
        ok: true,
        kind: 'status',
        project_id: project.id,
        receipt: request.idempotency_key,
        evidence: {
          operation: 'register_contract',
          target_id: project.id,
          activity_id: crypto.randomUUID(),
        },
      };
    if (saved && ++readsAfterWrite === 1)
      return { ok: false, code: 'UNAVAILABLE', message: '合成读失败' };
    return read(saved);
  });
  await register();
  fireEvent.click(await screen.findByRole('button', { name: '核对原提交' }));
  await screen.findByText('已查到提交凭据，账本读回失败，请再次核对。');
  expect(screen.queryByRole('button', { name: '重试原提交' })).toBeNull();
  expect(onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await screen.findByText('已保存并读回账本。');
  expect(
    finance.mock.calls
      .map(([request]) => request.operation)
      .filter((operation) => !operation.startsWith('m_')),
  ).toEqual(['read', 'register_contract', 'status', 'read', 'status', 'read']);
  expect(onDirty).toHaveBeenLastCalledWith(false);
});

it('explicitly retries an absent receipt with the same key and payload', async () => {
  let writes = 0;
  const { finance } = show(async (request) => {
    if (request.operation === 'register_contract') {
      if (++writes === 1) return { ok: false, code: 'UNAVAILABLE', message: '合成事务失败' };
      return read(true, request.idempotency_key);
    }
    if (request.operation === 'status')
      return {
        ok: true,
        kind: 'status',
        project_id: project.id,
        receipt: request.idempotency_key,
        evidence: null,
      };
    return read(false);
  });
  await register();
  fireEvent.click(await screen.findByRole('button', { name: '核对原提交' }));
  const retry = await screen.findByRole('button', { name: '重试原提交' });
  expect(writes).toBe(1);
  fireEvent.click(retry);
  await screen.findByText('已保存并读回账本。');
  const [first, second] = finance.mock.calls.flatMap(([request]) =>
    request.operation === 'register_contract' ? [request] : [],
  );
  expect(second.request_id).not.toBe(first.request_id);
  expect({ ...second, request_id: first.request_id }).toEqual(first);
});

it('keeps cents exact through the safe integer boundary and distinguishes zero from no ledger', () => {
  expect(parseCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  expect(formatCents(Number.MAX_SAFE_INTEGER)).toBe('90,071,992,547,409.91');
  for (const invalid of ['90071992547409.92', '-0.01', '1.001', '1e3'])
    expect(parseCents(invalid)).toBe(0);
  expect(formatCents(0)).toBe('0');
  expect(formatCents(null)).toBe('—');
});

it('holds a draft on rejection until explicitly discarded and refuses an outdated ledger ACK', async () => {
  let attempt = 0;
  const { onDirty } = show(async (request) => {
    if (request.operation !== 'register_contract') return read(false);
    if (++attempt === 1) return { ok: false, code: 'INVALID_REQUEST', message: '合成拒绝' };
    const result = read(true, request.idempotency_key);
    if (!result.ok || result.kind !== 'ledger' || !result.ledger)
      throw new Error('Invalid fixture');
    return { ...result, ledger: { ...result.ledger, installments: [] } };
  });
  await register();
  await screen.findByText('合成拒绝');
  const field = screen.getByLabelText<HTMLInputElement>('合同编号');
  expect(field.value).toBe('SYNTH');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '← 财务一览' }).disabled).toBe(true);
  expect(onDirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '放弃当前输入' }));
  expect(screen.getByLabelText<HTMLInputElement>('合同编号').value).toBe('');
  expect(onDirty).toHaveBeenLastCalledWith(false);
  await register();
  await screen.findByRole('button', { name: '核对原提交' });
  expect(screen.queryByText('已保存并读回账本。')).toBeNull();
  expect(onDirty).toHaveBeenLastCalledWith(true);
});

it('filters known balances without changing the open ledger or treating missing amounts as zero', async () => {
  const projects: Matter[] = [
    { ...project, outstanding_cents: 101 },
    { ...project, id: crypto.randomUUID(), title: '合成结清项目', outstanding_cents: 0 },
    { ...project, id: crypto.randomUUID(), title: '合成未建账项目' },
  ];
  const { finance } = show(async () => read(true), projects);
  await screen.findByTestId('finance-outstanding');
  fireEvent.click(await screen.findByRole('button', { name: '← 财务一览' }));
  const list = await screen.findByRole('table', { name: '财务项目列表' });
  const totals = screen.getByLabelText('筛选结果总览');
  expect(within(totals).getByText('1.01')).toBeDefined();
  fireEvent.change(screen.getByLabelText('建账状态'), { target: { value: 'unregistered' } });
  expect(within(list).getByRole('button', { name: '合成未建账项目 →' })).toBeDefined();
  expect(within(totals).getByText('—')).toBeDefined();
  fireEvent.change(screen.getByLabelText('建账状态'), { target: { value: 'registered' } });
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索财务项目' }), {
    target: { value: '结清' },
  });
  expect(within(list).getByRole('button', { name: '合成结清项目 →' })).toBeDefined();
  expect(within(within(totals).getByText('客户待收').parentElement!).getByText('0')).toBeDefined();
  expect(screen.getByRole('heading', { name: project.title })).toBeDefined();
  expect(finance.mock.calls.filter(([request]) => request.operation === 'read')).toHaveLength(1);
});

it('keeps the original client-payment identity when a second rule draft exists and the ACK is unknown', async () => {
  const { finance, onDirty } = show(async (request) => {
    if (request.operation === 'record_payment')
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成客户收款回执丢失' };
    if (request.operation === 'status')
      return {
        ok: true,
        kind: 'status',
        project_id: project.id,
        receipt: request.idempotency_key,
        evidence: null,
      };
    return read(true);
  });
  fireEvent.change(await screen.findByLabelText('本案结算规则'), { target: { value: ruleB } });
  fireEvent.change(screen.getByLabelText('分配到期款'), {
    target: { value: ledger.installments[0].id },
  });
  fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '确认登记收款' }));
  await screen.findByText('合成客户收款回执丢失');
  expect(screen.queryByRole('button', { name: '放弃未保存的财务输入' })).toBeNull();
  expect(screen.queryByRole('button', { name: '放弃当前输入' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await screen.findByRole('button', { name: '重试原提交' });
  const writes = finance.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === 'record_payment');
  expect(writes).toHaveLength(1);
  expect(finance.mock.calls.find(([request]) => request.operation === 'status')?.[0]).toMatchObject(
    { idempotency_key: 'idempotency_key' in writes[0] ? writes[0].idempotency_key : '' },
  );
  expect(onDirty).toHaveBeenLastCalledWith(true);
});
