import { expect, it } from 'vitest';
import { resolveReminderTime, createReminderApplication } from './reminder-application';
it('resolves DST gaps, explicit overlap choices, half-hour changes and extreme offsets without using system timezone', () => {
  expect(resolveReminderTime('2026-03-08', '02:30', 'America/New_York')).toEqual([]);
  expect(resolveReminderTime('2026-11-01', '01:30', 'America/New_York')).toEqual([
    '2026-11-01T05:30:00.000Z',
    '2026-11-01T06:30:00.000Z',
  ]);
  expect(resolveReminderTime('2026-10-04', '02:15', 'Australia/Lord_Howe')).toEqual([]);
  expect(resolveReminderTime('2026-01-01', '00:15', 'Pacific/Kiritimati')).toEqual([
    '2025-12-31T10:15:00.000Z',
  ]);
  expect(resolveReminderTime('2026-01-01', '00:15', 'Asia/Kathmandu')).toEqual([
    '2025-12-31T18:30:00.000Z',
  ]);
  expect(resolveReminderTime('1999-12-31', '09:00', 'UTC')).toEqual([]);
});
it('rejects unknown fields, invalid zone and unconfirmed or mismatched instants before the port', () => {
  let calls = 0;
  const app = createReminderApplication({
    execute(request) {
      if (request.operation === 'receipt')
        return { ok: false, code: 'NOT_FOUND', message: 'synthetic' };
      calls++;
      throw new Error('unexpected');
    },
    claimDue() {
      return [];
    },
    recordAttempt() {},
  });
  const base = {
    protocol_version: 1,
    operation: 'resolve',
    date: '2026-01-01',
    time: '09:00',
    timezone: 'UTC',
  };
  expect(app.execute({ ...base, timezone: 'Unknown/Zone' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(app.execute({ ...base, extra: true })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(app.execute({ ...base, date: '2026-02-30' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  const id = '5af8361e-05c9-487f-8c51-878118277875';
  const cmd = {
    ...base,
    operation: 'schedule',
    request_id: id,
    idempotency_key: id,
    reminder_id: id,
    task_id: id,
    expected_version: 0,
    instant: '2026-01-01T10:00:00.000Z',
    confirmed: true,
  };
  expect(app.execute(cmd)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(app.execute({ ...cmd, confirmed: false })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(calls).toBe(0);
});
