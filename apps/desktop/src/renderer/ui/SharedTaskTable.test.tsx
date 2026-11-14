// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../../preload/caselite-api';
import SharedTaskTable, { taskOptionalColumns as sharedColumns } from './SharedTaskTable';
import { taskOptionalColumns as workspaceColumns } from './Workspace';

afterEach(cleanup);
const task: Task = {
  id: 'synthetic-task-a',
  title: '合成任务甲',
  objective: '',
  status: 'todo',
  priority: 2,
  due_date: '2030-11-12',
  version: 1,
  matter_id: null,
  document_id: 'doc-a',
  body_id: 'body-a',
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2030-11-10',
};

it('separates the complete action from row selection and bulk selection', () => {
  const onOpen = vi.fn(),
    onSelect = vi.fn(),
    onSelection = vi.fn(),
    onComplete = vi.fn();
  render(
    <SharedTaskTable
      tasks={[task]}
      compact
      onOpen={onOpen}
      onSelect={onSelect}
      onSelection={onSelection}
      onComplete={onComplete}
    />,
  );
  const circle = screen.getByRole('button', { name: '完成任务：合成任务甲' });
  fireEvent.click(circle);
  fireEvent.doubleClick(circle);
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith(task);
  expect(onOpen).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: '勾选任务：合成任务甲' }));
  expect(onSelection).toHaveBeenCalledWith([task.id]);
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it('shows completed status without inventing a reverse transition and hides a missing action', () => {
  const onComplete = vi.fn(),
    onOpen = vi.fn();
  const done = { ...task, status: 'done' as const };
  const { rerender } = render(
    <SharedTaskTable tasks={[done]} onOpen={onOpen} onComplete={onComplete} />,
  );
  const circle = screen.getByRole('button', {
    name: '已完成任务：合成任务甲',
  }) as HTMLButtonElement;
  expect(circle.disabled).toBe(true);
  expect(circle.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(circle);
  expect(onComplete).not.toHaveBeenCalled();
  rerender(<SharedTaskTable tasks={[task]} onOpen={onOpen} />);
  expect(screen.queryByRole('button', { name: '完成任务：合成任务甲' })).toBeNull();
});

it('locks row, title, completion and selection while a task is busy', () => {
  const onOpen = vi.fn(),
    onSelect = vi.fn(),
    onSelection = vi.fn(),
    onComplete = vi.fn();
  render(
    <SharedTaskTable
      tasks={[task]}
      selectedIds={[]}
      busyIds={[task.id]}
      onOpen={onOpen}
      onSelect={onSelect}
      onSelection={onSelection}
      onComplete={onComplete}
    />,
  );
  const row = screen.getByRole('row', { name: '选择任务：合成任务甲' });
  expect(row.getAttribute('aria-busy')).toBe('true');
  expect(
    (within(row).getByRole('button', { name: '合成任务甲' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (within(row).getByRole('button', { name: '完成任务：合成任务甲' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (within(row).getByRole('checkbox', { name: '勾选任务：合成任务甲' }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('checkbox', { name: '全选当前页任务' }) as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(row);
  fireEvent.doubleClick(row);
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(onOpen).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onSelection).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});

it('preserves row selection, keyboard opening, hidden columns and supplied metadata', () => {
  const onOpen = vi.fn(),
    onSelect = vi.fn();
  render(
    <SharedTaskTable
      tasks={[task]}
      compact
      selectedId={task.id}
      onOpen={onOpen}
      onSelect={onSelect}
      hiddenColumns={['project']}
      rowMetadata={() => <span>安排 09:00–10:00</span>}
    />,
  );
  const row = screen.getByRole('row', { name: '选择任务：合成任务甲' });
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(within(row).getByText('安排 09:00–10:00')).toBeTruthy();
  expect(row.querySelector('[data-column="project"]')).toBeNull();
  fireEvent.click(row);
  expect(onSelect).toHaveBeenCalledWith(task.id);
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith(task.id);
  fireEvent.click(within(row).getByRole('button', { name: '合成任务甲' }));
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it('keeps the original row Space behavior for selection, open, and overview modes', () => {
  const onOpen = vi.fn(),
    onSelect = vi.fn(),
    onSelection = vi.fn();
  const { rerender } = render(
    <SharedTaskTable tasks={[task]} onOpen={onOpen} onSelect={onSelect} />,
  );
  let row = screen.getByRole('row', { name: '选择任务：合成任务甲' });
  fireEvent.keyDown(row, { key: ' ' });
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledTimes(1);
  onOpen.mockClear();
  onSelect.mockClear();
  rerender(<SharedTaskTable tasks={[task]} onOpen={onOpen} />);
  row = screen.getByRole('row', { name: '选择任务：合成任务甲' });
  fireEvent.keyDown(row, { key: ' ' });
  expect(onOpen).toHaveBeenCalledTimes(1);
  onOpen.mockClear();
  rerender(
    <SharedTaskTable
      tasks={[task]}
      onOpen={onOpen}
      onSelect={onSelect}
      onSelection={onSelection}
    />,
  );
  row = screen.getByRole('row', { name: '选择任务：合成任务甲' });
  fireEvent.keyDown(row, { key: ' ' });
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it('does not navigate from done icon children or interactive descendants', () => {
  const onOpen = vi.fn(),
    onSelect = vi.fn(),
    onComplete = vi.fn();
  render(
    <SharedTaskTable
      tasks={[{ ...task, status: 'done' }]}
      onOpen={onOpen}
      onSelect={onSelect}
      onComplete={onComplete}
      rowMetadata={() => <button type="button">附加操作</button>}
    />,
  );
  const mark = screen.getByText('✓');
  fireEvent.click(mark);
  fireEvent.doubleClick(mark);
  const extra = screen.getByRole('button', { name: '附加操作' });
  fireEvent.click(extra);
  fireEvent.doubleClick(extra);
  fireEvent.keyDown(extra, { key: ' ' });
  const title = screen.getByRole('button', { name: '合成任务甲' });
  fireEvent.keyDown(title, { key: ' ' });
  fireEvent.keyDown(title, { key: 'Enter' });
  expect(onOpen).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});

it('does not repeat a double-click after the caller marks the row busy', () => {
  const onOpen = vi.fn(),
    onSelect = vi.fn(),
    onComplete = vi.fn();
  const { rerender } = render(
    <SharedTaskTable tasks={[task]} onOpen={onOpen} onSelect={onSelect} onComplete={onComplete} />,
  );
  const circle = screen.getByRole('button', { name: '完成任务：合成任务甲' });
  fireEvent.click(circle);
  rerender(
    <SharedTaskTable
      tasks={[task]}
      onOpen={onOpen}
      onSelect={onSelect}
      onComplete={onComplete}
      busyIds={[task.id]}
    />,
  );
  fireEvent.click(circle);
  fireEvent.doubleClick(circle);
  const row = screen.getByRole('row', { name: '选择任务：合成任务甲' });
  fireEvent.keyDown(row, { key: ' ' });
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it('keeps Workspace column exports backed by the single shared UI contract', () => {
  expect(workspaceColumns).toBe(sharedColumns);
  expect(sharedColumns).toEqual({ project: '关联项目', owner: '负责人', 'due-date': '截止日期' });
});
