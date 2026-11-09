// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalPreferencesRequest } from '../../../preload/caselite-api';
import {
  initialLocalPreferences as defaultLocalPreferences,
  LocalPreferencesProvider,
  useLocalPreferences,
} from './LocalPreferences';
import PersonalSettings from '../../ui/PersonalSettings';

afterEach(cleanup);
const read = { ok: true, preferences: defaultLocalPreferences, receipt: null };
function mount(api: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'caselite', { configurable: true, value: { preferences: api } });
  function Saved() {
    return <output aria-label="已保存名称">{useLocalPreferences().preferences.name}</output>;
  }
  render(
    <LocalPreferencesProvider>
      <Saved />
      <PersonalSettings />
    </LocalPreferencesProvider>,
  );
}
async function edit() {
  const name = await screen.findByRole('textbox', { name: '个人名称' });
  await waitFor(() => expect((name as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(name, { target: { value: '新测试律师' } });
  expect(screen.getByLabelText('已保存名称').textContent).toBe('谭律师');
  fireEvent.click(screen.getByRole('button', { name: '保存个人设置' }));
}
it('loads saved values on reread after initial failure when the user has not edited', async () => {
  const saved = {
    ...defaultLocalPreferences,
    name: '已存测试律师',
    email: 'saved@example.invalid',
    avatar: 'initials' as const,
    show_word_count: true,
    version: 3,
  };
  const api = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, code: 'READ_FAILED', message: '读取失败' })
    .mockResolvedValue({ ok: true, preferences: saved, receipt: null });
  mount(api);
  await screen.findByText('读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重新读取（保留输入）' }));
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: '个人名称' }) as HTMLInputElement).value).toBe(
      saved.name,
    ),
  );
  expect((screen.getByRole('textbox', { name: '个人电子邮箱' }) as HTMLInputElement).value).toBe(
    saved.email,
  );
  expect((screen.getByRole('button', { name: '保存个人设置' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(0);
});
it('preserves unknown input, verifies the same key, and retries only after NOT_FOUND', async () => {
  let original: Extract<LocalPreferencesRequest, { operation: 'set' }> | undefined;
  const api = vi.fn(async (r: LocalPreferencesRequest) => {
    if (r.operation === 'read')
      return original ? { ...read, preferences: { ...original.values, version: 1 } } : read;
    if (r.operation === 'status') return { ok: false, code: 'NOT_FOUND', message: '未找到回执' };
    if (!original) {
      original = r;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '未知结果' };
    }
    expect(r).toEqual(original);
    return { ok: true, preferences: { ...r.values, version: 1 }, receipt: r.idempotency_key };
  });
  mount(api);
  await edit();
  await screen.findByRole('button', { name: '核对保存结果' });
  expect((screen.getByRole('textbox', { name: '个人名称' }) as HTMLInputElement).value).toBe(
    '新测试律师',
  );
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原提交' }));
  await waitFor(() => expect(screen.getByLabelText('已保存名称').textContent).toBe('新测试律师'));
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(2);
  expect(api.mock.calls.find(([r]) => r.operation === 'status')![0]).toMatchObject({
    idempotency_key: original!.idempotency_key,
  });
});
it('does not submit again after confirmed save followed by failed refresh', async () => {
  let reads = 0;
  const api = vi.fn(async (r: LocalPreferencesRequest) => {
    if (r.operation === 'read') {
      if (++reads > 1) throw new Error('offline');
      return read;
    }
    if (r.operation === 'set')
      return { ok: true, preferences: { ...r.values, version: 1 }, receipt: r.idempotency_key };
    throw new Error('Unexpected status');
  });
  mount(api);
  await edit();
  await screen.findByText('已保存；最新资料刷新失败，可重新读取，不必再次保存。');
  expect((screen.getByRole('button', { name: '保存个人设置' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '重新读取（保留输入）' }));
  await screen.findByText('无法读取本地设置，请保留输入。');
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  expect(screen.getByLabelText('已保存名称').textContent).toBe('新测试律师');
});
it('keeps a conflicting draft and only updates the expected version when explicitly reloading', async () => {
  let reads = 0;
  const api = vi.fn(async (r: LocalPreferencesRequest) => {
    if (r.operation === 'read')
      return ++reads === 1
        ? read
        : { ...read, preferences: { ...defaultLocalPreferences, name: '其他窗口', version: 2 } };
    return { ok: false, code: 'CONFLICT', message: '冲突，请重读' };
  });
  mount(api);
  await edit();
  await screen.findByText('冲突，请重读');
  fireEvent.click(screen.getByRole('button', { name: '重新读取（保留输入）' }));
  await waitFor(() => expect(screen.getByLabelText('已保存名称').textContent).toBe('其他窗口'));
  expect((screen.getByRole('textbox', { name: '个人名称' }) as HTMLInputElement).value).toBe(
    '新测试律师',
  );
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
