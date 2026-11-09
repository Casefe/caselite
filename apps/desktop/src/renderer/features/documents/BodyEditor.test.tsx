// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Task, TaskRequest } from '../../../preload/caselite-api';
import BodyEditor from './BodyEditor';
const harness = vi.hoisted(() => ({
  update: () => {},
  create: () => {},
  editor: { setEditable: vi.fn() },
}));
vi.mock('@tiptap/react', () => ({
  useEditor: (options: { onCreate(): void; onUpdate(): void }) => {
    harness.update = options.onUpdate;
    harness.create = options.onCreate;
    useEffect(() => {
      harness.create();
    }, []);
    return harness.editor;
  },
}));
vi.mock('../../editors/RichEditor', () => ({
  localExtensions: () => [],
  EditorSurface: () => <input aria-label="测试输入" onChange={() => harness.update()} />,
}));
vi.mock('./review/DocumentReview', () => ({ default: () => null, WritingSkillMenu: () => null }));
vi.mock('./delivery/DeliverySnapshots', () => ({
  default: ({
    task,
    revision,
    dirty,
    onBack,
  }: {
    task: Task;
    revision: number;
    dirty: boolean;
    onBack(): void;
  }) => (
    <section aria-label="测试交付版本">
      <output>
        {task.document_id}:{revision}:{String(dirty)}
      </output>
      <button onClick={onBack}>返回编辑</button>
    </section>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const task = {
  id: 'task',
  document_id: 'doc',
  body_id: 'body',
  title: '合成稿',
  body_revision: 3,
} as Task;
const success = { ok: true, tasks: [{ ...task, body_revision: 4 }], state: null };
function setup(api: (r: TaskRequest) => Promise<unknown>) {
  vi.stubGlobal('caselite', { task: api });
  const onSaved = vi.fn(),
    onDirty = vi.fn();
  render(
    <BodyEditor
      task={task}
      initial={null}
      onSaved={onSaved}
      onDirty={onDirty}
      disabled={false}
      embedded
      reviewDock={null}
      reviewSaving={false}
      onReviewSaving={vi.fn()}
    />,
  );
  expect(
    screen.getByTestId('save-body').compareDocumentPosition(screen.getByLabelText('测试输入')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText('测试输入'), { target: { value: '输入保留' } });
  return { onSaved, onDirty };
}
it('未知后先查原键，回执确认后不重复提交；核对期间的新输入继续保持脏状态', async () => {
  let fail = true;
  const api = vi.fn(async (r: TaskRequest) => {
    if (r.operation === 'save') return { ok: false, code: 'RESULT_UNKNOWN', message: '未知' };
    if (fail) throw Error('回执暂不可读取');
    return success;
  });
  const s = setup(api);
  fireEvent.click(screen.getByTestId('save-body'));
  await screen.findByText('回执暂不可读取');
  const original = api.mock.calls[0][0];
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status']);
  fireEvent.change(screen.getByLabelText('测试输入'), { target: { value: '后续输入也保留' } });
  fail = false;
  fireEvent.click(screen.getByTestId('save-body'));
  await screen.findByText('较早修订已保存，仍有未保存修改');
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status', 'status']);
  expect(api.mock.calls[2][0]).toMatchObject({
    idempotency_key: 'idempotency_key' in original ? original.idempotency_key : '',
  });
  expect(s.onSaved).toHaveBeenCalledTimes(1);
  expect(s.onDirty).toHaveBeenLastCalledWith(true);
});
it('明确查不到回执才重试冻结的原请求，网络失败时保留输入', async () => {
  const api = vi.fn(async (r: TaskRequest) => {
    if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '无回执' };
    if (api.mock.calls.length === 1) throw Error('网络中断');
    return success;
  });
  const s = setup(api);
  fireEvent.click(screen.getByTestId('save-body'));
  await screen.findByText('网络中断');
  expect(screen.getByLabelText<HTMLInputElement>('测试输入').value).toBe('输入保留');
  await act(async () => fireEvent.click(screen.getByTestId('save-body')));
  await screen.findByText('已保存到此设备');
  expect(api.mock.calls.map(([r]) => r.operation)).toEqual(['save', 'status', 'save']);
  expect(api.mock.calls[2][0]).toBe(api.mock.calls[0][0]);
  expect(s.onDirty).toHaveBeenLastCalledWith(false);
});
it('内联文档可打开固定交付，传递当前修订和未保存状态，返回后保留输入', async () => {
  const api = vi.fn(async () => success);
  setup(api);
  fireEvent.click(screen.getByRole('button', { name: '交付版本' }));
  expect(screen.getByRole('region', { name: '测试交付版本' }).textContent).toContain('doc:3:true');
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
  expect(screen.getByLabelText<HTMLInputElement>('测试输入').value).toBe('输入保留');
  fireEvent.click(screen.getByTestId('save-body'));
  await screen.findByText('已保存到此设备');
  fireEvent.click(screen.getByRole('button', { name: '交付版本' }));
  expect(screen.getByRole('region', { name: '测试交付版本' }).textContent).toContain('doc:4:false');
  expect(api).toHaveBeenCalledTimes(1);
});
