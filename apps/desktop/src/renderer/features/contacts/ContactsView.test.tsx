// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContactsRequest } from '../../../preload/caselite-api';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import ContactsView from './ContactsView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('回执丢失后使用同一份请求核对，确认后只显示一条联系人', async () => {
  const writes: ContactsRequest[] = [];
  vi.stubGlobal('caselite', {
    catalog: async () => ({ ok: true, projects: [] }),
    contacts: async (request: ContactsRequest) => {
      if (request.operation === 'list') return { ok: true, contacts: [], receipt: null };
      writes.push(request);
      if (writes.length === 1)
        return { ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' };
      return {
        ok: true,
        receipt: request.receipt,
        contacts: [
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
        ],
      };
    },
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <ContactsView onDirty={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole('table', { name: '联系人列表' });
  fireEvent.click(screen.getByRole('button', { name: '新建联系人' }));
  fireEvent.change(screen.getByLabelText('联系人姓名'), { target: { value: '合成联系人' } });
  fireEvent.click(screen.getByRole('button', { name: '保存联系人' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对原提交' }));
  await screen.findByRole('heading', { name: '合成联系人' });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(screen.getAllByRole('button', { name: '合成联系人' })).toHaveLength(1);
});
