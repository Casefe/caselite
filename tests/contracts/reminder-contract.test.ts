import { expect, it, vi } from 'vitest';
import { reminderRequestSchema } from '../../packages/contracts/src';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
import { randomUUID } from 'node:crypto';
it('keeps reminder privileges outside the renderer request union and requires scope, CAS and explicit confirmation', () => {
  const id = randomUUID(),
    base = {
      protocol_version: 1,
      request_id: id,
      idempotency_key: id,
      operation: 'schedule',
      reminder_id: id,
      task_id: id,
      expected_version: 0,
      date: '2026-11-07',
      time: '09:00',
      timezone: 'Asia/Shanghai',
      instant: '2026-11-07T01:00:00.000Z',
      confirmed: true,
    };
  expect(reminderRequestSchema.safeParse(base).success).toBe(true);
  for (const patch of [
    { confirmed: false },
    { expected_version: -1 },
    { task_id: undefined },
    { timezone: '+01:00' },
    { operation: 'claimDue' },
    { workspace_id: 'other' },
    { path: '/synthetic' },
  ])
    expect(reminderRequestSchema.safeParse({ ...base, ...patch }).success).toBe(false);
});
it('uses a fixed reminder channel and treats malformed/timeout replies as unknown, never successful delivery', async () => {
  const invoke = vi.fn(async () => ({ ok: true, reminders: [], choices: [], receipt: null }));
  const api = createCaseLitePreloadApi(invoke);
  const request = { protocol_version: 1 as const, operation: 'list' as const };
  expect(await api.reminder(request)).toMatchObject({ ok: true });
  expect(invoke).toHaveBeenCalledWith('caselite:reminder:v1', request);
  const broken = createCaseLitePreloadApi(async () => ({
    ok: true,
    reminders: [{ status: 'delivered' }],
  }));
  expect(await broken.reminder(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  const rejected = createCaseLitePreloadApi(async () => {
    throw new Error('synthetic');
  });
  expect(await rejected.reminder(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
});
