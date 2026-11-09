import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTaskApplication } from '@caselite/application';
import { emptyTaskCalendar, taskRequestSchema, type TaskRequest } from '@caselite/contracts';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
it('guards the existing typed Task IPC boundary for calendar values, rejects forged scope and classifies query failures as reads', async () => {
  const command = {
    ...identity(),
    operation: 'update_calendar' as const,
    task_id: randomUUID(),
    expected_version: 1,
    calendar: { ...emptyTaskCalendar, planned_date: '2024-02-29' },
  };
  expect(taskRequestSchema.safeParse(command).success).toBe(true);
  for (const bad of [
    { ...command, workspace: 'other' },
    { ...command, actor: 'admin' },
    { ...command, path: '/tmp/forbidden' },
    { ...command, calendar: { ...command.calendar, planned_date: '2026-02-30' } },
    { ...command, calendar: { ...command.calendar, source: 'AI' } },
  ])
    expect(taskRequestSchema.safeParse(bad).success).toBe(false);
  const port = {
      execute: vi.fn(() => {
        throw Error('private storage path');
      }),
    },
    app = createTaskApplication(port);
  expect(app.execute({ ...command, actor: 'forged' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(port.execute).not.toHaveBeenCalled();
  const query: TaskRequest = {
    protocol_version: 1,
    operation: 'calendar_query',
    query: {
      view: 'important',
      date: '2026-11-09',
      from: '2026-11-01',
      to: '2026-11-30',
      home: false,
      include_closed: false,
      include_overdue: false,
      offset: 0,
    },
  };
  expect(app.execute(query)).toMatchObject({ ok: false, code: 'READ_FAILED' });
  const invoke = vi.fn(async () => ({
    ok: true,
    tasks: [],
    state: null,
    receipt: null,
    calendar_types: [],
    calendar_pending_count: 2,
    page: { offset: 0, total: 0, has_more: false },
  }));
  const api = createCaseLitePreloadApi(invoke);
  expect(await api.task(query)).toMatchObject({ ok: true, calendar_pending_count: 2 });
  expect(invoke).toHaveBeenCalledWith('caselite:task:v1', query);
  const unknown = createCaseLitePreloadApi(async () => ({
    ok: true,
    tasks: [],
    receipt: 'not-an-id',
  }));
  expect(await unknown.task(command)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
});
