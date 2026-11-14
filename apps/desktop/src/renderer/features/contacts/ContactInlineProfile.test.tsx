// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { contactSchema, type ContactsRequest } from '@caselite/contracts';
import ContactInlineProfile from './ContactInlineProfile';
const contact = contactSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  name: '合成联系人',
  kind: 'person',
  phone: '0100',
  email: '',
  project_ids: [],
  version: 1,
  updated_at: '2026-11-10',
});
afterEach(cleanup);
function setup(
  save = vi.fn(async (request: Extract<ContactsRequest, { operation: 'save' }>) => ({
    ...contact,
    ...request,
    id: contact.id,
    version: request.expected_version + 1,
  })),
) {
  render(
    <ContactInlineProfile
      contact={contact}
      disabled={false}
      busy={false}
      onDirty={vi.fn()}
      onCancel={vi.fn()}
      onSave={save}
    />,
  );
  return save;
}
it('keeps inline edits on IME Enter, cancels without writes, and deduplicates Enter plus blur', async () => {
  let resolve: (value: typeof contact) => void = () => {};
  const save = setup(
    vi.fn(
      () =>
        new Promise<typeof contact>((done) => {
          resolve = done;
        }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
  const input = screen.getByRole('textbox', { name: '电话' });
  fireEvent.change(input, { target: { value: '0101' } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '电话' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
  fireEvent.change(screen.getByRole('textbox', { name: '电话' }), { target: { value: '0102' } });
  const form = screen.getByRole('form', { name: '编辑电话' });
  fireEvent.submit(form);
  fireEvent.blur(form, { relatedTarget: null });
  expect(save).toHaveBeenCalledTimes(1);
  resolve({ ...contact, phone: '0102', version: 2 });
  await screen.findByText('电话已保存');
});
it('uses the confirmed new version on Tab and retains invalid email drafts', async () => {
  const save = setup();
  fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
  fireEvent.change(screen.getByRole('textbox', { name: '电话' }), { target: { value: '0103' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '电话' }), { key: 'Tab' });
  const wechat = await screen.findByRole('textbox', { name: '微信' });
  fireEvent.change(wechat, { target: { value: 'synthetic' } });
  fireEvent.click(screen.getByRole('button', { name: '保存微信' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0]).toMatchObject({
    expected_version: 2,
    phone: '0103',
    wechat: 'synthetic',
  });
  await screen.findByText('微信已保存');
  fireEvent.click(screen.getByRole('button', { name: '编辑邮箱' }));
  fireEvent.change(screen.getByRole('textbox', { name: '邮箱' }), { target: { value: 'invalid' } });
  fireEvent.submit(screen.getByRole('form', { name: '编辑邮箱' }));
  await screen.findByText('请输入有效邮箱，或清空此项。');
  expect(save).toHaveBeenCalledTimes(2);
  expect((screen.getByRole('textbox', { name: '邮箱' }) as HTMLInputElement).value).toBe('invalid');
});
it('keeps the original facts and retains the draft when saving returns no confirmation', async () => {
  const save = setup(vi.fn(async () => undefined) as never);
  const facts = document.querySelector('.customer-facts')!;
  expect(Array.from(facts.querySelectorAll('dt'), (node) => node.textContent)).toEqual([
    '电话',
    '微信',
    '邮箱',
    '地址',
  ]);
  const phoneRow = facts.firstElementChild;
  expect(phoneRow?.textContent).toContain('0100');
  fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
  fireEvent.change(screen.getByRole('textbox', { name: '电话' }), { target: { value: '0109' } });
  fireEvent.submit(screen.getByRole('form', { name: '编辑电话' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect((screen.getByRole('textbox', { name: '电话' }) as HTMLInputElement).value).toBe('0109');
  expect(facts.firstElementChild).toBe(phoneRow);
});

import { contactPropertyDetail } from './contact-property-config';

it('keeps the phone DOM, focus and draft through real identityTarget switches and same-object rerenders', () => {
  const save = vi.fn(async () => undefined);
  const props = {
    contact,
    disabled: false,
    busy: false,
    onDirty: vi.fn(),
    onCancel: vi.fn(),
    onSave: save,
  };
  const target = document.createElement('div');
  document.body.append(target);
  const view = render(<ContactInlineProfile {...props} />);
  try {
    const root = document.querySelector('.customer-inline-profile');
    const facts = document.querySelector('.customer-facts');
    const phoneRow = facts?.firstElementChild;
    fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
    const input = screen.getByRole('textbox', { name: '电话' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0108' } });
    expect(document.activeElement).toBe(input);
    for (const identityTarget of [target, target, undefined, undefined, target]) {
      view.rerender(
        <ContactInlineProfile
          {...props}
          contact={{ ...contact }}
          identityTarget={identityTarget}
        />,
      );
      expect(document.querySelector('.customer-inline-profile')).toBe(root);
      expect(document.querySelector('.customer-facts')).toBe(facts);
      expect(facts?.firstElementChild).toBe(phoneRow);
      expect(screen.getByRole('textbox', { name: '电话' })).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('0108');
      expect(input.maxLength).toBe(64);
      expect(save).not.toHaveBeenCalled();
    }
  } finally {
    view.unmount();
    target.remove();
  }
});

it('consumes selected detail metadata and style on the profile and existing portal nodes', () => {
  const originalFields = contactPropertyDetail.fields;
  const originalStyle = contactPropertyDetail.style;
  // 仅用合成覆盖区分配置选择，产品的两页默认值保持相同。
  contactPropertyDetail.fields = originalFields.map((field) =>
    field.id === 'phone' ? { ...field, label: '合成电话', maxLength: 63 } : field,
  );
  contactPropertyDetail.style = { fontSize: '14px', smallFontSize: '10px', gap: '9px' };
  const target = document.createElement('div');
  document.body.append(target);
  const save = vi.fn(async () => undefined);
  const props = {
    contact,
    disabled: false,
    busy: false,
    onDirty: vi.fn(),
    onCancel: vi.fn(),
    onSave: save,
  };
  const view = render(<ContactInlineProfile {...props} />);
  try {
    const root = document.querySelector<HTMLElement>('.customer-inline-profile')!;
    expect(root.style.getPropertyValue('--property-gap')).toBe('7px');
    fireEvent.click(screen.getByRole('button', { name: '编辑电话' }));
    const input = screen.getByRole('textbox', { name: '电话' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0107' } });
    view.rerender(<ContactInlineProfile {...props} identityTarget={target} />);
    expect(screen.getByRole('textbox', { name: '合成电话' })).toBe(input);
    expect(input.maxLength).toBe(63);
    expect(input.value).toBe('0107');
    expect(document.activeElement).toBe(input);
    expect(
      Array.from(document.querySelectorAll('.customer-facts dt'), (node) => node.textContent),
    ).toEqual(['合成电话', '微信', '邮箱', '地址']);
    for (const node of [
      root,
      ...target.querySelectorAll<HTMLElement>('.customer-identity, .customer-affiliation'),
    ]) {
      expect(node.style.getPropertyValue('--property-font-size')).toBe('14px');
      expect(node.style.getPropertyValue('--property-small-font-size')).toBe('10px');
      expect(node.style.getPropertyValue('--property-gap')).toBe('9px');
    }
    expect(target.querySelector('.customer-identity')).not.toBeNull();
    expect(target.querySelector('.customer-affiliation')).not.toBeNull();
    view.rerender(<ContactInlineProfile {...props} />);
    expect(screen.getByRole('textbox', { name: '电话' })).toBe(input);
    expect(input.maxLength).toBe(64);
    expect(input.value).toBe('0107');
    expect(document.activeElement).toBe(input);
    expect(root.style.getPropertyValue('--property-gap')).toBe('7px');
    expect(save).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    target.remove();
    contactPropertyDetail.fields = originalFields;
    contactPropertyDetail.style = originalStyle;
  }
});
