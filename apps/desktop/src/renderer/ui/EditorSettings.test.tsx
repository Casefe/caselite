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

afterEach(cleanup);
it('applies only the confirmed scheme and recovers the same submission after an unknown result', async () => {
  let original: Extract<LocalPreferencesRequest, { operation: 'set' }> | undefined;
  const api = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'read')
      return {
        ok: true,
        preferences: original ? { ...original.values, version: 1 } : initialLocalPreferences,
        receipt: null,
      };
    if (request.operation === 'set') {
      original = request;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '保存结果待核对' };
    }
    expect(request.idempotency_key).toBe(original!.idempotency_key);
    return {
      ok: true,
      preferences: { ...original!.values, version: 1 },
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
  fireEvent.click(word);
  expect(screen.getByLabelText('已生效方案').textContent).toBe('markdown');
  fireEvent.click(screen.getByRole('button', { name: '保存编辑器设置' }));
  await screen.findByText('保存结果待核对');
  expect(word.checked).toBe(true);
  expect(word.closest('fieldset')!.disabled).toBe(true);
  expect(screen.getByLabelText('已生效方案').textContent).toBe('markdown');
  fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
  await waitFor(() => expect(screen.getByLabelText('已生效方案').textContent).toBe('word'));
  expect(api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
