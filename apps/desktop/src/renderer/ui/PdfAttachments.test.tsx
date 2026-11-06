// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PdfAttachments, { validatePdfFile, materialSize } from './PdfAttachments';
import { pageRange, type MaterialController } from './useMaterials';
import userEvent from '@testing-library/user-event';
import type { Material } from '../../preload/caselite-api';
vi.mock('./PdfReader', () => ({
  default: ({ name }: { name: string }) => <div>阅读：{name}</div>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function controller(extra: Partial<MaterialController> = {}): MaterialController {
  return {
    available: true,
    items: [],
    error: '',
    busy: false,
    staged: undefined,
    uploadingName: undefined,
    reading: null,
    selected: {},
    clearReading: vi.fn(),
    add: vi.fn(),
    errorMessage: vi.fn(),
    retry: vi.fn(),
    acknowledge: vi.fn(),
    cancelPreparation: vi.fn(),
    discard: vi.fn(),
    readReference: vi.fn(),
    localText: vi.fn(),
    stopLocalText: vi.fn(),
    restore: vi.fn(),
    select: vi.fn(),
    preview: vi.fn(),
    ...extra,
  };
}
const pdf = { name: '合同.pdf', size: 100 } as File;
it('sends only a real single-file drop to the controlled port and preserves the editor', () => {
  const c = controller(),
    view = render(
      <PdfAttachments controller={c}>
        <textarea defaultValue="工作要求" />
      </PdfAttachments>,
    );
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf] } });
  expect(c.add).toHaveBeenCalledWith(pdf);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('工作要求');
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf, pdf] } });
  expect(c.errorMessage).toHaveBeenCalledWith('每次添加一份 PDF，可多次添加。');
  expect(c.add).toHaveBeenCalledTimes(1);
});
it('restored incomplete staging offers retry and remove without claiming saved data', () => {
  const c = controller({ staged: { token: 'staged', name: '合同.pdf', bytes: 100 } });
  render(<PdfAttachments controller={c}>输入</PdfAttachments>);
  expect(screen.getByText(/上次附件尚未完成/)).toBeTruthy();
  fireEvent.click(screen.getByText('继续添加'));
  expect(c.retry).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('移除'));
  expect(c.discard).toHaveBeenCalledTimes(1);
  expect(c.add).not.toHaveBeenCalled();
});
it('does not accept drops while an AI request is pending', () => {
  const c = controller(),
    view = render(
      <PdfAttachments controller={c} disabled>
        输入
      </PdfAttachments>,
    );
  fireEvent.drop(view.container.firstChild!, { dataTransfer: { files: [pdf] } });
  expect(c.add).not.toHaveBeenCalled();
});
it('validates file budget and explicit page ranges without silently broadening selection', () => {
  expect(validatePdfFile({ name: 'bad.txt', size: 10 })).toContain('仅支持 PDF');
  expect(validatePdfFile({ name: 'big.pdf', size: 30 * 1024 * 1024 })).toContain('20 MB');
  expect(pageRange('1-3,5', 5)).toEqual([1, 2, 3, 5]);
  expect(pageRange('1-9', 5)).toBeNull();
  expect(pageRange('2-1', 5)).toBeNull();
  expect(pageRange('', 3)).toEqual([1, 2, 3]);
});

it('keeps the empty composer free of attachment rows and supports keyboard opening, Escape and focus return', async () => {
  const user = userEvent.setup();
  const c = controller();
  render(
    <PdfAttachments controller={c}>
      <textarea defaultValue="保留工作要求" />
    </PdfAttachments>,
  );
  expect(screen.queryByLabelText('待发送附件')).toBeNull();
  expect(screen.queryByRole('menu', { name: '添加文件与材料' })).toBeNull();
  const trigger = screen.getByRole('button', { name: '添加文件与材料' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('menu', { name: '添加文件与材料' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '文件' }));
  await user.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('保留工作要求');
  await user.keyboard(' ');
  await user.click(screen.getByRole('menuitem', { name: '文件' }));
  expect(c.add).toHaveBeenCalledTimes(1);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('keeps saved-material read, selection and original restoration available in the expanded layer', async () => {
  const file: Material = {
    id: 'source',
    task_id: 'task',
    asset_version_id: 'asset',
    name: '合成合同.pdf',
    sha256: '0'.repeat(64),
    bytes: 100,
    page_count: 1,
    derivation_id: null,
    status: 'ready',
    pages: [],
  };
  const c = controller({ items: [file] });
  const user = userEvent.setup();
  render(<PdfAttachments controller={c}>输入</PdfAttachments>);
  await user.click(screen.getByRole('button', { name: '添加文件与材料' }));
  await user.click(screen.getByRole('menuitem', { name: '已保存材料' }));
  await user.click(screen.getByRole('button', { name: file.name }));
  expect(c.readReference).toHaveBeenCalledWith(file.id, file.task_id, file.name);
  await user.click(screen.getByText('更多'));
  await user.click(screen.getByRole('button', { name: '恢复原件' }));
  expect(c.restore).toHaveBeenCalledWith(file);
  await user.click(screen.getByRole('button', { name: '添加到本轮' }));
  expect(c.select).toHaveBeenCalledWith(file.id, true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '添加文件与材料' }));
});

it('keeps an explicit selected chip and removes only its selection', async () => {
  const file: Material = {
    id: 'source',
    task_id: 'task',
    asset_version_id: 'asset',
    name: '合成合同.pdf',
    sha256: '0'.repeat(64),
    bytes: 100,
    page_count: 1,
    derivation_id: null,
    status: 'ready',
    pages: [],
  };
  const c = controller({ items: [file], selected: { [file.id]: '' } });
  render(<PdfAttachments controller={c}>输入</PdfAttachments>);
  expect(screen.getByLabelText('待发送附件').textContent).toContain(file.name);
  expect(screen.getByLabelText('待发送附件').textContent).toContain('100 B');
  fireEvent.click(screen.getByRole('button', { name: `移除附件 ${file.name}` }));
  expect(c.select).toHaveBeenCalledWith(file.id, false);
  expect(c.discard).not.toHaveBeenCalled();
});

it.each([
  ['MacIntel', 'metaKey', '⌘⇧U'],
  ['Win32', 'ctrlKey', 'Ctrl⇧U'],
])('opens the same picker for the scoped shortcut on %s', async (platform, modifier, shortcut) => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  const c = controller({ add: vi.fn(async () => {}) });
  render(
    <>
      <button>外部页面</button>
      <PdfAttachments controller={c}>
        <textarea defaultValue="保留文字" />
      </PdfAttachments>
    </>,
  );
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.keyDown(input, { key: 'U', code: 'KeyU', shiftKey: true, [modifier]: true });
  expect(c.add).toHaveBeenCalledTimes(1);
  expect((input as HTMLTextAreaElement).value).toBe('保留文字');
  screen.getByRole('button', { name: '外部页面' }).focus();
  fireEvent.keyDown(screen.getByRole('button', { name: '外部页面' }), {
    key: 'U',
    code: 'KeyU',
    shiftKey: true,
    [modifier]: true,
  });
  expect(c.add).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '添加文件与材料' }).title).toContain(shortcut);
});

it('does not open a picker for IME composition, repeated keys or a duplicate intent while the picker is pending', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  let finish!: () => void;
  const c = controller({
    add: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  });
  render(
    <PdfAttachments controller={c}>
      <textarea />
    </PdfAttachments>,
  );
  const input = screen.getByRole('textbox');
  input.focus();
  const key = { key: 'U', code: 'KeyU', metaKey: true, shiftKey: true };
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, key);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { ...key, isComposing: true });
  fireEvent.keyDown(input, { ...key, keyCode: 229 });
  fireEvent.keyDown(input, { ...key, repeat: true });
  expect(c.add).not.toHaveBeenCalled();
  fireEvent.keyDown(input, key);
  input.focus();
  fireEvent.keyDown(input, key);
  expect(c.add).toHaveBeenCalledTimes(1);
  finish();
});

it.each([
  { disabled: true, busy: false },
  { disabled: false, busy: true },
])('does not open file commands while disabled or importing: %j', ({ disabled, busy }) => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  const c = controller({ busy });
  render(
    <PdfAttachments controller={c} disabled={disabled}>
      <textarea />
    </PdfAttachments>,
  );
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.keyDown(input, {
    key: 'U',
    code: 'KeyU',
    metaKey: true,
    shiftKey: true,
  });
  expect(
    (screen.getByRole('button', { name: '添加文件与材料' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(c.add).not.toHaveBeenCalled();
});

it('uses menu arrows, Enter, Escape and Tab while keeping the saved-material controls in a separate dialog', async () => {
  const file: Material = {
    id: 'source',
    task_id: 'task',
    asset_version_id: 'asset',
    name: '合成合同.pdf',
    sha256: '0'.repeat(64),
    bytes: 1297,
    page_count: 1,
    derivation_id: null,
    status: 'ready',
    pages: [],
  };
  const c = controller({ items: [file] });
  const user = userEvent.setup();
  render(
    <PdfAttachments controller={c} actions={<button>后续操作</button>}>
      <textarea />
    </PdfAttachments>,
  );
  const trigger = screen.getByRole('button', { name: '添加文件与材料' });
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '文件' }));
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '已保存材料' }));
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: '已保存材料' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '返回添加菜单' }));
  await user.click(screen.getByRole('button', { name: '返回添加菜单' }));
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '已保存材料' }));
  await user.keyboard('{Home}{ArrowUp}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '已保存材料' }));
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  await user.keyboard('{ArrowDown}{Tab}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '后续操作' }));
});

it('hides the empty library command and formats actual byte sizes without changing PDF budgets', async () => {
  const user = userEvent.setup();
  render(<PdfAttachments controller={controller()}>输入</PdfAttachments>);
  await user.click(screen.getByRole('button', { name: '添加文件与材料' }));
  expect(screen.queryByRole('menuitem', { name: '已保存材料' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: '文件' }).title).toContain('20 MB / 200 页');
  expect(materialSize(1297)).toBe('1.27 KB');
  expect(materialSize(20 * 1024 * 1024)).toBe('20 MB');
});

it('flips the menu within viewport space and repositions on resize and ancestor scrolling', async () => {
  const user = userEvent.setup();
  render(<PdfAttachments controller={controller()}>输入</PdfAttachments>);
  const trigger = screen.getByRole('button', { name: '添加文件与材料' });
  let top = 100;
  vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(
    () =>
      ({ top, bottom: top + 32, left: window.innerWidth - 40, width: 32, height: 32 }) as DOMRect,
  );
  await user.click(trigger);
  const menu = screen.getByRole('menu');
  expect(menu.style.top).toBe('138px');
  expect(menu.style.bottom).toBe('');
  expect(menu.style.left).toBe(`${window.innerWidth - 248}px`);
  expect(menu.style.maxHeight).toBe('360px');
  top = window.innerHeight - 100;
  fireEvent.resize(window);
  expect(menu.style.top).toBe('');
  expect(menu.style.bottom).toBe('106px');
  top = 30;
  fireEvent.scroll(document);
  expect(menu.style.top).toBe('68px');
  expect(menu.style.bottom).toBe('');
});
