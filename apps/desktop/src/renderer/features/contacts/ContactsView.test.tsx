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
  await screen.findByRole('table', { name: '客户列表' });
  fireEvent.click(screen.getByRole('button', { name: /新建客户/ }));
  fireEvent.change(screen.getByLabelText('客户姓名'), { target: { value: '合成联系人' } });
  fireEvent.click(screen.getByRole('button', { name: '保存客户' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对原提交' }));
  await screen.findByRole('heading', { name: '合成联系人' });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(screen.getAllByRole('button', { name: '合成联系人' })).toHaveLength(1);
});
