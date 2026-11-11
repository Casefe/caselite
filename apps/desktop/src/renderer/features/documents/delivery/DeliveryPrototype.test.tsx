// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DeliveryPrototype from './DeliveryPrototype';

// UI状态测试不冒充Tiptap或持久化验收；真实编辑器、键盘与布局由打包桌面复验。
vi.mock('../../../editors/RichEditor', () => ({
  DraftEditor: ({
    value,
    label,
    disabled,
    onChange,
  }: {
    value: { text: string; state: number[] | null };
    label: string;
    disabled?: boolean;
    onChange(value: { text: string; state: number[] | null }): void;
  }) => (
    <textarea
      aria-label={label}
      disabled={disabled}
      value={value.text}
      onChange={(event) => onChange({ text: event.target.value, state: [1, 2] })}
      onDrop={(event) => {
        event.preventDefault();
        onChange({ text: event.dataTransfer.getData('text/plain'), state: [3, 4] });
      }}
    />
  ),
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
it('marks the first external text drop dirty even when the editor dispatches without an input event', () => {
  render(<DeliveryPrototype />);
  fireEvent.drop(screen.getByRole('textbox', { name: '演示工作稿正文' }), {
    dataTransfer: { getData: () => '外部拖入的合成条款' },
  });
  expect(screen.getByRole('status').textContent).toBe('有未保存修改');
  expect(screen.getByRole('button', { name: '演示保存工作稿' }).hasAttribute('disabled')).toBe(
    false,
  );
  click('交付版本');
  expect(screen.getByRole('button', { name: '固定当前修订' }).hasAttribute('disabled')).toBe(true);
});
async function fixFirstVersion() {
  click('交付版本');
  click('固定当前修订');
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '返回工作稿' }).disabled).toBe(
      false,
    ),
  );
}
function exportVersion(format: 'Word' | 'PDF') {
  click(format);
  screen.getByRole('button', { name: `导出此版本 ${format}` }).focus();
  click(`导出此版本 ${format}`);
  return screen.getByRole('dialog', { name: '确认演示导出' });
}

it('requires a saved draft before fixing a version and keeps the source on return', async () => {
  render(<DeliveryPrototype />);
  fireEvent.input(screen.getByRole('textbox', { name: '演示工作稿正文' }), {
    target: { value: '尚未保存的中文' },
  });
  click('交付版本');
  expect(screen.getByRole('button', { name: '固定当前修订' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('还没有固定版本。先核对工作稿，再固定当前修订。')).toBeTruthy();
  click('返回工作稿');
  expect(
    screen.getByRole('textbox', { name: '演示工作稿正文' }).getAttribute('disabled'),
  ).toBeNull();
  expect(
    (screen.getByRole('textbox', { name: '演示工作稿正文' }) as HTMLTextAreaElement).value,
  ).toBe('尚未保存的中文');
  click('演示保存工作稿');
  click('交付版本');
  click('固定当前修订');
  expect(await screen.findByRole('button', { name: /修订 2 草稿/ })).toBeTruthy();
});

it.each(['Word', 'PDF'] as const)(
  'keeps an old fixed revision for %s after editing and fixing the new draft',
  async (format) => {
    render(<DeliveryPrototype />);
    await fixFirstVersion();
    await screen.findByRole('button', { name: /修订 1 草稿/ });
    click('返回工作稿');
    fireEvent.input(screen.getByRole('textbox', { name: '演示工作稿正文' }), {
      target: { value: '付款期限为三十日。' },
    });
    click('演示保存工作稿');
    click('交付版本');
    click('固定当前修订');
    await screen.findByRole('button', { name: /修订 2 草稿/ });
    // 版本行先出现、创建状态后结束；等按钮可交互，再核对切换后的旧版本正文。
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: /修订 1 草稿/ }).disabled).toBe(
        false,
      ),
    );
    click(/修订 1 草稿/);
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: '固定版本正文' }) as HTMLTextAreaElement).value,
      ).toContain('付款期限为十日。'),
    );
    const dialog = exportVersion(format);
    expect(within(dialog).getByText(`导出固定修订 1 · ${format}`)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '演示导出' }));
    expect(screen.getByRole('button', { name: '正在处理…' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: '正在处理…' })).toBeNull());
    expect(screen.getByRole('status').textContent).toContain(`${format} 将使用固定修订 1`);
    expect(screen.getByRole('status').textContent).toContain('未生成文件');
  },
);

it('keeps fixed content on failure and cancellation without creating another version', async () => {
  render(<DeliveryPrototype />);
  await fixFirstVersion();
  await screen.findByRole('button', { name: /修订 1 草稿/ });
  click('失败');
  fireEvent.click(within(exportVersion('PDF')).getByRole('button', { name: '演示导出' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '正在处理…' })).toBeNull());
  expect(screen.getByRole('alert').textContent).toContain('输出位置不可写');
  fireEvent.click(within(exportVersion('Word')).getByRole('button', { name: '取消', exact: true }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '导出此版本 Word' }));
  expect(screen.getByRole('status').textContent).toContain('固定版本保留');
  expect(screen.getAllByRole('button', { name: /修订 1 草稿/ })).toHaveLength(1);
  click('成功');
  const dialog = exportVersion('Word');
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '导出此版本 Word' }));
  expect(screen.getByRole('status').textContent).toContain('已取消');
});
