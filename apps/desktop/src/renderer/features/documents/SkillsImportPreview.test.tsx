// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { cleanup, fireEvent, render, screen, waitFor, act, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCaseLitePreloadApi, type SkillPreviewResult } from '../../../preload/caselite-api';
import SkillsImportPreview from './SkillsImportPreview';
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) =>
      state.handlers.set(channel, handler),
  },
}));
vi.mock('../../../main/ipc/window-capabilities', () => ({ isTrustedBusinessSender: () => true }));
import { registerSkillsPreviewIpc } from '../../../main/ipc/register-skills-preview-ipc';
const text =
  '---\nname: synthetic\ndescription: "<img src=x onerror=alert(1)>"\nlicense: MIT\nallowed-tools: Bash\n---\n' +
  '仅为合成材料，必须人工复核；不得执行外部命令。'.repeat(3);
const file = (name: string, body: string) => new NodeFile([body], name) as unknown as File;
function select(files: File[]) {
  fireEvent.change(screen.getByLabelText('选择 Skills 文本文件'), { target: { files } });
}
function open() {
  fireEvent.click(screen.getByText('Skills', { selector: 'button' }));
}
function run() {
  fireEvent.click(screen.getByText('预览所选集合'));
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  state.handlers.clear();
  registerSkillsPreviewIpc();
  window.caselite = createCaseLitePreloadApi(async (channel, request) =>
    state.handlers.get(channel)!({}, request),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('uses the actual component, controlled Preload/IPC and Application for selected text; shows candidates and repeat scope', async () => {
  const source = file('SKILL.md', text),
    reference = file('check.md', '- [ ] 人工核对原文'),
    template = file('letter.md', '合成函件模板'),
    script = file('bad.sh', 'never execute'),
    quarantine = file('notes.md', 'untrusted script text; never execute');
  const scriptRead = vi.spyOn(script, 'arrayBuffer');
  render(<SkillsImportPreview />);
  open();
  select([source, reference, template, script, quarantine]);
  fireEvent.change(screen.getByLabelText('check.md 的集合相对路径'), {
    target: { value: 'skill/references/check.md' },
  });
  fireEvent.change(screen.getByLabelText('letter.md 的集合相对路径'), {
    target: { value: 'skill/templates/letter.md' },
  });
  fireEvent.change(screen.getByLabelText('notes.md 的集合相对路径'), {
    target: { value: 'skill/scripts/notes.md' },
  });
  run();
  await screen.findByLabelText('Skills 预览结果');
  expect(screen.getByText('模板 · letter.md')).toBeTruthy();
  expect(screen.getByText('规则候选 · check.md')).toBeTruthy();
  expect(screen.getAllByText('allowed-tools: Bash').length).toBeGreaterThan(0);
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText(/不是完整原包或固定来源版本/)).toBeTruthy();
  expect(screen.getByText(/不查询生产知识库/)).toBeTruthy();
  expect(scriptRead).not.toHaveBeenCalled();
  expect(screen.getByText(/skill\/scripts\/notes.md · quarantined/)).toBeTruthy();
  expect(await source.text()).toBe(text);
  run();
  await screen.findByText(/与上一次预览的已读取文本集合完全相同/);
  expect(screen.getAllByText(/精确内容重复/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('取消并关闭'));
  open();
  expect(screen.queryByLabelText('Skills 预览结果')).toBeNull();
  expect(screen.queryByLabelText('SKILL.md 的集合相对路径')).toBeNull();
});
it('retains selected File on error and retries, rejects malicious virtual paths without reading filesystem', async () => {
  const source = file('SKILL.md', text);
  const read = vi.spyOn(source, 'arrayBuffer').mockRejectedValueOnce(new Error('private path'));
  render(<SkillsImportPreview />);
  open();
  select([source]);
  run();
  await screen.findByRole('alert');
  expect(screen.getByLabelText('SKILL.md 的集合相对路径')).toBeTruthy();
  run();
  await screen.findByLabelText('Skills 预览结果');
  expect(read).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText('SKILL.md 的集合相对路径'), {
    target: { value: '../SKILL.md' },
  });
  run();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('UNSAFE_PATH'),
  );
  expect(screen.getByLabelText('SKILL.md 的集合相对路径')).toHaveProperty('value', '../SKILL.md');
});
it('ignores pending read/result after cancel or unmount; new selection receives only its own result', async () => {
  let resolveRead!: (value: ArrayBuffer) => void;
  const slow = file('SKILL.md', text);
  vi.spyOn(slow, 'arrayBuffer').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  const call = vi.spyOn(window.caselite, 'previewSkills');
  const view = render(<SkillsImportPreview />);
  open();
  select([slow]);
  run();
  fireEvent.click(screen.getByText('取消并关闭'));
  await act(async () => resolveRead(new ArrayBuffer(0)));
  expect(call).not.toHaveBeenCalled();
  open();
  select([file('SKILL.md', text)]);
  let finish!: (value: SkillPreviewResult) => void;
  call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  run();
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('取消并关闭'));
  open();
  select([file('SKILL.md', text)]);
  run();
  await screen.findByLabelText('Skills 预览结果');
  await act(async () => finish({ status: 'rejected', code: 'STALE_RESULT' }));
  expect(screen.queryByRole('alert')).toBeNull();
  view.unmount();
});
it('shows unsupported ZIP without reading it and enforces budget before reading', async () => {
  const zip = file('skill.zip', 'not a real zip'),
    readZip = vi.spyOn(zip, 'arrayBuffer');
  const huge = file('SKILL.md', text);
  Object.defineProperty(huge, 'size', { value: 5 * 1024 * 1024 + 1 });
  const readHuge = vi.spyOn(huge, 'arrayBuffer');
  render(<SkillsImportPreview />);
  open();
  select([zip]);
  run();
  await screen.findByRole('alert');
  expect(readZip).not.toHaveBeenCalled();
  select([huge]);
  run();
  await screen.findByText('所选文件超出数量或大小限制。');
  expect(readHuge).not.toHaveBeenCalled();
});

it('shows a cross-preview similarity as manual review without merging or saving', async () => {
  render(<SkillsImportPreview />);
  open();
  select([file('SKILL.md', text)]);
  run();
  await screen.findByLabelText('Skills 预览结果');
  select([
    file('SKILL.md', text.replace('name: synthetic', 'name: another').concat(' changed ending')),
  ]);
  run();
  await screen.findByText(/近似：人工复核/);
  expect(screen.getByText('方法 · another')).toBeTruthy();
  expect(screen.getByText(text.split('---\n').at(-1)!, { selector: 'pre' })).toBeTruthy();
  expect(screen.queryByText('方法 · synthetic')).toBeNull();
  expect(screen.getByText(/不保存、不执行、不发布/)).toBeTruthy();
});
it('does not deliver a result after unmount and keeps a picker cancellation unchanged', async () => {
  let finish!: (value: SkillPreviewResult) => void;
  const call = vi.spyOn(window.caselite, 'previewSkills').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<SkillsImportPreview />);
  open();
  select([file('SKILL.md', text)]);
  select([]);
  expect(screen.getByLabelText('SKILL.md 的集合相对路径')).toBeTruthy();
  run();
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish({ status: 'rejected', code: 'AFTER_UNMOUNT' }));
  expect(document.querySelector('dialog')).toBeNull();
});

it('keeps prior and current comparison sources distinct when candidate paths repeat', async () => {
  const oldText = 'OLD_REFERENCE_EVIDENCE';
  const newText = 'NEW_REFERENCE_EVIDENCE';
  render(<SkillsImportPreview />);
  open();
  select([file('SKILL.md', text), file('a.md', oldText)]);
  fireEvent.change(screen.getByLabelText('a.md 的集合相对路径'), {
    target: { value: 'skill/references/a.md' },
  });
  run();
  await screen.findByLabelText('Skills 预览结果');
  select([file('SKILL.md', text), file('a.md', newText), file('b.md', newText)]);
  for (const name of ['a.md', 'b.md']) {
    fireEvent.change(screen.getByLabelText(`${name} 的集合相对路径`), {
      target: { value: `skill/references/${name}` },
    });
  }
  run();
  await screen.findByLabelText('Skills 预览结果');
  const a = screen.getByRole('heading', { name: '参考资料 · a.md' }).closest('article')!;
  const priorHint = within(a)
    .getByText(/同名：人工复核/)
    .closest('li')!;
  expect(priorHint.textContent).toContain('上次预览');
  expect(priorHint.textContent).toContain('skill/references/a.md');
  expect(priorHint.querySelector('pre')!.textContent).toBe(oldText);
  const b = screen.getByRole('heading', { name: '参考资料 · b.md' }).closest('article')!;
  const currentHint = within(b)
    .getByText(/精确内容重复/)
    .closest('li')!;
  expect(currentHint.textContent).toContain('本次集合');
  expect(currentHint.textContent).toContain('skill/references/a.md');
  expect(currentHint.querySelector('pre')!.textContent).toBe(newText);
  expect(within(b).queryByText(oldText)).toBeNull();
});
