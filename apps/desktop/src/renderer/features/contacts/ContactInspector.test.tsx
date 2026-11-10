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
  expect(
    (screen.getByRole('button', { name: '编辑姓名／名称' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => resolveRead(detail()));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '编辑姓名／名称' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑姓名／名称' }));
  fireEvent.change(screen.getByLabelText('姓名／名称'), { target: { value: 'v1草稿' } });
  act(() => s.client.setQueryData(contactKey(contact.id), detail(2)));
  fireEvent.click(screen.getByRole('button', { name: '保存姓名／名称' }));
  await screen.findByText('版本冲突，草稿保留');
  expect(s.api.mock.calls.find(([r]) => r.operation === 'save')?.[0]).toMatchObject({
    expected_version: 1,
    name: 'v1草稿',
  });
  expect((screen.getByLabelText('姓名／名称') as HTMLInputElement).value).toBe('v1草稿');
  s.view.rerender(
    <QueryClientProvider client={s.client}>
      <ContactInspector {...s.props} catalogReady={false} />
    </QueryClientProvider>,
  );
  expect(
    (screen.getByRole('button', { name: '保存姓名／名称' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: '取消编辑姓名／名称' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: '取消编辑姓名／名称' }));
  expect(screen.queryByRole('textbox', { name: '姓名／名称' })).toBeNull();
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
    expect(
      (screen.getByRole('button', { name: '编辑姓名／名称' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: /手动记录/ }));
  expect(
    (screen.getByRole('button', { name: '编辑姓名／名称' }) as HTMLButtonElement).disabled,
  ).toBe(true);
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
    expect(
      (screen.getByRole('button', { name: '编辑姓名／名称' }) as HTMLButtonElement).disabled,
    ).toBe(false),
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
it('retains an inline record draft when detail refresh fails and prevents search from unmounting it', async () => {
  const entry = {
    id: '22222222-2222-4222-8222-222222222222',
    contact_id: contact.id,
    kind: 'communication' as const,
    title: '合成记录',
    channel: 'phone' as const,
    occurred_on: null,
    content: '原内容',
    version: 1,
    body_id: '33333333-3333-4333-8333-333333333333',
    body_revision: 1,
    source_run_id: null,
    created_at: '2026-11-10',
    updated_at: '2026-11-10',
  };
  let failRead = false;
  const s = setup(() =>
    failRead
      ? { ok: false, code: 'UNAVAILABLE', message: '合成读取失败' }
      : { ...detail(), detail: { ...detail().detail, entries: [entry] } },
  );
  await screen.findByText('合成记录');
  const target = document.createElement('div');
  document.body.append(target);
  s.view.rerender(
    <QueryClientProvider client={s.client}>
      <ContactInspector {...s.props} detailTarget={target} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑记录：合成记录' }));
  fireEvent.change(screen.getByLabelText('沟通内容'), { target: { value: '本地未保存内容' } });
  expect(
    (screen.getByRole('searchbox', { name: '搜索往来记录' }) as HTMLInputElement).disabled,
  ).toBe(true);
  failRead = true;
  await act(async () => {
    await s.client.invalidateQueries({ queryKey: contactKey(contact.id), exact: true });
  });
  await screen.findByText(/刷新未成功/);
  expect((screen.getByLabelText('沟通内容') as HTMLTextAreaElement).value).toBe('本地未保存内容');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await screen.findByText('合成记录');
  s.view.unmount();
  target.remove();
});
it('keeps source linking exclusive with profile and record editing', async () => {
  const s = setup(() => detail());
  window.caselite.agent = vi.fn(async () => ({
    ok: false,
    code: 'UNAVAILABLE',
    message: '合成来源暂不可用',
  }));
  window.caselite.task = vi.fn(async () => ({ ok: true, tasks: [], receipt: null }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '关联来源' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '关联来源' }));
  expect((screen.getByRole('button', { name: '编辑电话' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole('button', { name: /手动记录/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '编辑电话' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(s.api.mock.calls.filter(([request]) => request.operation !== 'read')).toHaveLength(0);
});
