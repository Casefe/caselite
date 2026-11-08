// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  DeliverySnapshot,
  Task,
  TaskRequest,
  TaskResponse,
} from '../../../../preload/caselite-api';
import DeliverySnapshots from './DeliverySnapshots';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createWorkbenchQueryClient } from '../../../shared/data/workbench-query-client';

vi.mock('../../../editors/RichEditor', () => ({
  DraftEditor: ({ value, label }: { value: { state: number[] }; label: string }) => (
    <textarea aria-label={label} readOnly value={JSON.stringify(value.state)} />
  ),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
const task: Task = {
  id: '12345678-1234-4234-8234-123456789001',
  document_id: '12345678-1234-4234-8234-123456789002',
  body_id: '12345678-1234-4234-8234-123456789003',
  document_metadata_version: 1,
  body_revision: 2,
  editor_schema: 1,
  title: '合成合同',
  objective: '',
  status: 'todo',
  priority: 0,
  due_date: null,
  matter_id: null,
  version: 1,
  updated_at: '2026-11-08T00:00:00Z',
};
const fixed = (revision: number): DeliverySnapshot => ({
  id: `12345678-1234-4234-8234-12345678900${revision + 3}`,
  task_id: task.id,
  document_id: task.document_id,
  body_id: task.body_id,
  body_revision: revision,
  editor_schema: 1,
  metadata_version: 1,
  task_version: 1,
  title: task.title,
  collection: '',
  tags: [],
  note: '核对稿',
  content_sha256: 'a'.repeat(64),
  created_at: '2026-11-08T00:00:00Z',
  created_by: 'local',
  kind: 'draft',
  source_refs: [],
});
const success = (
  snapshots: DeliverySnapshot[] = [],
  receipt: string | null = null,
): Extract<TaskResponse, { ok: true }> => ({
  ok: true,
  tasks: [task],
  snapshots,
  state: null,
  receipt,
  page: { offset: 0, total: snapshots.length, has_more: false },
});
const failure = (code: Extract<TaskResponse, { ok: false }>['code']): TaskResponse => ({
  ok: false,
  code,
  message: '合成读取失败',
});
function setup(handler: (request: TaskRequest) => Promise<TaskResponse>) {
  const invoke = vi.fn(handler),
    onBusy = vi.fn();
  Object.defineProperty(window, 'caselite', { value: { task: invoke }, configurable: true });
  const client = createWorkbenchQueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DeliverySnapshots
        task={task}
        revision={2}
        dirty={false}
        disabled={false}
        onBack={vi.fn()}
        onBusy={onBusy}
      />
    </QueryClientProvider>,
  );
  return { invoke, onBusy };
}
async function create() {
  const button = screen.getByRole('button', { name: '固定当前修订' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.change(screen.getByRole('textbox', { name: '版本说明' }), {
    target: { value: '保留本轮说明' },
  });
  fireEvent.click(button);
}

it('does not resubmit an acknowledged snapshot when refresh fails; explicit recovery only rereads', async () => {
  let lists = 0;
  const { invoke, onBusy } = setup(async (request) => {
    if (request.operation === 'list_snapshots') {
      if (++lists === 2) throw new Error('synthetic refresh failure');
      return success(lists === 1 ? [] : [fixed(2)]);
    }
    if (request.operation === 'create_snapshot')
      return { ...success([fixed(2)], request.idempotency_key), snapshot_created: true };
    if (request.operation === 'read_snapshot') return { ...success([fixed(2)]), state: [22] };
    throw new Error('Unexpected mutation');
  });
  await create();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('固定版本已保存；列表读取失败'),
  );
  fireEvent.click(screen.getByRole('button', { name: '重新读取固定版本' }));
  await screen.findByRole('textbox', { name: '固定版本正文' });
  expect(
    invoke.mock.calls.filter(([request]) => request.operation === 'create_snapshot'),
  ).toHaveLength(1);
  expect(onBusy).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('button', { name: '导出此版本 Word' }).hasAttribute('disabled')).toBe(
    true,
  );
});

it('checks an unknown result by original key and only retries the exact request after no receipt', async () => {
  let statuses = 0,
    creates = 0;
  const { invoke, onBusy } = setup(async (request) => {
    if (request.operation === 'list_snapshots') return success(creates === 2 ? [fixed(2)] : []);
    if (request.operation === 'create_snapshot')
      return ++creates === 1
        ? failure('RESULT_UNKNOWN')
        : { ...success([fixed(2)], request.idempotency_key), snapshot_created: true };
    if (request.operation === 'status')
      return ++statuses === 1 ? failure('READ_FAILED') : failure('NOT_FOUND');
    if (request.operation === 'read_snapshot') return { ...success([fixed(2)]), state: [22] };
    throw new Error('Unexpected request');
  });
  await create();
  const verify = await screen.findByRole('button', { name: '核对保存结果' });
  await waitFor(() => expect(verify.hasAttribute('disabled')).toBe(false));
  expect(onBusy).toHaveBeenLastCalledWith(true);
  expect((screen.getByRole('textbox', { name: '版本说明' }) as HTMLInputElement).value).toBe(
    '保留本轮说明',
  );
  fireEvent.click(verify);
  const retry = await screen.findByRole('button', { name: '使用原提交重试' });
  expect(screen.getByRole('textbox', { name: '版本说明' }).hasAttribute('disabled')).toBe(true);
  await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('button', { name: '使用原提交重试' })).toBeNull());
  const writes = invoke.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === 'create_snapshot');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  const reads = invoke.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === 'status');
  expect(reads.every((request) => request.idempotency_key === writes[0].idempotency_key)).toBe(
    true,
  );
});

it('does not let a late v1 read replace the selected v2 and retries a failed fixed read explicitly', async () => {
  let resolveOld!: (response: TaskResponse) => void,
    v2Reads = 0;
  setup(async (request) => {
    if (request.operation === 'list_snapshots') return success([fixed(1), fixed(2)]);
    if (request.operation === 'read_snapshot' && request.snapshot_id === fixed(1).id)
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    if (request.operation === 'read_snapshot')
      return ++v2Reads === 1 ? failure('READ_FAILED') : { ...success([fixed(2)]), state: [22] };
    throw new Error('Unexpected request');
  });
  await screen.findByRole('button', { name: /修订 2 草稿/ });
  fireEvent.click(screen.getByRole('button', { name: /修订 2 草稿/ }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法读取或校验'));
  fireEvent.click(screen.getByRole('button', { name: '重新读取固定版本' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('textbox', { name: '固定版本正文' }) as HTMLTextAreaElement).value,
    ).toBe('[22]'),
  );
  await act(async () => resolveOld({ ...success([fixed(1)]), state: [11] }));
  expect((screen.getByRole('textbox', { name: '固定版本正文' }) as HTMLTextAreaElement).value).toBe(
    '[22]',
  );
});
