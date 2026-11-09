// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import { useFinanceManagement } from './useFinanceManagement';
import type { FinanceManagementRequest, FinanceManagementSuccess, FinanceRule } from './types';
afterEach(cleanup);
const values = {
  name: '  合成20% ',
  firm_name: ' 合成律所 ',
  method: 'firm_percent',
  rate_bps: 2000,
  second_rate_bps: 8500,
  threshold_cents: 0,
  cap_cents: 0,
  settlement_trigger: 'approval',
  effective_date: '2026-11-09',
  annual_year: 2026,
  opening_base_cents: 0,
  opening_firm_cents: 0,
  annual_data_confirmed: false,
} satisfies Omit<FinanceRule, 'id' | 'created_at'>;
const initial = (): FinanceManagementSuccess => ({
  ok: true,
  kind: 'management',
  receipt: null,
  evidence: null,
  effect: null,
  state: {
    version: 0,
    default_rule_id: null,
    rules: [],
    projects: [],
    bindings: [],
    allocations: [],
    payouts: [],
  },
});
it('normalizes the original idempotent input and recovers a lost ACK without creating another rule', async () => {
  let saved: FinanceManagementSuccess | undefined;
  const api = vi.fn(async (request: FinanceManagementRequest) => {
    if (request.operation === 'm_read') return saved ?? initial();
    if (request.operation === 'm_save_rule') {
      const rule = {
        ...request.values,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      saved = {
        ...initial(),
        receipt: request.idempotency_key,
        evidence: {
          operation: request.operation,
          target_id: rule.id,
          event_id: crypto.randomUUID(),
        },
        effect: rule,
        state: { ...initial().state, rules: [rule] },
      };
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成丢失回执' };
    }
    if (request.operation === 'm_status') return saved!;
    throw Error('Unexpected request');
  });
  window.caselite = { finance: api } as unknown as Window['caselite'];
  const client = createWorkbenchQueryClient();
  const { result } = renderHook(() => useFinanceManagement(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.state).toBeDefined());
  await act(async () => {
    result.current.markDirty();
    await result.current.submit({ operation: 'm_save_rule', values });
  });
  expect(result.current.pending).toBeDefined();
  await act(async () => {
    expect(await result.current.recover()).toBe(true);
  });
  expect(result.current.pending).toBeUndefined();
  expect(result.current.dirty).toBe(false);
  const writes = api.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === 'm_save_rule');
  expect(writes).toHaveLength(1);
  expect(writes[0].values).toMatchObject({ name: '合成20%', firm_name: '合成律所' });
  expect(api.mock.calls.find(([request]) => request.operation === 'm_status')?.[0]).toMatchObject({
    idempotency_key: writes[0].idempotency_key,
  });
});
