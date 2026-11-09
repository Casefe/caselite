// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TaskDatePicker from './TaskDatePicker';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);
it('confirms only date fields from a richer task, and never submits the surrounding creation form', () => {
  const change = vi.fn(),
    submit = vi.fn((e: React.FormEvent) => e.preventDefault()),
    editing = vi.fn();
  render(
    <form onSubmit={submit}>
      <TaskDatePicker
        value={
          { start_date: null, due_date: null, status: 'todo' } as {
            start_date: null;
            due_date: null;
          }
        }
        onChange={change}
        onEditing={editing}
      />
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: '设置任务日期' }));
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2030-11-10' } });
  fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2030-11-12' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确定日期' }));
  expect(change).toHaveBeenCalledExactlyOnceWith({
    start_date: '2030-11-10',
    due_date: '2030-11-12',
  });
  expect(submit).not.toHaveBeenCalled();
  expect(editing).toHaveBeenLastCalledWith(false);
});
it('keeps invalid ranges in the dialog and cancels without emitting a write', () => {
  const change = vi.fn();
  render(
    <TaskDatePicker
      value={{ start_date: '2030-11-10', due_date: '2030-11-12' }}
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '设置任务日期' }));
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2030-11-13' } });
  fireEvent.click(screen.getByRole('button', { name: '确定日期' }));
  expect(screen.getByRole('alert').textContent).toContain('不能晚于');
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '设置任务日期' }));
  expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2030-11-10');
});
