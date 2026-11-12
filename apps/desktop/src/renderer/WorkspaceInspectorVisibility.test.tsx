// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { contactSchema } from '@caselite/contracts';
import type { ContactsRequest } from '../preload/caselite-api';
import ContactsView from './features/contacts/ContactsView';
import { createWorkbenchQueryClient } from './shared/data/workbench-query-client';
import InspectorLayout from './ui/InspectorLayout';

const lifecycle = vi.hoisted(() => ({ mounts: vi.fn(), cancels: vi.fn() }));
vi.mock('./ui/SidebarAgent', () => ({
  default: function RunningConversation() {
    useEffect(() => {
      lifecycle.mounts();
      return () => lifecycle.cancels();
    }, []);
    return <textarea aria-label="运行中会话草稿" defaultValue="保留追问" />;
  },
}));
function Host({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="workbench" data-inspector-open={open}>
      <button onClick={() => setOpen(!open)}>{open ? '收起右栏' : '展开右栏'}</button>
      <div className="workspace-main">{children}</div>
    </div>
  );
}
function styles() {
  const style = document.createElement('style');
  style.dataset.topbarTest = '';
  style.textContent = ['project-document.css', 'workspace-tabs.css']
    .map((name) => readFileSync(`apps/desktop/src/renderer/styles/${name}`, 'utf8'))
    .join('\n');
  document.head.append(style);
}
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-topbar-test]').forEach((node) => node.remove());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('folds the real contact inspector and preserves its unsaved input and conversation (MOCK_ONLY CSS)', async () => {
  styles();
  const contact = contactSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: '合成联系人',
    kind: 'person',
    phone: '',
    email: '',
    project_ids: [],
    version: 1,
    updated_at: '2026-11-12',
  });
  vi.stubGlobal('caselite', {
    contacts: async (request: ContactsRequest) => ({
      ok: true,
      receipt: null,
      contacts: [contact],
      ...(request.operation === 'read'
        ? {
            detail: { contact_id: contact.id, entries: [], task_ids: [], document_ids: [] },
          }
        : {}),
    }),
    catalog: async () => ({ ok: true, projects: [], documents: [], project_groups: [] }),
  });
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <Host>
        <ContactsView onDirty={vi.fn()} />
      </Host>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '合成联系人' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '编辑电话' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
  const input = screen.getByRole('textbox', { name: '电话' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '未保存号码' } });
  const inspector = input.closest('.contacts-inspector')!;
  const conversation = screen.getByLabelText('运行中会话草稿');
  const mounts = lifecycle.mounts.mock.calls.length;
  const cancels = lifecycle.cancels.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '收起右栏' }));
  expect(getComputedStyle(inspector).display).toBe('none');
  expect(document.querySelector('.contacts-inspector')).toBe(inspector);
  fireEvent.click(screen.getByRole('button', { name: '展开右栏' }));
  expect(getComputedStyle(inspector).display).not.toBe('none');
  expect(screen.getByRole('textbox', { name: '电话' })).toBe(input);
  expect(input.value).toBe('未保存号码');
  expect(screen.getByLabelText('运行中会话草稿')).toBe(conversation);
  expect(lifecycle.mounts).toHaveBeenCalledTimes(mounts);
  expect(lifecycle.cancels).toHaveBeenCalledTimes(cancels);
});

it('reveals the work page when folding a maximized AI and restores the same maximized session (MOCK_ONLY CSS)', () => {
  styles();
  render(
    <Host>
      <section className="task-layout">
        <input aria-label="工作页草稿" defaultValue="未保存正文" />
        <aside className="task-inspector">
          <InspectorLayout properties={<input aria-label="属性草稿" defaultValue="未保存属性" />}>
            <textarea aria-label="AI草稿" defaultValue="保留运行及输入" />
          </InspectorLayout>
        </aside>
      </section>
    </Host>,
  );
  const page = screen.getByLabelText('工作页草稿');
  const ai = screen.getByLabelText('AI草稿') as HTMLTextAreaElement;
  const inspector = ai.closest('.task-inspector')!;
  const split = ai.closest('.inspector-split')!;
  fireEvent.click(screen.getByRole('button', { name: '最大化 AI 对话' }));
  expect(getComputedStyle(page).visibility).toBe('hidden');
  fireEvent.click(screen.getByRole('button', { name: '收起右栏' }));
  expect(getComputedStyle(page).visibility).toBe('visible');
  expect(getComputedStyle(inspector).display).toBe('none');
  expect(split.getAttribute('data-ai-maximized')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '展开右栏' }));
  expect(getComputedStyle(page).visibility).toBe('hidden');
  expect(getComputedStyle(ai).visibility).toBe('visible');
  expect(getComputedStyle(inspector).display).not.toBe('none');
  expect(screen.getByLabelText('AI草稿')).toBe(ai);
  expect(ai.value).toBe('保留运行及输入');
  expect((page as HTMLInputElement).value).toBe('未保存正文');
});
