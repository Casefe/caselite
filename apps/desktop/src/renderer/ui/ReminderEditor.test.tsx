// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Reminder, ReminderRequest, ReminderResponse } from '../../preload/caselite-api';
import ReminderEditor from './ReminderEditor';
import ReminderInbox from './ReminderInbox';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const task = crypto.randomUUID(),
  id = crypto.randomUUID();
const reminder = (patch: Partial<Reminder> = {}): Reminder => ({
  id,
  task_id: task,
  task_title: '合成提醒',
  date: '2026-01-01',
  time: '09:00',
  timezone: 'Asia/Shanghai',
  instant: '2026-01-01T01:00:00.000Z',
  status: 'scheduled',
  version: 1,
  plan_revision: 1,
  read_at: null,
  attempt: null,
  attempted_at: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  ...patch,
});
const success = (
  rows: Reminder[] = [],
  receipt: string | null = null,
  choices: string[] = [],
): ReminderResponse => ({ ok: true, reminders: rows, receipt, choices });
const failed = (
  code: 'READ_FAILED' | 'RESULT_UNKNOWN' | 'NOT_FOUND' = 'READ_FAILED',
): ReminderResponse => ({ ok: false, code, message: '合成失败' });
function api(fn: (r: ReminderRequest) => Promise<ReminderResponse>) {
  window.caselite = { reminder: vi.fn(fn) } as unknown as Window['caselite'];
  return window.caselite.reminder;
}
async function draft() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '设置提醒' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '设置提醒' }));
  fireEvent.change(screen.getByLabelText('提醒日期'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('提醒时区'), { target: { value: 'Asia/Shanghai' } });
  fireEvent.click(screen.getByText('验证日期与时区'));
  await screen.findByLabelText('提醒时间点');
  fireEvent.click(screen.getByRole('checkbox'));
}
it('locks confirmed ACK with failed reread; recovery only reads, never replays or changes the committed command', async () => {
  let saved = false,
    reads = 0;
  const calls = api(async (r) => {
    if (r.operation === 'resolve') return success([], null, ['2026-01-01T01:00:00.000Z']);
    if (r.operation === 'schedule') {
      saved = true;
      return success([reminder({ id: r.reminder_id })], r.idempotency_key);
    }
    if (r.operation === 'list') {
      if (saved && ++reads === 1) return failed();
      return success(saved ? [reminder()] : []);
    }
    return failed();
  });
  render(<ReminderEditor taskId={task} onBlocked={vi.fn()} />);
  await draft();
  fireEvent.click(screen.getByText('确认保存提醒'));
  await screen.findByText('重试读取已保存提醒');
  expect((screen.getByLabelText('提醒日期') as HTMLInputElement).disabled).toBe(false);
  expect(screen.getByLabelText('提醒日期').closest('fieldset')?.disabled).toBe(true);
  expect((screen.getByText('取消编辑') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('重试读取已保存提醒'));
  await screen.findByText('改期 / 重新设定');
  expect(vi.mocked(calls).mock.calls.filter(([r]) => r.operation === 'schedule')).toHaveLength(1);
});
it('retains the exact original key after unknown receipt and rejects a mismatched ACK', async () => {
  let command: Extract<ReminderRequest, { operation: 'schedule' }> | undefined;
  const calls = api(async (r) => {
    if (r.operation === 'list') return success();
    if (r.operation === 'resolve') return success([], null, ['2026-01-01T01:00:00.000Z']);
    if (r.operation === 'schedule') {
      command = r;
      return failed('RESULT_UNKNOWN');
    }
    if (r.operation === 'receipt')
      return success(
        [reminder({ id: command!.reminder_id, task_id: crypto.randomUUID() })],
        r.idempotency_key,
      );
    return failed();
  });
  render(<ReminderEditor taskId={task} />);
  await draft();
  fireEvent.click(screen.getByText('确认保存提醒'));
  await screen.findByText('核对原提交');
  fireEvent.click(screen.getByText('核对原提交'));
  await screen.findByText('提醒回执与原提交不一致，请核对原提交。');
  expect(
    vi.mocked(calls).mock.calls.filter(([r]) => r.operation === 'receipt')[0][0],
  ).toMatchObject({ idempotency_key: command!.idempotency_key });
  expect(screen.getByLabelText('提醒日期').closest('fieldset')?.disabled).toBe(true);
});
it('ignores an old Task list response after identity switches, including old callbacks', async () => {
  let settle!: (r: ReminderResponse) => void;
  const second = crypto.randomUUID(),
    changed = vi.fn(),
    blocked = vi.fn();
  api(async (r) =>
    r.operation === 'list' && r.task_id === task
      ? new Promise((done) => {
          settle = done;
        })
      : success(),
  );
  const view = render(<ReminderEditor taskId={task} onChanged={changed} onBlocked={blocked} />);
  await waitFor(() => expect(settle).toBeTypeOf('function'));
  view.rerender(<ReminderEditor taskId={second} onChanged={changed} onBlocked={blocked} />);
  await screen.findByText('尚未设置提醒');
  await act(async () => settle(success([reminder()])));
  expect(screen.queryByTestId('saved-reminder')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(blocked).not.toHaveBeenCalled();
});
it('does not overwrite changed form choices with a late resolution after unmount', async () => {
  let settle!: (r: ReminderResponse) => void;
  const blocked = vi.fn(),
    changed = vi.fn();
  api(async (r) =>
    r.operation === 'resolve'
      ? new Promise((done) => {
          settle = done;
        })
      : success(),
  );
  const view = render(<ReminderEditor taskId={task} onBlocked={blocked} onChanged={changed} />);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '设置提醒' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '设置提醒' }));
  fireEvent.change(screen.getByLabelText('提醒日期'), { target: { value: '2026-01-01' } });
  fireEvent.click(screen.getByText('验证日期与时区'));
  view.unmount();
  const count = blocked.mock.calls.length;
  await act(async () => settle(success([], null, ['2026-01-01T01:00:00.000Z'])));
  expect(blocked).toHaveBeenCalledTimes(count);
  expect(changed).not.toHaveBeenCalled();
});
it('shows a newly read item only under read filter and updates its current plan version', async () => {
  let row = reminder();
  api(async (r) => {
    if (r.operation === 'mark_read') {
      row = { ...row, version: 2, read_at: '2026-11-07T00:00:00.000Z' };
      return success([row], r.idempotency_key);
    }
    return success([row]);
  });
  render(<ReminderInbox onOpen={vi.fn()} onBlocked={vi.fn()} />);
  await screen.findByText('合成提醒');
  fireEvent.click(screen.getByText('合成提醒'));
  fireEvent.click(screen.getByText('标为已读'));
  await screen.findByText('没有未读提醒');
  expect(screen.queryByText('返回原任务')).toBeNull();
  fireEvent.click(screen.getByText('已读'));
  await screen.findByText('合成提醒');
  fireEvent.click(screen.getByText('合成提醒'));
  await screen.findByText(/版本 2/);
});
it('ignores an older polling list after a read mutation and keeps recovery usable', async () => {
  let row = reminder(),
    settle: ((r: ReminderResponse) => void) | undefined,
    lists = 0;
  api(async (r) => {
    if (r.operation === 'list') {
      lists++;
      if (!r.task_id && lists === 3)
        return new Promise((done) => {
          settle = done;
        });
      return success([row]);
    }
    if (r.operation === 'mark_read') {
      row = { ...row, version: 2, read_at: '2026-11-07T00:00:00.000Z' };
      return success([row], r.idempotency_key);
    }
    return failed();
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<ReminderInbox onOpen={vi.fn()} onBlocked={vi.fn()} />);
  await screen.findByText('合成提醒');
  fireEvent.click(screen.getByText('合成提醒'));
  await waitFor(() => expect(lists).toBeGreaterThan(1));
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  fireEvent.click(screen.getByText('标为已读'));
  await screen.findByText('没有未读提醒');
  if (settle) await act(async () => settle!(success([reminder()])));
  expect(screen.queryByText('返回原任务')).toBeNull();
});
it.each(['READ_FAILED', 'WRITE_FAILED'] as const)(
  'keeps an unknown Editor command locked after retry %s',
  async (code) => {
    let command: Extract<ReminderRequest, { operation: 'schedule' }> | undefined,
      calls = 0;
    api(async (r) => {
      if (r.operation === 'list') return success();
      if (r.operation === 'resolve') return success([], null, ['2026-01-01T01:00:00.000Z']);
      if (r.operation === 'schedule') {
        calls++;
        if (!command) {
          command = r;
          return failed('RESULT_UNKNOWN');
        }
        expect(r.idempotency_key).toBe(command.idempotency_key);
        return { ok: false, code, message: '原回执读取故障' };
      }
      return failed('NOT_FOUND');
    });
    const blocked = vi.fn();
    render(<ReminderEditor taskId={task} onBlocked={blocked} />);
    await draft();
    fireEvent.click(screen.getByText('确认保存提醒'));
    await screen.findByText('重试原提交');
    fireEvent.click(screen.getByText('重试原提交'));
    await screen.findByText('原回执读取故障');
    expect(calls).toBe(2);
    expect(screen.getByLabelText('提醒日期').closest('fieldset')?.disabled).toBe(true);
    expect((screen.getByText('取消编辑') as HTMLButtonElement).disabled).toBe(true);
    expect(blocked.mock.calls.at(-1)).toEqual([true]);
  },
);
it.each(['READ_FAILED', 'WRITE_FAILED'] as const)(
  'keeps unknown read command and navigation guard after retry %s',
  async (code) => {
    let calls = 0,
      key = '';
    api(async (r) => {
      if (r.operation === 'list') return success([reminder()]);
      if (r.operation === 'mark_read') {
        calls++;
        if (!key) {
          key = r.idempotency_key;
          return failed('RESULT_UNKNOWN');
        }
        expect(r.idempotency_key).toBe(key);
        return { ok: false, code, message: '原已读回执读取故障' };
      }
      return failed('NOT_FOUND');
    });
    const blocked = vi.fn();
    render(<ReminderInbox onOpen={vi.fn()} onBlocked={blocked} />);
    await screen.findByText('合成提醒');
    fireEvent.click(screen.getByText('合成提醒'));
    fireEvent.click(screen.getByText('标为已读'));
    await screen.findByText('重试原已读操作');
    fireEvent.click(screen.getByText('重试原已读操作'));
    await screen.findByText('原已读回执读取故障');
    expect(calls).toBe(2);
    expect((screen.getByText('返回原任务') as HTMLButtonElement).disabled).toBe(true);
    expect(blocked.mock.calls.at(-1)).toEqual([true]);
  },
);
