// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { contactEntrySchema, type ContactSourceRef } from '@caselite/contracts';
import { contactTimeline, readContactSources } from './contact-activity';
const task = '11111111-1111-4111-8111-111111111111';
const material = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const payment = '44444444-4444-4444-8444-444444444444';
afterEach(() => vi.unstubAllGlobals());
it('merges original owners, deduplicates task materials and saved runs, marks unknown dates, partial failures and pagination', async () => {
  vi.stubGlobal('caselite', {
    agent: async () => ({ ok: true, runs: [{ id: runId, prompt: '原问题', output: '原回答' }] }),
    material: async () => ({
      ok: true,
      materials: [{ id: material, task_id: task, name: '合成微信截图.png' }],
    }),
    finance: async () => ({
      ok: true,
      kind: 'ledger',
      ledger: {
        payments: [
          {
            id: payment,
            amount_cents: 100,
            committed_at: '2026-11-10T10:00:00Z',
            reversed_at: '2026-11-10T11:00:00Z',
          },
        ],
      },
    }),
    catalog: async () => ({
      ok: true,
      activity: [
        { id: task, origin: 'task', operation: 'save', committed_at: '2026-11-10T12:00:00Z' },
      ],
      activity_has_more: true,
    }),
  });
  const refs: ContactSourceRef[] = [
    { kind: 'material', id: material, scope: task },
    { kind: 'run', id: runId, scope: 'home' },
    { kind: 'payment', id: payment, scope: task },
  ];
  const result = await readContactSources(refs, [task]);
  expect(result.items.filter((item) => item.id === `material:${material}`)).toHaveLength(1);
  expect(result.items.find((item) => item.id === `material:${material}`)).toMatchObject({
    date: null,
  });
  expect(result.items.find((item) => item.id === `payment:${payment}`)?.title).toBe(
    '已冲销 · 收款 ¥1.00',
  );
  expect(result.more).toBe(true);
  expect(result.partial).toBe(false);
  const entry = contactEntrySchema.parse({
    id: task,
    contact_id: task,
    kind: 'communication',
    title: '已确认记录',
    channel: 'wechat',
    occurred_on: null,
    content: '确认内容',
    body_id: task,
    body_revision: 1,
    version: 1,
    source_run_id: runId,
    created_at: '2026-11-10',
    updated_at: '2026-11-10',
  });
  expect(
    contactTimeline([entry], result.items).filter((item) => item.source?.kind === 'run'),
  ).toHaveLength(0);
  window.caselite.agent = vi.fn(async () => {
    throw Error('访问失效');
  });
  const partial = await readContactSources(refs, [task]);
  expect(partial.partial).toBe(true);
  expect(partial.items.some((item) => item.id === `run:${runId}`)).toBe(false);
  expect(partial.items.some((item) => item.id === `payment:${payment}`)).toBe(true);
});
