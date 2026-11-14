// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../../../preload/caselite-api';
import CalendarTaskRow from './CalendarTaskRow';
afterEach(cleanup);
it('separates calendar completion from navigation and retains the original date metadata', () => {
  const task: Task = {
    id: 'calendar-completion',
    title: '日历完成入口',
    objective: '',
    status: 'todo',
    priority: 0,
    due_date: '2030-01-02',
    start_date: '2030-01-01',
    version: 1,
    matter_id: null,
    document_id: 'doc',
    body_id: 'body',
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2030-01-01',
  };
  const complete = vi.fn(),
    open = vi.fn();
  render(
    <CalendarTaskRow
      task={task}
      date="2030-01-02"
      selected={false}
      blocked={false}
      onOpen={open}
      completion={{ complete, busyIds: [], blocked: false }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '完成任务：日历完成入口' }));
  expect(complete).toHaveBeenCalledExactlyOnceWith(task);
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText('开始 2030-01-01')).toBeTruthy();
  expect(screen.getByText('截止 2030-01-02')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '日历完成入口' }));
  expect(open).toHaveBeenCalledExactlyOnceWith(task.id);
});
