// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ActivityList from './ActivityList';
afterEach(cleanup);
it('keeps committed history after query and navigation failures, then retries the guarded target', async () => {
  let fail = false,
    blocked = true;
  const scope = { type: 'project' as const, id: 'project' };
  const event = {
    id: 'event',
    origin: 'task',
    target_id: 'task',
    target_type: 'task',
    operation: 'create',
    committed_at: '2026-11-06T01:00:00Z',
    actor: null,
    recorded_version: null,
  };
  const catalog = vi.fn(async (r) =>
    r.operation === 'list_activity'
      ? fail
        ? { ok: false, message: '查询失败' }
        : { ok: true, activity: [event], activity_has_more: false }
      : blocked
        ? { ok: false, message: '目标已归档' }
        : {
            ok: true,
            activity_target: { type: 'task', id: 'task', task_id: 'task', current_version: 2 },
          },
  );
  window.caselite = { catalog } as unknown as Window['caselite'];
  const open = vi.fn();
  render(<ActivityList scope={scope} onTask={open} />);
  await screen.findByText('创建任务');
  expect(screen.getByText(/操作者未记录/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /打开当前任务/ }));
  await screen.findByText('目标已归档');
  expect(open).not.toHaveBeenCalled();
  blocked = false;
  fireEvent.click(screen.getByRole('button', { name: /打开当前任务/ }));
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith('task'));
  fail = true;
  fireEvent.click(screen.getByText('重新读取活动'));
  await screen.findByText('查询失败');
  expect(screen.getByText('创建任务')).toBeTruthy();
  expect(
    catalog.mock.calls.every(([r]) => ['list_activity', 'activity_target'].includes(r.operation)),
  ).toBe(true);
});

it('ignores a late target response after the parent switches its keyed scope', async () => {
  let resolveTarget!: (value: unknown) => void;
  const event = {
    id: 'old-event',
    origin: 'task',
    target_id: 'old-task',
    target_type: 'task',
    operation: 'create',
    committed_at: '2026-11-06T01:00:00Z',
    actor: null,
    recorded_version: null,
  };
  window.caselite = {
    catalog: vi.fn(async (r) =>
      r.operation === 'activity_target'
        ? new Promise((resolve) => {
            resolveTarget = resolve;
          })
        : {
            ok: true,
            activity: r.scope.id === 'old-task' ? [event] : [],
            activity_has_more: false,
          },
    ),
  } as unknown as Window['caselite'];
  const open = vi.fn();
  const { rerender } = render(
    <ActivityList key="old-task" scope={{ type: 'task', id: 'old-task' }} onTask={open} />,
  );
  await screen.findByText('创建任务');
  fireEvent.click(screen.getByRole('button', { name: /打开当前任务/ }));
  rerender(<ActivityList key="new-task" scope={{ type: 'task', id: 'new-task' }} onTask={open} />);
  await act(async () => {
    resolveTarget({
      ok: true,
      activity_target: { type: 'task', id: 'old-task', task_id: 'old-task', current_version: 1 },
    });
  });
  await screen.findByText('还没有可显示的成功活动。');
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByText('创建任务')).toBeNull();
});

it('compact keeps three committed events in query order and routes the verified project target', async () => {
  const events = [4, 3, 2, 1].map((n) => ({
    id: `event-${n}`,
    origin: 'catalog',
    target_id: 'project',
    target_type: 'project',
    operation: 'create_project',
    committed_at: `2026-11-06T0${n}:00:00Z`,
    actor: null,
    recorded_version: null,
  }));
  const catalog = vi.fn(async (r) =>
    r.operation === 'list_activity'
      ? { ok: true, activity: events, activity_has_more: true }
      : {
          ok: true,
          activity_target: { type: 'project', id: 'verified-project', current_version: 2 },
        },
  );
  window.caselite = { catalog } as unknown as Window['caselite'];
  const open = vi.fn();
  const view = render(
    <ActivityList scope={{ type: 'project', id: 'p' }} onTask={vi.fn()} onProject={open} compact />,
  );
  await screen.findAllByText('创建项目');
  expect(
    Array.from(view.container.querySelectorAll('[data-activity-id]')).map((e) =>
      e.getAttribute('data-activity-id'),
    ),
  ).toEqual(['event-4', 'event-3', 'event-2']);
  expect(screen.queryByText('下一页活动')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /打开当前项目/ })[0]);
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith('verified-project'));
  expect(catalog.mock.calls.at(-1)?.[0]).toMatchObject({
    operation: 'activity_target',
    scope: { type: 'project', id: 'p' },
    event_id: 'event-4',
  });
});
