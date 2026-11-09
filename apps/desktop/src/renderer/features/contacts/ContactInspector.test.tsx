// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { contactSchema } from '@caselite/contracts';
import type { ContactsRequest } from '../../../preload/caselite-api';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import ContactInspector from './ContactInspector';
import { contactKey } from './useContactsWrite';
vi.mock('../../ui/SidebarAgent', () => ({ default: () => null }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const contact = contactSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  name: '合成客户',
  kind: 'person',
  phone: '',
  email: '',
  project_ids: [],
  version: 1,
  updated_at: '2026-11-10',
});
const detail = (version = 1) => ({
  ok: true as const,
  receipt: null,
  contacts: [{ ...contact, version }],
  detail: { contact_id: contact.id, entries: [], task_ids: [], document_ids: [] },
});
function setup(reply: (request: ContactsRequest) => unknown, catalogReady = true) {
  const api = vi.fn(async (request: ContactsRequest) => reply(request));
  vi.stubGlobal('caselite', { contacts: api });
  const client = createWorkbenchQueryClient();
  const props = {
    contact,
    projects: [],
    documents: [],
    catalogReady,
    onDirty: vi.fn(),
    onCreated: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(
    <QueryClientProvider client={client}>
      <ContactInspector {...props} />
    </QueryClientProvider>,
  );
  return { api, client, props, view };
}
it('does not start edits from incomplete details, freezes v1 drafts when v2 arrives, and allows cancel on catalog failure', async () => {
  let resolveRead: (value: unknown) => void = () => {};
  const s = setup((r) =>
    r.operation === 'read'
      ? new Promise((resolve) => {
          resolveRead = resolve;
        })
      : { ok: false, code: 'CONFLICT', message: '版本冲突，草稿保留' },
  );
  expect((screen.getByRole('button', { name: '编辑客户' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => resolveRead(detail()));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '编辑客户' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑客户' }));
  fireEvent.change(screen.getByLabelText('客户姓名'), { target: { value: 'v1草稿' } });
  act(() => s.client.setQueryData(contactKey(contact.id), detail(2)));
  fireEvent.click(screen.getByRole('button', { name: '保存客户' }));
  await screen.findByText('版本冲突，草稿保留');
  expect(s.api.mock.calls.find(([r]) => r.operation === 'save')?.[0]).toMatchObject({
    expected_version: 1,
    name: 'v1草稿',
  });
  expect((screen.getByLabelText('客户姓名') as HTMLInputElement).value).toBe('v1草稿');
  s.view.rerender(
    <QueryClientProvider client={s.client}>
      <ContactInspector {...s.props} catalogReady={false} />
    </QueryClientProvider>,
  );
  expect((screen.getByRole('button', { name: '保存客户' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByLabelText('客户姓名')).toBeNull();
});
it('protects manual drafts, and keeps original-key recovery visible across remount', async () => {
  const writes: ContactsRequest[] = [];
  const s = setup((r) => {
    if (r.operation === 'read') return detail();
    writes.push(r);
    if (writes.length === 1) return { ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' };
    if (r.operation !== 'save_entry') throw Error('unexpected write');
    return {
      ...detail(),
      receipt: r.receipt,
      detail: {
        ...detail().detail,
        entries: [
          {
            id: r.entry_id,
            contact_id: r.contact_id,
            kind: r.kind,
            title: r.title,
            channel: r.channel,
            occurred_on: r.occurred_on,
            content: '原草稿',
            version: 1,
            body_id: r.entry_id,
            body_revision: 1,
            source_run_id: null,
            created_at: '2026-11-10',
            updated_at: '2026-11-10',
          },
        ],
      },
    };
  });
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '编辑客户' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: /手动记录/ }));
  expect((screen.getByRole('button', { name: '编辑客户' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '原标题' } });
  fireEvent.change(screen.getByLabelText('沟通内容'), { target: { value: '原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
  await screen.findByText('合成回执丢失');
  expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
  s.view.unmount();
  render(
    <QueryClientProvider client={s.client}>
      <ContactInspector {...s.props} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '核对原提交结果' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '核对原提交结果' })).toBeNull());
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  await screen.findByText('原标题');
});
it('freezes the parent version when editing links', async () => {
  const s = setup((r) =>
    r.operation === 'read' ? detail() : { ok: false, code: 'CONFLICT', message: '关联冲突' },
  );
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '编辑客户' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('tab', { name: '文档（0）' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑关联' }));
  act(() => s.client.setQueryData(contactKey(contact.id), detail(2)));
  fireEvent.click(screen.getByRole('button', { name: '保存关联' }));
  await screen.findByText('关联冲突');
  expect(s.api.mock.calls.find(([r]) => r.operation === 'set_links')?.[0]).toMatchObject({
    expected_version: 1,
  });
});
