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
