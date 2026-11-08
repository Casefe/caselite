// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  initialLocalPreferences as defaultLocalPreferences,
  LocalPreferencesProvider,
} from '../shared/data/LocalPreferences';
import { DraftEditor } from './RichEditor';
afterEach(cleanup);
it('counts Unicode text only for enabled document editors without producing a body change', async () => {
  const onChange = vi.fn();
  Object.defineProperty(window, 'caselite', {
    configurable: true,
    value: {
      preferences: async () => ({
        ok: true,
        preferences: { ...defaultLocalPreferences, show_word_count: true },
        receipt: null,
      }),
    },
  });
  render(
    <LocalPreferencesProvider>
      <DraftEditor
        profile="document"
        value={{ text: '中文 A😀。\n 第二段', state: null }}
        onChange={onChange}
        label="文档正文"
      />
      <DraftEditor
        compact
        value={{ text: '评论', state: null }}
        onChange={onChange}
        label="项目评论"
      />
    </LocalPreferencesProvider>,
  );
  await waitFor(() => expect(screen.getAllByLabelText('文档字数')).toHaveLength(1));
  expect(screen.getByLabelText('文档字数').textContent).toBe('8 字');
  expect(screen.getByRole('textbox', { name: '文档正文' }).textContent).toBe('中文 A😀。 第二段');
  expect(onChange).not.toHaveBeenCalled();
});
