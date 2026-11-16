// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task } from '../../../preload/caselite-api';
import TaskBoard from './TaskBoard';

afterEach(cleanup);
const task: Task = {
  id: crypto.randomUUID(),
  title: '合成看板任务',
  objective: '',
  status: 'todo',
  priority: 2,
  due_date: null,
  matter_id: null,
  version: 3,
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-15',
};
function setup(patch: Partial<Parameters<typeof TaskBoard>[0]> = {}) {
  const props = {
    tasks: [task],
    queryKey: 'page-A',
    disabled: false,
    busyIds: [] as string[],
    selectedIds: [] as string[],
    onOpen: vi.fn(),
    onStatus: vi.fn(),
    ...patch,
  };
  return { ...render(<TaskBoard {...props} />), props };
}
function transfer() {
  return { setData: vi.fn(), getData: vi.fn(() => task.id), effectAllowed: '', dropEffect: '' };
}
function drag() {
  const dataTransfer = transfer();
  fireEvent.dragStart(screen.getByRole('button', { name: `拖动任务：${task.title}` }), {
    dataTransfer,
  });
  return dataTransfer;
}

it('always renders four columns, labels only page counts and uses original task identity', () => {
  const { props } = setup();
  expect(screen.getAllByRole('region')).toHaveLength(4);
  expect(
    within(screen.getByRole('region', { name: '待办列' })).getByRole('heading').textContent,
  ).toContain('1 项（本页）');
  expect(screen.getAllByText('当前筛选页无任务')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: task.title }));
  expect(props.onOpen).toHaveBeenCalledWith(task.id);
  if (props.onStatus) expect(props.onStatus).not.toHaveBeenCalled();
});
it('keeps all four empty columns when the filtered page is empty', () => {
  setup({ tasks: [] });
  expect(screen.getAllByRole('region')).toHaveLength(4);
  expect(screen.getAllByText('当前筛选页无任务')).toHaveLength(4);
});
it('uses the same target action for internal drag and keyboard select without optimistic movement', () => {
  const { props } = setup();
  const dataTransfer = drag();
  fireEvent.dragOver(screen.getByRole('region', { name: '进行中列' }), { dataTransfer });
  expect(dataTransfer.dropEffect).toBe('move');
  fireEvent.drop(screen.getByRole('region', { name: '进行中列' }), { dataTransfer });
  expect(props.onStatus).toHaveBeenLastCalledWith(task, 'in_progress');
  expect(within(screen.getByRole('region', { name: '待办列' })).getByRole('article')).toBeDefined();
  const select = screen.getByLabelText(`修改任务状态：${task.title}`) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'canceled' } });
  expect(props.onStatus).toHaveBeenLastCalledWith(task, 'canceled');
  expect(select.value).toBe('todo');
  expect(props.onOpen).not.toHaveBeenCalled();
});
it('rejects external transfer, same-column drop and a replayed drop after drag end', () => {
  const { props } = setup();
  fireEvent.drop(screen.getByRole('region', { name: '已完成列' }), { dataTransfer: transfer() });
  const dataTransfer = drag();
  fireEvent.drop(screen.getByRole('region', { name: '待办列' }), { dataTransfer });
  drag();
  fireEvent.dragEnd(screen.getByRole('button', { name: `拖动任务：${task.title}` }));
  fireEvent.drop(screen.getByRole('region', { name: '已完成列' }), { dataTransfer });
  if (props.onStatus) expect(props.onStatus).not.toHaveBeenCalled();
});
it.each(['query', 'version', 'rows', 'disabled', 'busy'] as const)(
  'cancels a source after %s changes even when the original ID remains',
  (kind) => {
    const { props, rerender } = setup();
    const dataTransfer = drag();
    const next = {
      ...props,
      ...(kind === 'query' ? { queryKey: 'page-B' } : {}),
      ...(kind === 'version' ? { tasks: [{ ...task, version: 4 }] } : {}),
      ...(kind === 'rows' ? { tasks: [task] } : {}),
      ...(kind === 'disabled' ? { disabled: true } : {}),
      ...(kind === 'busy' ? { busyIds: [task.id] } : {}),
    };
    rerender(<TaskBoard {...next} />);
    rerender(<TaskBoard {...props} />);
    fireEvent.drop(screen.getByRole('region', { name: '进行中列' }), { dataTransfer });
    if (props.onStatus) expect(props.onStatus).not.toHaveBeenCalled();
  },
);
it('does not reuse drag identity after board unmount and remount', () => {
  const { props, unmount } = setup();
  const dataTransfer = drag();
  unmount();
  render(<TaskBoard {...props} />);
  fireEvent.drop(screen.getByRole('region', { name: '进行中列' }), { dataTransfer });
  if (props.onStatus) expect(props.onStatus).not.toHaveBeenCalled();
});
it('keeps selection, preview and opening separate from status changes', () => {
  const onSelection = vi.fn(),
    onSelect = vi.fn();
  const { props } = setup({ onSelection, onSelect, selectedId: task.id });
  fireEvent.click(screen.getByLabelText(`勾选任务：${task.title}`));
  expect(onSelection).toHaveBeenCalledWith([task.id]);
  expect(onSelect).not.toHaveBeenCalled();
  const card = screen.getByRole('article');
  fireEvent.click(card);
  expect(onSelect).toHaveBeenCalledWith(task.id);
  fireEvent.keyDown(card, { key: 'Enter' });
  expect(props.onOpen).toHaveBeenCalledWith(task.id);
  expect(props.onStatus).not.toHaveBeenCalled();
  expect(card.getAttribute('aria-current')).toBe('true');
});
it.each(['disabled', 'missing-command', 'busy'] as const)(
  'does not write or expose an enabled drag handle when %s',
  (mode) => {
    const { props } = setup({
      disabled: mode === 'disabled',
      ...(mode === 'missing-command' ? { onStatus: undefined } : {}),
      busyIds: mode === 'busy' ? [task.id] : [],
    });
    const handle = screen.getByRole('button', {
      name: `拖动任务：${task.title}`,
    }) as HTMLButtonElement;
    const select = screen.getByLabelText(`修改任务状态：${task.title}`) as HTMLSelectElement;
    expect(handle.disabled).toBe(true);
    expect(handle.draggable).toBe(false);
    expect(select.disabled).toBe(true);
    fireEvent.dragStart(handle, { dataTransfer: transfer() });
    fireEvent.drop(screen.getByRole('region', { name: '进行中列' }), { dataTransfer: transfer() });
    if (props.onStatus) expect(props.onStatus).not.toHaveBeenCalled();
  },
);

it.each(['move', 'leave'] as const)(
  'restores a focused status action after busy, readback and %s',
  (mode) => {
    const { props, rerender } = setup();
    const select = screen.getByLabelText(`修改任务状态：${task.title}`) as HTMLSelectElement;
    select.focus();
    fireEvent.change(select, { target: { value: 'in_progress' } });
    rerender(<TaskBoard {...props} disabled busyIds={[task.id]} />);
    expect(document.activeElement).toBe(select);
    rerender(<TaskBoard {...props} tasks={[]} loading disabled />);
    expect(document.activeElement).toBe(document.body);
    const confirmed =
      mode === 'move' ? [{ ...task, version: 4, status: 'in_progress' as const }] : [];
    rerender(<TaskBoard {...props} tasks={confirmed} />);
    const target =
      mode === 'move'
        ? screen.getByLabelText(`修改任务状态：${task.title}`)
        : screen.getByRole('group', { name: '当前页任务看板' });
    expect(document.activeElement).toBe(target);
    expect(props.onStatus).toHaveBeenCalledTimes(1);
  },
);
it('does not take focus back after the user has moved to another control', () => {
  const { props, rerender } = setup();
  const select = screen.getByLabelText(`修改任务状态：${task.title}`) as HTMLSelectElement;
  select.focus();
  fireEvent.change(select, { target: { value: 'in_progress' } });
  const elsewhere = document.createElement('button');
  document.body.append(elsewhere);
  elsewhere.focus();
  rerender(<TaskBoard {...props} disabled />);
  rerender(<TaskBoard {...props} tasks={[{ ...task, version: 4, status: 'in_progress' }]} />);
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});
it.each(['refresh', 'drag'] as const)(
  'does not create keyboard focus intent for an ordinary %s',
  (mode) => {
    const { props, rerender } = setup();
    if (mode === 'drag') {
      const dataTransfer = drag();
      fireEvent.drop(screen.getByRole('region', { name: '进行中列' }), { dataTransfer });
    }
    expect(document.activeElement).toBe(document.body);
    rerender(<TaskBoard {...props} tasks={[{ ...task, version: 4, status: 'in_progress' }]} />);
    expect(document.activeElement).toBe(document.body);
  },
);
