// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  CatalogRequest,
  CatalogResponse,
  Task,
  TaskResponse,
} from '../../../preload/caselite-api';
import TaskProjectAction from './TaskProjectAction';
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
const task: Task = {
  id: crypto.randomUUID(),
  title: '原独立任务',
  objective: '',
  matter_id: null,
  version: 3,
  document_id: crypto.randomUUID(),
  body_id: crypto.randomUUID(),
  body_revision: 2,
  editor_schema: 1,
  updated_at: '2026-11-06',
};
const projectId = crypto.randomUUID();
const success: CatalogResponse = {
  ok: true,
  projects: [],
  documents: [],
  state: null,
  target_id: projectId,
  receipt: crypto.randomUUID(),
};
describe('task promotion UI', () => {
  it('reconciles the original submission and refreshes the same Task identity', async () => {
    const sent: CatalogRequest[] = [];
    const changed = vi.fn(),
      dirty = vi.fn();
    const actual = { ...task, version: 4, matter_id: projectId, matter_title: task.title };
    window.caselite = {
      catalog: vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
        if (r.operation === 'status')
          return { ok: false, code: 'NOT_FOUND', message: '原键未落盘' };
        if (r.operation === 'promote_task') {
          sent.push(r);
          if (sent.length === 1)
            return { ok: false, code: 'RESULT_UNKNOWN', message: '请核对原提交' };
        }
        return success;
      }),
      task: vi.fn(async () => ({ ok: true, tasks: [actual], state: null, receipt: null })),
    } as unknown as Window['caselite'];
    render(<TaskProjectAction task={task} disabled={false} onDirty={dirty} onChanged={changed} />);
    fireEvent.click(screen.getByText('从任务创建项目'));
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe(task.title);
    fireEvent.click(screen.getByText('保存项目'));
    fireEvent.click(await screen.findByText('核对原提交'));
    await waitFor(() => {
      expect(changed).toHaveBeenCalledWith(actual, null);
      expect(dirty).toHaveBeenLastCalledWith(false);
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0]).toMatchObject({ task_id: task.id, expected_version: 3 });
    expect(dirty).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('never creates again when re-reading an already committed Task link fails', async () => {
    const sent: CatalogRequest[] = [];
    const dirty = vi.fn(),
      changed = vi.fn();
    let confirmRead!: (result: TaskResponse) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'READ_FAILED', message: '暂不可用' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirmRead = resolve;
          }),
      );
    window.caselite = {
      catalog: vi.fn(async (r: CatalogRequest) => {
        if (r.operation === 'promote_task') sent.push(r);
        return success;
      }),
      task: read,
    } as unknown as Window['caselite'];
    render(<TaskProjectAction task={task} disabled={false} onDirty={dirty} onChanged={changed} />);
    fireEvent.click(screen.getByText('从任务创建项目'));
    fireEvent.click(screen.getByText('保存项目'));
    await screen.findByRole('alert');
    expect(screen.queryByText('从任务创建项目')).toBeNull();
    const retry = screen.getByRole('button', { name: '重新读取任务关联' });
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(dirty).toHaveBeenLastCalledWith(true);
    const actual = { ...task, version: 4, matter_id: projectId };
    const objective_state = [23, 45, 67];
    await act(async () =>
      confirmRead({
        ok: true,
        tasks: [actual],
        receipt: null,
        state: null,
        objective_state,
      }),
    );
    expect(changed).toHaveBeenCalledExactlyOnceWith(actual, objective_state);
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(sent).toHaveLength(1);
  });
});
