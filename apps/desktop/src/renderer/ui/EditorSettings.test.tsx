// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LocalPreferencesRequest } from '../../preload/caselite-api';
import {
  LocalPreferencesProvider,
  initialLocalPreferences,
  useLocalPreferences,
} from '../shared/data/LocalPreferences';
import EditorSettings from './EditorSettings';
import { localPreferencesSchema } from '@caselite/contracts';

afterEach(cleanup);
it('edits, orders, hides and removes personal skills, applying them only after save', async () => {
  let preferences = { ...initialLocalPreferences };
  const api = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'set') {
      preferences = localPreferencesSchema.parse({
        ...request.values,
        version: preferences.version + 1,
      });
      return { ok: true, preferences, receipt: request.idempotency_key };
    }
    return { ok: true, preferences, receipt: null };
  });
  Object.defineProperty(window, 'caselite', { configurable: true, value: { preferences: api } });
  const view = render(
    <LocalPreferencesProvider>
      <EditorSettings />
    </LocalPreferencesProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '新增技能' }).disabled).toBe(
      false,
    ),
  );
  expect(screen.getAllByLabelText(/技能 \d 名称/)).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: '新增技能' }));
  fireEvent.change(screen.getByLabelText('技能 6 名称'), { target: { value: '客户说明' } });
  fireEvent.change(screen.getByLabelText('技能 6 指令'), {
    target: { value: '  面向客户解释所选内容。  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: '上移客户说明' }));
  fireEvent.click(screen.getAllByText('显示在写作菜单')[4].querySelector('input')!);
  fireEvent.click(screen.getByRole('button', { name: '删除重新组织格式' }));
  expect(preferences.writing_skills).toBeUndefined();
  // 技能先加入draft，再选方案；可信Schema会以不同顺序返回顶层字段。
  fireEvent.click(screen.getByRole('radio', { name: 'Word' }));
  fireEvent.click(screen.getByRole('button', { name: '保存编辑器设置' }));
  await screen.findByText('个人资料与偏好已保存到此工作区。');
  expect(preferences.editor_mode).toBe('word');
  expect(preferences.writing_skills?.at(-1)).toMatchObject({
    name: '客户说明',
    enabled: false,
    instruction: '面向客户解释所选内容。',
  });
  view.unmount();
  render(
    <LocalPreferencesProvider>
      <EditorSettings />
    </LocalPreferencesProvider>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>('技能 5 名称').value).toBe('客户说明'),
  );
});
it('applies only the confirmed scheme and recovers the same submission after an unknown result', async () => {
  let original: Extract<LocalPreferencesRequest, { operation: 'set' }> | undefined;
  const api = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'read')
      return {
        ok: true,
        preferences: original
          ? localPreferencesSchema.parse({ ...original.values, version: 1 })
          : initialLocalPreferences,
        receipt: null,
      };
    if (request.operation === 'set') {
      original = request;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '保存结果待核对' };
    }
    expect(request.idempotency_key).toBe(original!.idempotency_key);
    return {
      ok: true,
      preferences: localPreferencesSchema.parse({ ...original!.values, version: 1 }),
      receipt: original!.idempotency_key,
    };
  });
  Object.defineProperty(window, 'caselite', { configurable: true, value: { preferences: api } });
  function Applied() {
    return (
      <output aria-label="已生效方案">
        {useLocalPreferences().preferences.editor_mode ?? 'markdown'}
      </output>
    );
  }
  render(
    <LocalPreferencesProvider>
      <Applied />
      <EditorSettings />
    </LocalPreferencesProvider>,
  );
  const word = screen.getByRole<HTMLInputElement>('radio', { name: 'Word' });
  await waitFor(() => expect(word.closest('fieldset')!.disabled).toBe(false));
  expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Markdown' }).checked).toBe(true);
  fireEvent.change(screen.getByLabelText('技能 1 名称'), { target: { value: '恢复后的技能' } });
  fireEvent.click(word);
  expect(screen.getByLabelText('已生效方案').textContent).toBe('markdown');
  fireEvent.click(screen.getByRole('button', { name: '保存编辑器设置' }));
  await screen.findByText('保存结果待核对');
  expect(word.checked).toBe(true);
  expect(word.closest('fieldset')!.disabled).toBe(true);
  expect(screen.getByLabelText('已生效方案').textContent).toBe('markdown');
  fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
  await waitFor(() => expect(screen.getByLabelText('已生效方案').textContent).toBe('word'));
  expect(screen.getByLabelText<HTMLInputElement>('技能 1 名称').value).toBe('恢复后的技能');
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});

it('saves shared export settings only on explicit save and restores the same values after reopening', async () => {
  const { defaultExportStyle } = await import('@caselite/contracts');
  let persisted = { ...initialLocalPreferences };
  const preferences = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'set')
      persisted = localPreferencesSchema.parse({
        ...request.values,
        version: request.expected_version + 1,
      });
    return {
      ok: true,
      preferences: persisted,
      receipt: request.operation === 'set' ? request.idempotency_key : null,
    };
  });
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: { preferences, exportStyleDefaults: defaultExportStyle },
  });
  const mount = () =>
    render(
      <LocalPreferencesProvider>
        <EditorSettings />
      </LocalPreferencesProvider>,
    );
  let view = mount();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>('导出纸张').disabled).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('导出纸张'), { target: { value: 'Letter' } });
  fireEvent.change(screen.getByLabelText('导出字号'), { target: { value: '14' } });
  fireEvent.change(screen.getByLabelText('导出页脚'), {
    target: { value: '合成稿 {page}/{pages}' },
  });
  expect(persisted.export_style).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '保存编辑器设置' }));
  await waitFor(() => expect(persisted.export_style?.paper).toBe('Letter'));
  expect(persisted.export_style).toMatchObject({ font_size: 14, footer: '合成稿 {page}/{pages}' });
  view.unmount();
  view = mount();
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>('导出页脚').value).toBe('合成稿 {page}/{pages}'),
  );
  expect(screen.getByLabelText<HTMLSelectElement>('导出纸张').value).toBe('Letter');
  expect(preferences.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  view.unmount();
});
