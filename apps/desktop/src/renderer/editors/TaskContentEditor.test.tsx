// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest, TaskResponse } from '../../preload/caselite-api';
import TaskContentEditor from './TaskContentEditor';

afterEach(cleanup);
function show() {
  const task: Task = {
    id: crypto.randomUUID(),
    title: '完整的任务标题',
    objective: '已保存的说明',
    status: 'todo',
    priority: 0,
    due_date: null,
    version: 1,
    matter_id: null,
    document_id: crypto.randomUUID(),
    body_id: crypto.randomUUID(),
    body_revision: 0,
    editor_schema: 1,
    updated_at: '2026-11-11',
  };
  const api = vi.fn(async (request: TaskRequest): Promise<TaskResponse> => {
    if (request.operation !== 'update') throw new Error('本测试只允许原保存入口');
    return {
      ok: true,
      tasks: [{ ...task, title: request.title, objective: request.objective, version: 2 }],
      receipt: request.idempotency_key,
      state: null,
    };
  });
  window.caselite = { task: api } as unknown as Window['caselite'];
  const saved = vi.fn(),
    dirty = vi.fn();
  const props = { task, initial: null, onDirty: dirty, onSaved: saved };
  return { ...render(<TaskContentEditor {...props} />), api, saved, props };
}

it('soft-wraps one controlled title while retaining single-line text and original save payload', async () => {
  const { api, saved, props, rerender } = show();
  const title = await screen.findByRole('textbox', { name: '任务标题' });
  expect(title.tagName).toBe('TEXTAREA');
  fireEvent.change(title, { target: { value: '单行\r\n标题\n保留' } });
  expect((title as HTMLTextAreaElement).value).toBe('单行标题保留');
  const enter = createEvent.keyDown(title, { key: 'Enter' });
  fireEvent(title, enter);
  expect(enter.defaultPrevented).toBe(true);
  expect(api).not.toHaveBeenCalled();
  const editor = await screen.findByTestId('task-content-editor');
  rerender(<TaskContentEditor {...props} disabled />);
  rerender(<TaskContentEditor {...props} />);
  expect(screen.getByLabelText('任务标题')).toBe(title);
  expect(screen.getByTestId('task-content-editor')).toBe(editor);
  await waitFor(() => expect(editor.getAttribute('contenteditable')).toBe('true'));
  fireEvent.keyDown(title, { key: 'Enter', metaKey: true });
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledTimes(1);
  expect(api.mock.calls[0]![0]).toMatchObject({
    operation: 'update',
    task_id: props.task.id,
    expected_version: 1,
    title: '单行标题保留',
    objective: props.task.objective,
  });
  const request = api.mock.calls[0]![0];
  expect(request.operation === 'update' && request.objective_state!.length > 0).toBe(true);
});

it('does not intercept composition confirmation or legacy 229 before the normal save shortcut', async () => {
  const { api, saved } = show();
  const title = await screen.findByRole('textbox', { name: '任务标题' });
  fireEvent.change(title, { target: { value: '中文标题草稿' } });
  fireEvent.compositionStart(title);
  for (const input of [
    { key: 'Enter', metaKey: true },
    { key: 'Enter', ctrlKey: true, isComposing: true },
    { key: 'Enter' },
  ]) {
    const event = createEvent.keyDown(title, input);
    fireEvent(title, event);
    expect(event.defaultPrevented).toBe(false);
  }
  fireEvent.compositionEnd(title);
  const finishing = createEvent.keyDown(title, { key: 'Enter', ctrlKey: true, keyCode: 229 });
  fireEvent(title, finishing);
  expect(finishing.defaultPrevented).toBe(false);
  expect(api).not.toHaveBeenCalled();
  await screen.findByTestId('task-content-editor');
  fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api).toHaveBeenCalledTimes(1);
});
