import { LocalPreferencesProvider } from '../../../shared/data/LocalPreferences';
import { defaultExportStyle } from '@caselite/contracts';
import { createHash, webcrypto } from 'node:crypto';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import DeliverySnapshots from './DeliverySnapshots';
import { createWorkbenchQueryClient } from '../../../shared/data/workbench-query-client';
import type {
  DeliverySnapshot,
  Task,
  TaskRequest,
  TaskResponse,
  DeliveryExport,
} from '../../../../preload/caselite-api';
vi.mock('../../../ui/PdfReader', () => ({
  default: ({ bytes }: { bytes: Uint8Array }) => (
    <div aria-label="受控预览字节">{Array.from(bytes).join(',')}</div>
  ),
}));
vi.mock('../../../editors/RichEditor', () => ({ DraftEditor: () => <p>固定正文预览</p> }));
const uuid = (n: number) => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
const task: Task = {
  id: uuid(1),
  document_id: uuid(2),
  body_id: uuid(3),
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
  updated_at: new Date().toISOString(),
};
const snapshot: DeliverySnapshot = {
  id: uuid(4),
  document_id: task.document_id,
  task_id: task.id,
  body_id: task.body_id,
  body_revision: 1,
  editor_schema: 1,
  metadata_version: 1,
  task_version: 1,
  title: task.title,
  collection: '',
  tags: [],
  note: '十日旧稿',
  content_sha256: 'a'.repeat(64),
  created_at: new Date().toISOString(),
  created_by: 'local',
  kind: 'draft',
  source_refs: [],
};
const artifact: DeliveryExport = {
  id: uuid(5),
  snapshot_id: snapshot.id,
  format: 'docx',
  converter: 'docx-9.15.3-v1',
  status: 'ready',
  sha256: 'b'.repeat(64),
  bytes: 123,
  created_at: new Date().toISOString(),
};
const ok = (extra: object = {}): TaskResponse => ({
  ok: true,
  tasks: [task],
  state: null,
  receipt: null,
  ...extra,
});
const fail = (code: Extract<TaskResponse, { ok: false }>['code']): TaskResponse => ({
  ok: false,
  code,
  message: '合成失败',
});
const clients: ReturnType<typeof createWorkbenchQueryClient>[] = [];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clients.splice(0).forEach((c) => c.clear());
});
function mount(
  handler: (r: TaskRequest) => Promise<TaskResponse>,
  defaults = false,
  readPreferences?: () => Promise<unknown>,
) {
  const fn = vi.fn(handler),
    onBusy = vi.fn();
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: {
      task: fn,
      ...(defaults
        ? {
            exportStyleDefaults: defaultExportStyle,
            preferences:
              readPreferences ??
              (async () => ({
                ok: true,
                preferences: {
                  name: '合成',
                  email: '',
                  avatar: 'portrait',
                  show_word_count: false,
                  version: 0,
                },
                receipt: null,
              })),
          }
        : {}),
    },
  });
  const client = createWorkbenchQueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <LocalPreferencesProvider>
        <DeliverySnapshots
          task={task}
          revision={2}
          dirty={false}
          disabled={false}
          onBack={vi.fn()}
          onBusy={onBusy}
        />
      </LocalPreferencesProvider>
    </QueryClientProvider>,
  );
  return { fn, onBusy };
}
function normal(r: TaskRequest): TaskResponse {
  if (r.operation === 'list_snapshots')
    return ok({ snapshots: [snapshot], page: { offset: 0, total: 1, has_more: false } });
  if (r.operation === 'read_snapshot') return ok({ snapshots: [snapshot], state: [1] });
  return ok();
}
it('keeps ACK separate from failed refresh and only rereads without generating again', async () => {
  let generated = false,
    readFailed = true;
  const { fn } = mount(async (r) => {
    if (r.operation === 'read_export')
      return generated && readFailed
        ? fail('READ_FAILED')
        : ok({ exports: generated ? [artifact] : [] });
    if (r.operation === 'export_snapshot') {
      generated = true;
      return ok({ exports: [artifact], receipt: r.idempotency_key, export_created: true });
    }
    return normal(r);
  });
  const button = await screen.findByRole('button', { name: '导出此版本 Word' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText('Word已保存；读取失败，请重新读取Word，勿重新生成。');
  readFailed = false;
  fireEvent.click(screen.getByRole('button', { name: '重新读取Word' }));
  await screen.findByRole('button', { name: '打开Word工作副本' });
  expect(fn.mock.calls.filter(([r]) => r.operation === 'export_snapshot')).toHaveLength(1);
});
it('locks snapshot refresh/navigation for unknown results and retries the exact original Word request', async () => {
  let calls = 0,
    statuses = 0;
  const { fn, onBusy } = mount(async (r) => {
    if (r.operation === 'read_export') return ok({ exports: [] });
    if (r.operation === 'export_snapshot')
      return ++calls === 1
        ? fail('RESULT_UNKNOWN')
        : ok({ exports: [artifact], receipt: r.idempotency_key, export_created: true });
    if (r.operation === 'status') return ++statuses === 1 ? fail('READ_FAILED') : fail('NOT_FOUND');
    return normal(r);
  });
  const button = await screen.findByRole('button', { name: '导出此版本 Word' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('button', { name: '核对Word保存结果' });
  expect(
    (screen.getByRole('button', { name: '重新读取固定版本' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: /返回工作稿/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(onBusy).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: '核对Word保存结果' }));
  await screen.findByRole('button', { name: '使用原提交重试Word' });
  fireEvent.click(screen.getByRole('button', { name: '使用原提交重试Word' }));
  await screen.findByText('Word草稿已保存。可打开独立工作副本。');
  const requests = fn.mock.calls.map(([r]) => r).filter((r) => r.operation === 'export_snapshot');
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

it('allows ending a known failed attempt without deleting pending artifacts and unlocks navigation', async () => {
  const { onBusy } = mount(async (r) => {
    if (r.operation === 'read_export') return ok({ exports: [] });
    if (r.operation === 'export_snapshot') return fail('WRITE_FAILED');
    return normal(r);
  });
  const button = await screen.findByRole('button', { name: '导出此版本 Word' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('button', { name: '使用原提交重试Word' });
  expect((screen.getByRole('button', { name: /返回工作稿/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '结束本次尝试' }));
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect((screen.getByRole('button', { name: /返回工作稿/ }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('binds the chosen PDF format to its own record and preserves Word when switching back', async () => {
  const pdf: DeliveryExport = {
    ...artifact,
    id: uuid(6),
    format: 'pdf',
    converter: 'electron-45.1.0-pdf-v1',
  };
  let generated = false;
  const { fn } = mount(async (r) => {
    if (r.operation === 'read_export')
      return ok({ exports: r.format === 'pdf' ? (generated ? [pdf] : []) : [artifact] });
    if (r.operation === 'export_snapshot') {
      generated = true;
      return ok({ exports: [pdf], receipt: r.idempotency_key, export_created: true });
    }
    return normal(r);
  });
  await screen.findByRole('button', { name: '打开Word工作副本' });
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  const button = await screen.findByRole('button', { name: '导出此版本 PDF' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('button', { name: '打开PDF工作副本' });
  expect(
    fn.mock.calls.filter(([r]) => r.operation === 'export_snapshot').map(([r]) => r),
  ).toMatchObject([{ format: 'pdf', snapshot_id: snapshot.id }]);
  fireEvent.click(screen.getByRole('button', { name: 'Word', exact: true }));
  await screen.findByRole('button', { name: '打开Word工作副本' });
  expect(screen.queryByRole('button', { name: '打开PDF工作副本' })).toBeNull();
});

it('sends a scoped cancellation while PDF is generating and unlocks after the cancelled reply', async () => {
  let finish!: (response: TaskResponse) => void;
  const { fn, onBusy } = mount(async (r) => {
    if (r.operation === 'read_export') return ok({ exports: [] });
    if (r.operation === 'export_snapshot')
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (r.operation === 'cancel_export') {
      const response = fail('CANCELLED');
      finish(response);
      return response;
    }
    return normal(r);
  });
  await screen.findByRole('button', { name: '导出此版本 Word' });
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  const button = await screen.findByRole('button', { name: '导出此版本 PDF' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole('button', { name: '取消PDF生成' }));
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  const original = fn.mock.calls.map(([r]) => r).find((r) => r.operation === 'export_snapshot')!;
  expect(fn.mock.calls.map(([r]) => r).find((r) => r.operation === 'cancel_export')).toMatchObject({
    task_id: task.id,
    document_id: task.document_id,
    snapshot_id: snapshot.id,
    idempotency_key: 'idempotency_key' in original ? original.idempotency_key : '',
  });
});

it('requests the saved final PDF identity, validates its hash and never regenerates for preview', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = new TextEncoder().encode('%PDF-synthetic-preview-ui');
  const pdf: DeliveryExport = {
    ...artifact,
    format: 'pdf',
    converter: 'electron-45.1.0-pdf-v3',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    configuration: {
      version: 1,
      style: defaultExportStyle,
      font: { family: 'Arial Unicode MS', sha256: 'a'.repeat(64) },
      fingerprint: 'b'.repeat(64),
    },
  };
  const { fn } = mount(async (r) => {
    if (r.operation === 'read_export')
      return ok({
        exports: r.format === 'pdf' ? [pdf] : [],
        export_history: r.format === 'pdf' ? [pdf] : [],
      });
    if (r.operation === 'preview_export') return ok({ exports: [pdf], export_data: bytes });
    return normal(r);
  }, true);
  await screen.findByText('固定正文预览');
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览最终 PDF' }));
  await screen.findByLabelText('受控预览字节');
  expect(fn.mock.calls.filter(([r]) => r.operation === 'preview_export')).toEqual([
    [
      expect.objectContaining({
        export_id: pdf.id,
        snapshot_id: snapshot.id,
        task_id: task.id,
        document_id: task.document_id,
        format: 'pdf',
      }),
    ],
  ]);
  expect(fn.mock.calls.filter(([r]) => r.operation === 'export_snapshot')).toHaveLength(0);
  expect(fn.mock.calls.find(([r]) => r.operation === 'read_export')?.[0]).toMatchObject({
    export_style: defaultExportStyle,
    include_history: true,
  });
});

it('rejects mismatched preview bytes without opening them or regenerating the saved file', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = new TextEncoder().encode('%PDF-bad-hash');
  const pdf: DeliveryExport = {
    ...artifact,
    format: 'pdf',
    converter: 'electron-45.1.0-pdf-v2',
    bytes: bytes.length,
  };
  const { fn } = mount(async (r) => {
    if (r.operation === 'read_export') return ok({ exports: r.format === 'pdf' ? [pdf] : [] });
    if (r.operation === 'preview_export') return ok({ exports: [pdf], export_data: bytes });
    return normal(r);
  });
  await screen.findByText('固定正文预览');
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  fireEvent.click(await screen.findByRole('button', { name: '预览最终 PDF' }));
  await screen.findByText('无法读取或校验最终 PDF，已有产物保持不变；请重新读取。');
  expect(screen.queryByLabelText('受控预览字节')).toBeNull();
  expect(fn.mock.calls.filter(([r]) => r.operation === 'export_snapshot')).toHaveLength(0);
});

it('waits for saved preferences before enabling export instead of submitting default settings', async () => {
  let release!: (value: unknown) => void;
  const waiting = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const { fn } = mount(
    async (r) => (r.operation === 'read_export' ? ok({ exports: [] }) : normal(r)),
    true,
    () => waiting,
  );
  await screen.findByText('固定正文预览');
  const button = screen.getByRole<HTMLButtonElement>('button', { name: '导出此版本 Word' });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(fn.mock.calls.some(([r]) => r.operation === 'export_snapshot')).toBe(false);
  release({
    ok: true,
    preferences: {
      name: '合成',
      email: '',
      avatar: 'portrait',
      show_word_count: false,
      version: 1,
      export_style: { ...defaultExportStyle, paper: 'Letter' },
    },
    receipt: null,
  });
  await waitFor(() => expect(button.disabled).toBe(false));
  // 按钮就绪与产物查询分属异步提交；等待真实查询后核对保存样式。
  await waitFor(() =>
    expect(fn.mock.calls.find(([r]) => r.operation === 'read_export')?.[0]).toMatchObject({
      export_style: expect.objectContaining({ paper: 'Letter' }),
    }),
  );
});
