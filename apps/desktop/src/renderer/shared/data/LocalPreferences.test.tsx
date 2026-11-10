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
import { defaultExportStyle, localPreferenceValuesSchema } from '@caselite/contracts';

afterEach(cleanup);
const read = { ok: true, preferences: defaultLocalPreferences, receipt: null };
it('normalizes running text before recording the request so a confirmed save does not become unknown', async () => {
  let persisted = { ...defaultLocalPreferences };
  const api = vi.fn(async (r: LocalPreferencesRequest) => {
    if (r.operation === 'read') return { ok: true, preferences: persisted, receipt: null };
    if (r.operation !== 'set') throw new Error('Unexpected recovery');
    persisted = { ...localPreferenceValuesSchema.parse(r.values), version: r.expected_version + 1 };
    return { ok: true, preferences: structuredClone(persisted), receipt: r.idempotency_key };
  });
  window.caselite = { preferences: api } as unknown as Window['caselite'];
  function Controls() {
    const s = useLocalPreferences();
    return (
      <>
        <button
          disabled={!s.ready}
          onClick={() =>
            s.change({
              export_style: {
                ...defaultExportStyle,
                header: '  合成稿  ',
                footer: '  第 {page} 页  ',
              },
            })
          }
        >
          输入页眉
        </button>
        <button onClick={() => void s.save()}>保存样式</button>
        <output aria-label="保存阶段">{s.phase}</output>
        <output aria-label="样式草稿">{s.draft.export_style?.header}</output>
        <output aria-label="提示">{s.notice}</output>
      </>
    );
  }
  render(
    <LocalPreferencesProvider>
      <Controls />
    </LocalPreferencesProvider>,
  );
  const edit = screen.getByRole<HTMLButtonElement>('button', { name: '输入页眉' });
  await waitFor(() => expect(edit.disabled).toBe(false));
  fireEvent.click(edit);
  fireEvent.click(screen.getByRole('button', { name: '保存样式' }));
  await waitFor(() => expect(screen.getByLabelText('提示').textContent).toContain('已保存'));
  expect(screen.getByLabelText('保存阶段').textContent).toBe('idle');
  expect(screen.getByLabelText('样式草稿').textContent).toBe('合成稿');
  const submitted = api.mock.calls.find(([r]) => r.operation === 'set')![0];
  expect(submitted.operation === 'set' && submitted.values.export_style).toMatchObject({
    header: '合成稿',
    footer: '第 {page} 页',
  });
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  expect(api.mock.calls.some(([r]) => r.operation === 'status')).toBe(false);
});

it('does not submit or discard an unsaved export style when calendar layout saves and refreshes', async () => {
  const style = { ...defaultExportStyle, footer: '未保存的页脚 {page}' };
  let persisted = { ...defaultLocalPreferences, version: 1, export_style: defaultExportStyle };
  const api = vi.fn(async (r: LocalPreferencesRequest) => {
    if (r.operation === 'read')
      return { ok: true, preferences: structuredClone(persisted), receipt: null };
    if (r.operation !== 'set') throw new Error('Unexpected status');
    persisted = { ...r.values, version: r.expected_version + 1, export_style: defaultExportStyle };
    return { ok: true, preferences: structuredClone(persisted), receipt: r.idempotency_key };
  });
  window.caselite = { preferences: api } as unknown as Window['caselite'];
  function Controls() {
    const s = useLocalPreferences();
    return (
      <>
        <button disabled={!s.ready} onClick={() => s.change({ export_style: style })}>
          修改导出草稿
        </button>
        <button
          disabled={!s.ready}
          onClick={() => void s.saveCalendarLayout({ dates_width: 300, inspector_width: 340 })}
        >
          保存布局
        </button>
        <output aria-label="导出草稿">{s.draft.export_style?.footer}</output>
        <output aria-label="已存导出">{s.preferences.export_style?.footer}</output>
      </>
    );
  }
  render(
    <LocalPreferencesProvider>
      <Controls />
    </LocalPreferencesProvider>,
  );
  const edit = screen.getByRole<HTMLButtonElement>('button', { name: '修改导出草稿' });
  await waitFor(() => expect(edit.disabled).toBe(false));
  fireEvent.click(edit);
  fireEvent.click(screen.getByRole('button', { name: '保存布局' }));
  await waitFor(() => expect(persisted.version).toBe(2));
  await waitFor(() =>
    expect(api.mock.calls.filter(([r]) => r.operation === 'read')).toHaveLength(2),
  );
  expect(screen.getByLabelText('导出草稿').textContent).toBe(style.footer);
  expect(screen.getByLabelText('已存导出').textContent).toBe('');
  const submitted = api.mock.calls.find(([r]) => r.operation === 'set')![0];
  expect(submitted.operation === 'set' && submitted.values.export_style?.footer).toBe('');
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
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

it('preserves an unsaved statistics draft through a lost calendar ACK, original-key verification and refresh', async () => {
  const config = {
    tasks: { enabled: true, position: 'top' as const },
    projects: { enabled: true, position: 'top' as const },
    finance: { enabled: true, position: 'top' as const },
    contacts: { enabled: false, position: 'top' as const },
  };
  let persisted = { ...defaultLocalPreferences, statistics_cards: config };
  let original: Extract<LocalPreferencesRequest, { operation: 'set' }> | undefined;
  const api = vi.fn(async (r: LocalPreferencesRequest) => {
    if (r.operation === 'read')
      return { ok: true, preferences: structuredClone(persisted), receipt: null };
    if (r.operation === 'set') {
      original = r;
      persisted = { ...r.values, statistics_cards: config, version: r.expected_version + 1 };
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成布局回执丢失' };
    }
    expect(r.idempotency_key).toBe(original!.idempotency_key);
    return {
      ok: true,
      preferences: structuredClone(persisted),
      receipt: original!.idempotency_key,
    };
  });
  window.caselite = { preferences: api } as unknown as Window['caselite'];
  function Controls() {
    const s = useLocalPreferences();
    return (
      <>
        <button
          disabled={!s.ready}
          onClick={() =>
            s.change({
              statistics_cards: { ...config, tasks: { enabled: false, position: 'bottom' } },
            })
          }
        >
          修改统计草稿
        </button>
        <button
          onClick={() => void s.saveCalendarLayout({ dates_width: 300, inspector_width: 340 })}
        >
          保存日历布局
        </button>
        <button onClick={() => void s.verify()}>核对布局</button>
        <output aria-label="统计草稿">{JSON.stringify(s.draft.statistics_cards?.tasks)}</output>
        <output aria-label="已存统计">
          {JSON.stringify(s.preferences.statistics_cards?.tasks)}
        </output>
        <output aria-label="布局阶段">{s.phase}</output>
      </>
    );
  }
  render(
    <LocalPreferencesProvider>
      <Controls />
    </LocalPreferencesProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '修改统计草稿' }).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '修改统计草稿' }));
  fireEvent.click(screen.getByRole('button', { name: '保存日历布局' }));
  await waitFor(() => expect(screen.getByLabelText('布局阶段').textContent).toBe('verify'));
  expect(original!.values.statistics_cards?.tasks).toEqual(config.tasks);
  fireEvent.click(screen.getByRole('button', { name: '核对布局' }));
  await waitFor(() => expect(screen.getByLabelText('布局阶段').textContent).toBe('idle'));
  expect(JSON.parse(screen.getByLabelText('统计草稿').textContent!)).toEqual({
    enabled: false,
    position: 'bottom',
  });
  expect(JSON.parse(screen.getByLabelText('已存统计').textContent!)).toEqual(config.tasks);
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});

it.each([false, true])(
  'merges only edited statistics fields after a conflict while retaining another window choices (saved map: %s)',
  async (withSavedMap) => {
    const config = {
      tasks: { enabled: true, position: 'top' as const },
      projects: { enabled: true, position: 'top' as const },
      finance: { enabled: true, position: 'top' as const },
      contacts: { enabled: false, position: 'top' as const },
    };
    let persisted: typeof defaultLocalPreferences = {
      ...defaultLocalPreferences,
      ...(withSavedMap ? { statistics_cards: config } : {}),
    };
    let writes = 0;
    const api = vi.fn(async (r: LocalPreferencesRequest) => {
      if (r.operation === 'read')
        return { ok: true, preferences: structuredClone(persisted), receipt: null };
      if (r.operation !== 'set') throw new Error('Unexpected status');
      writes += 1;
      if (writes === 1) {
        persisted = {
          ...persisted,
          version: 1,
          statistics_cards: {
            ...config,
            tasks: { enabled: false, position: 'top' },
            projects: { enabled: true, position: 'middle' },
            finance: { enabled: true, position: 'middle' },
          },
        };
        return { ok: false, code: 'CONFLICT', message: '合成其他窗口修改' };
      }
      persisted = { ...r.values, version: r.expected_version + 1 };
      return { ok: true, preferences: structuredClone(persisted), receipt: r.idempotency_key };
    });
    window.caselite = { preferences: api } as unknown as Window['caselite'];
    render(
      <LocalPreferencesProvider>
        <PersonalSettings preferencesOnly />
      </LocalPreferencesProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: '启用任务统计' }).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('任务统计位置'), { target: { value: 'bottom' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '启用财务统计' }));
    fireEvent.click(screen.getByRole('button', { name: '保存个人设置' }));
    await screen.findByText('合成其他窗口修改');
    fireEvent.click(screen.getByRole('button', { name: '重新读取（保留输入）' }));
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '启用任务统计' }).checked).toBe(
        false,
      ),
    );
    expect(screen.getByLabelText<HTMLSelectElement>('任务统计位置').value).toBe('bottom');
    expect(screen.getByLabelText<HTMLSelectElement>('项目统计位置').value).toBe('middle');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: '启用财务统计' }).checked).toBe(
      false,
    );
    expect(screen.getByLabelText<HTMLSelectElement>('财务统计位置').value).toBe('middle');
    fireEvent.click(screen.getByRole('button', { name: '保存个人设置' }));
    await waitFor(() => expect(persisted.version).toBe(2));
    expect(persisted.statistics_cards).toEqual({
      tasks: { enabled: false, position: 'bottom' },
      projects: { enabled: true, position: 'middle' },
      finance: { enabled: false, position: 'middle' },
      contacts: config.contacts,
    });
    expect(writes).toBe(2);
  },
);
