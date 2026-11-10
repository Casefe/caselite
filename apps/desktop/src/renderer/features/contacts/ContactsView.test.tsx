// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContactsRequest } from '../../../preload/caselite-api';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import ContactsView from './ContactsView';
import { createCaseLitePreloadApi } from '../../../preload/caselite-api';
vi.mock('../../ui/SidebarAgent', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('回执丢失后使用同一份请求核对，确认后只显示一条联系人', async () => {
  const writes: ContactsRequest[] = [];
  let saved: unknown[] = [];
  const api = createCaseLitePreloadApi(async (_channel, payload) => {
    const request = payload as ContactsRequest;
    if (request.operation === 'read')
      return {
        ok: true,
        contacts: saved,
        receipt: null,
        detail: { contact_id: request.contact_id, entries: [], task_ids: [], document_ids: [] },
      };
    if (request.operation !== 'save' && request.operation !== 'list')
      throw Error('unexpected write');
    if (request.operation === 'list') return { ok: true, contacts: [], receipt: null };
    writes.push(request);
    if (writes.length === 1) return { ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' };
    saved = [
      {
        id: request.contact_id,
        name: request.name,
        kind: request.kind,
        phone: request.phone,
        email: request.email,
        project_ids: request.project_ids,
        version: 1,
        updated_at: '2026-11-07T14:00:00Z',
      },
    ];
    return { ok: true, receipt: request.receipt, contacts: saved };
  });
  vi.stubGlobal('caselite', {
    ...api,
    catalog: async () => ({ ok: true, projects: [], documents: [], project_groups: [] }),
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <ContactsView onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole('table', { name: '联系人列表' });
  fireEvent.click(screen.getByRole('button', { name: /新建联系人/ }));
  fireEvent.change(screen.getByLabelText('联系人姓名'), { target: { value: '合成联系人' } });
  fireEvent.click(screen.getByRole('button', { name: '保存联系人' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对原提交' }));
  await screen.findByRole('heading', { name: '合成联系人' });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(screen.getAllByRole('button', { name: '合成联系人' })).toHaveLength(1);
});
it('opens details on double click, preserves list state and AI layout identity, and retains an edit on list refresh failure', async () => {
  const { contactSchema } = await import('@caselite/contracts');
  const { contactsKey } = await import('./useContactsWrite');
  const { act, waitFor } = await import('@testing-library/react');
  const contacts = Array.from({ length: 17 }, (_, index) =>
    contactSchema.parse({
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
      name: `合成联系人${String(index).padStart(2, '0')}`,
      kind: 'person',
      phone: '',
      email: '',
      project_ids: [],
      version: 1,
      updated_at: '2026-11-10',
    }),
  );
  let failList = false;
  vi.stubGlobal('caselite', {
    contacts: async (request: ContactsRequest) =>
      request.operation === 'list'
        ? failList
          ? { ok: false, code: 'UNAVAILABLE', message: '合成目录失败' }
          : { ok: true, receipt: null, contacts }
        : {
            ok: true,
            receipt: null,
            contacts: [contacts.find((row) => row.id === request.contact_id)],
            detail: { contact_id: request.contact_id, entries: [], task_ids: [], document_ids: [] },
          },
    catalog: async () => ({ ok: true, projects: [], documents: [], project_groups: [] }),
  });
  const client = createWorkbenchQueryClient();
  render(
    <QueryClientProvider client={client}>
      <ContactsView onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole('table', { name: '联系人列表' });
  fireEvent.change(screen.getByRole('textbox', { name: '搜索联系人' }), {
    target: { value: '合成' },
  });
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  const row = screen.getByRole('button', { name: '合成联系人16' });
  fireEvent.click(row);
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '编辑电话' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  const split = document.querySelector('.inspector-split');
  const scroll = document.querySelector('.collection-scroll') as HTMLElement;
  scroll.scrollTop = 61;
  fireEvent.doubleClick(screen.getByRole('button', { name: '合成联系人16' }));
  await screen.findByRole('navigation', { name: '联系人详情导航' });
  expect(document.querySelector('.inspector-split')).toBe(split);
  fireEvent.click(screen.getByRole('button', { name: '← 返回联系人列表' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '合成联系人16' })),
  );
  expect(scroll.scrollTop).toBe(61);
  expect((screen.getByRole('textbox', { name: '搜索联系人' }) as HTMLInputElement).value).toBe(
    '合成',
  );
  expect(screen.getByText('2 / 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
  fireEvent.change(screen.getByRole('textbox', { name: '电话' }), {
    target: { value: '未保存号码' },
  });
  failList = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: contactsKey, exact: true });
  });
  await screen.findByText('合成目录失败');
  expect((screen.getByRole('textbox', { name: '电话' }) as HTMLInputElement).value).toBe(
    '未保存号码',
  );
  expect(document.querySelector('.inspector-split')).toBe(split);
});
