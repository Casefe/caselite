// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { contactSchema } from '@caselite/contracts';
import type { ContactsRequest, Matter } from '../../../preload/caselite-api';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import ContactCreateDialog from './ContactCreateDialog';

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open');
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of [
    ['showModal', showModal],
    ['close', close],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
function confirmed(request: ContactsRequest) {
  if (request.operation !== 'save') throw Error('unexpected request');
  return {
    ok: true,
    receipt: request.receipt,
    contacts: [
      contactSchema.parse({
        id: request.contact_id,
        name: request.name,
        kind: request.kind,
        phone: request.phone,
        wechat: request.wechat,
        email: request.email,
        address: request.address,
        company: request.company,
        position: request.position,
        tags: request.tags,
        project_ids: request.project_ids,
        version: 1,
        updated_at: '2026-11-10',
      }),
    ],
  };
}
function setup(reply: (request: ContactsRequest) => unknown = confirmed) {
  const api = vi.fn(async (request: ContactsRequest) => reply(request));
  vi.stubGlobal('caselite', { contacts: api });
  const client = createWorkbenchQueryClient();
  const props = {
    projects: [
      { id: '11111111-1111-4111-8111-111111111111', title: '合成项目', archived_at: null },
      { id: '22222222-2222-4222-8222-222222222222', title: '归档项目', archived_at: '2026-11-09' },
    ] as Matter[],
    catalogReady: true,
    onRetryProjects: vi.fn(),
    onCancel: vi.fn(),
    onCreated: vi.fn(),
  };
  const wrapper = (visible = true, catalogReady = true) => (
    <QueryClientProvider client={client}>
      {visible && <ContactCreateDialog {...props} catalogReady={catalogReady} />}
    </QueryClientProvider>
  );
  const view = render(wrapper());
  return { api, props, view, wrapper };
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const escape = () =>
  fireEvent(
    screen.getByRole('dialog', { name: '新建联系人' }),
    new Event('cancel', { cancelable: true }),
  );

it('creates an organization with optional fields and an explicit project through the existing save request', async () => {
  const s = setup();
  expect(document.activeElement).toBe(screen.getByLabelText('联系人姓名'));
  expect((screen.getByRole('button', { name: '创建联系人' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  change('联系人姓名', '  合成机构  ');
  change('联系人类型', 'organization');
  change('电话', '010-00000000');
  change('微信', 'synthetic_wechat');
  change('电子邮箱', 'demo@example.invalid');
  change('地址', '合成联系地址');
  fireEvent.click(screen.getByText('单位与职务'));
  change('单位', '合成单位');
  change('职务', '合成职务');
  change('联系人标签', '合同，长期合作,合同');
  fireEvent.click(screen.getByText('关联项目'));
  expect(screen.queryByLabelText('归档项目')).toBeNull();
  fireEvent.click(screen.getByLabelText('合成项目'));
  fireEvent.click(screen.getByRole('button', { name: '创建联系人' }));
  await waitFor(() => expect(s.props.onCreated).toHaveBeenCalledOnce());
  expect(s.api).toHaveBeenCalledOnce();
  expect(s.api.mock.calls[0][0]).toMatchObject({
    operation: 'save',
    expected_version: 0,
    kind: 'organization',
    name: '合成机构',
    phone: '010-00000000',
    wechat: 'synthetic_wechat',
    email: 'demo@example.invalid',
    address: '合成联系地址',
    company: '合成单位',
    position: '合成职务',
    tags: ['合同', '长期合作'],
    project_ids: ['11111111-1111-4111-8111-111111111111'],
  });
});

it('protects a changed draft on cancel and Escape, and discards only on an explicit choice', () => {
  const s = setup();
  change('联系人姓名', '尚未保存');
  escape();
  expect(s.props.onCancel).not.toHaveBeenCalled();
  expect(screen.getByText('放弃尚未创建的联系人？')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect((screen.getByLabelText('联系人姓名') as HTMLInputElement).value).toBe('尚未保存');
  fireEvent.click(screen.getByRole('button', { name: '关闭新建联系人' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃创建' }));
  expect(s.props.onCancel).toHaveBeenCalledOnce();
  expect(s.api).not.toHaveBeenCalled();
});

it('locks dismissal while saving and recovers the identical unknown request after remount and catalog failure', async () => {
  let resolveFirst: (value: unknown) => void = () => {};
  let writes = 0;
  const s = setup((request) =>
    ++writes === 1
      ? new Promise((resolve) => {
          resolveFirst = resolve;
        })
      : confirmed(request),
  );
  change('联系人姓名', '回执测试');
  fireEvent.click(screen.getByRole('button', { name: '创建联系人' }));
  escape();
  expect(s.props.onCancel).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: '关闭新建联系人' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () =>
    resolveFirst({ ok: false, code: 'RESULT_UNKNOWN', message: '合成回执丢失' }),
  );
  await screen.findByText('合成回执丢失');
  s.view.rerender(s.wrapper(false));
  s.view.rerender(s.wrapper(true, false));
  expect((screen.getByLabelText('联系人姓名') as HTMLInputElement).value).toBe('回执测试');
  escape();
  expect(s.props.onCancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核对原提交' }));
  await waitFor(() => expect(s.props.onCreated).toHaveBeenCalledOnce());
  expect(s.api.mock.calls[1][0]).toEqual(s.api.mock.calls[0][0]);
});

it('does not submit Chinese composition or invalid tags and keeps a rejected draft editable', async () => {
  const s = setup(() => ({ ok: false, code: 'INVALID_INPUT', message: '合成拒绝，输入保留' }));
  change('联系人姓名', '合成姓名');
  const input = screen.getByLabelText('联系人姓名');
  const form = input.closest('form')!;
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.submit(form);
  expect(s.api).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  change('联系人标签', '长'.repeat(41));
  expect((screen.getByRole('button', { name: '创建联系人' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  change('联系人标签', '合成标签');
  fireEvent.click(screen.getByRole('button', { name: '创建联系人' }));
  await screen.findByText('合成拒绝，输入保留');
  expect((input as HTMLInputElement).value).toBe('合成姓名');
  expect((input as HTMLInputElement).disabled).toBe(false);
  expect(s.props.onCreated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃创建' }));
  s.view.rerender(s.wrapper(false));
  s.view.rerender(s.wrapper());
  expect(screen.queryByText('合成拒绝，输入保留')).toBeNull();
  expect((screen.getByLabelText('联系人姓名') as HTMLInputElement).value).toBe('');
});
