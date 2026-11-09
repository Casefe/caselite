// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Material, MaterialRequest, MaterialResponse } from '../../preload/caselite-api';
import TaskAttachments from './TaskAttachments';
import { useMaterials } from './useMaterials';
vi.mock('./PdfReader', () => ({
  default: ({ name, onClose }: { name: string; onClose(): void }) => (
    <div>
      PDF 原件 {name}
      <button onClick={onClose}>关闭合成阅读器</button>
    </div>
  ),
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function source(task: string, name = '通知.pdf'): Material {
  return {
    id: crypto.randomUUID(),
    task_id: task,
    asset_version_id: crypto.randomUUID(),
    name,
    sha256: 'a'.repeat(64),
    bytes: 40,
    page_count: 1,
    status: 'ready',
    derivation_id: crypto.randomUUID(),
    pages: [
      {
        page: 1,
        text: '合成文书正文',
        origin: name.endsWith('docx') ? 'docx_text' : 'pdf_text',
        blocks: [],
        width: 1,
        height: 1,
        rotation: 0,
      },
    ],
  };
}
function fixture(task = crypto.randomUUID()) {
  const file = source(task);
  let rows = [file];
  const material = vi.fn(async (r: MaterialRequest): Promise<MaterialResponse> => {
    if ('scope' in r && r.scope !== task) return { ok: true, materials: [] };
    if (r.operation === 'commit')
      rows = [...rows, { ...file, id: r.token, asset_version_id: r.token, name: '新附件.docx' }];
    return {
      ok: true,
      materials: rows,
      staged: null,
      ...(r.operation === 'read' ? { data: new Uint8Array([37, 80, 68, 70]) } : {}),
    };
  });
  const token = crypto.randomUUID();
  const pickPdf = vi.fn(async () => ({
    ok: true,
    materials: rows,
    staged: { token, name: '新附件.docx', bytes: 40 },
  }));
  const agent = vi.fn();
  window.caselite = { material, pickPdf, agent } as unknown as Window['caselite'];
  return { task, file, material, pickPdf, agent, token };
}
it('shares one scope poll with AI, imports fixed attachments without authorizing AI and never starts a provider', async () => {
  const f = fixture();
  const ai = renderHook(() => useMaterials(f.task));
  render(<TaskAttachments taskId={f.task} />);
  await screen.findByText(f.file.name);
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'list')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
  await screen.findByText('新附件.docx');
  expect(f.pickPdf).toHaveBeenCalledWith(f.task);
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'commit')).toHaveLength(1);
  expect(ai.result.current.items.some((r) => r.id === f.token)).toBe(true);
  expect(ai.result.current.selected).toEqual({});
  expect(f.material.mock.calls.some(([r]) => r.operation === 'preview')).toBe(false);
  expect(f.agent).not.toHaveBeenCalled();
});
it('keeps one periodic list request for two mounted consumers and retains explicit AI import selection', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const a = renderHook(() => useMaterials(f.task));
  renderHook(() => useMaterials(f.task, true, false));
  await act(async () => {});
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'list')).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'list')).toHaveLength(2);
  await act(async () => {
    await a.result.current.add();
  });
  expect(a.result.current.selected).toHaveProperty(f.token);
});
it('selects on click, opens on double click or Enter, and returns focus after readonly viewing', async () => {
  const f = fixture();
  render(<TaskAttachments taskId={f.task} />);
  const row = await screen.findByRole('button', { name: /通知.pdf/ });
  fireEvent.click(row);
  expect(row.getAttribute('aria-pressed')).toBe('true');
  expect(f.material.mock.calls.some(([r]) => r.operation === 'read')).toBe(false);
  row.focus();
  fireEvent.doubleClick(row);
  await screen.findByText('PDF 原件 通知.pdf');
  fireEvent.click(screen.getByText('关闭合成阅读器'));
  expect(document.activeElement).toBe(row);
  fireEvent.keyDown(row, { key: 'Enter', isComposing: true });
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'read')).toHaveLength(1);
  fireEvent.keyDown(row, { key: 'Enter' });
  await screen.findByText('PDF 原件 通知.pdf');
  expect(f.material.mock.calls.filter(([r]) => r.operation === 'read')).toHaveLength(2);
  expect(row.title).toContain(f.file.asset_version_id);
  expect(row.title).toContain(f.file.id);
});
it('ignores late reads after task changes, cancellation and a newer attachment open', async () => {
  const f = fixture(),
    second = source(f.task, '第二份.pdf');
  const pending: ((r: MaterialResponse) => void)[] = [];
  f.material.mockImplementation(async (r) =>
    r.operation === 'read'
      ? new Promise((resolve) => pending.push(resolve))
      : { ok: true, materials: 'scope' in r && r.scope === f.task ? [f.file, second] : [] },
  );
  const view = render(<TaskAttachments key={f.task} taskId={f.task} />);
  fireEvent.doubleClick(await screen.findByRole('button', { name: /通知.pdf/ }));
  fireEvent.doubleClick(screen.getByRole('button', { name: /第二份.pdf/ }));
  await act(async () =>
    pending[1]({ ok: true, materials: [f.file, second], data: new Uint8Array([2]) }),
  );
  await screen.findByText('PDF 原件 第二份.pdf');
  await act(async () =>
    pending[0]({ ok: true, materials: [f.file, second], data: new Uint8Array([1]) }),
  );
  expect(screen.queryByText('PDF 原件 通知.pdf')).toBeNull();
  fireEvent.click(screen.getByText('关闭合成阅读器'));
  fireEvent.doubleClick(screen.getByRole('button', { name: /通知.pdf/ }));
  fireEvent.click(screen.getByText('取消打开'));
  await act(async () => pending[2]({ ok: true, materials: [f.file], data: new Uint8Array([1]) }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.doubleClick(screen.getByRole('button', { name: /通知.pdf/ }));
  const other = crypto.randomUUID();
  view.rerender(<TaskAttachments key={other} taskId={other} />);
  await act(async () => pending[3]({ ok: true, materials: [f.file], data: new Uint8Array([1]) }));
  expect(screen.queryByText(f.file.name)).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['scope', 'version', 'missing'] as const)(
  'rejects %s read responses without opening a mismatched original',
  async (failure) => {
    const f = fixture();
    f.material.mockImplementation(async (r) =>
      r.operation === 'read'
        ? failure === 'missing'
          ? { ok: false, code: 'MATERIAL_UNAVAILABLE', message: '原件不可读，登记保留' }
          : {
              ok: true,
              materials: [
                {
                  ...f.file,
                  ...(failure === 'scope'
                    ? { task_id: crypto.randomUUID() }
                    : { sha256: 'b'.repeat(64) }),
                },
              ],
              data: new Uint8Array([1]),
            }
        : { ok: true, materials: [f.file] },
    );
    render(<TaskAttachments taskId={f.task} />);
    fireEvent.doubleClick(await screen.findByRole('button', { name: /通知.pdf/ }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(f.file.name)).toBeTruthy();
  },
);
it('keeps a failed import retryable with the original token and treats picker cancellation as no new attachment', async () => {
  const f = fixture();
  f.pickPdf.mockResolvedValueOnce({ ok: true, materials: [f.file], staged: null } as never);
  render(<TaskAttachments taskId={f.task} />);
  await screen.findByText(f.file.name);
  fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
  await waitFor(() =>
    expect((screen.getByText('添加附件') as HTMLButtonElement).disabled).toBe(false),
  );
  expect(f.material.mock.calls.some(([r]) => r.operation === 'commit')).toBe(false);
  const normal = f.material.getMockImplementation()!;
  let failed = false;
  f.material.mockImplementation(async (r) => {
    if (r.operation === 'commit' && !failed) {
      failed = true;
      return { ok: false, code: 'INVALID_PDF', message: '损坏或超限，未保存' };
    }
    return normal(r);
  });
  fireEvent.click(screen.getByText('添加附件'));
  await screen.findByText('损坏或超限，未保存');
  fireEvent.click(screen.getByText('继续导入'));
  await screen.findByText('新附件.docx');
  expect(
    f.material.mock.calls
      .filter(([r]) => r.operation === 'commit')
      .map(([r]) => 'token' in r && r.token),
  ).toEqual([f.token, f.token]);
});
it('shows the existing DOCX semantic reader without AI selection or document initialization', async () => {
  const f = fixture(),
    docx = { ...f.file, name: '通知.docx' };
  f.material.mockResolvedValue({ ok: true, materials: [docx], data: new Uint8Array([80, 75]) });
  render(<TaskAttachments taskId={f.task} />);
  fireEvent.keyDown(await screen.findByRole('button', { name: /通知.docx/ }), { key: 'Enter' });
  await screen.findByLabelText('Word 固定原件');
  expect(screen.getByText(/提取段 1/).textContent).toContain('合成文书正文');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByText('初始化任务正文')).toBeNull();
  expect(f.agent).not.toHaveBeenCalled();
});

it('does not wait for or block AI sending on an unrelated property import, but retains AI import failure guards', async () => {
  const f = fixture();
  let finish!: (r: MaterialResponse) => void;
  const normal = f.material.getMockImplementation()!;
  f.material.mockImplementation(async (r) =>
    r.operation === 'commit'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : normal(r),
  );
  const ai = renderHook(() => useMaterials(f.task));
  const library = renderHook(() => useMaterials(f.task, true, false));
  await waitFor(() => expect(ai.result.current.loaded).toBe(true));
  let upload!: Promise<void>;
  await act(async () => {
    upload = library.result.current.add();
  });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(await ai.result.current.preview('纯文字发送', 'gpt-4.1-mini')).toBeUndefined();
  await act(async () => {
    finish({ ok: false, code: 'FAILED', message: '属性附件失败' });
    await upload;
  });
  expect(await ai.result.current.preview('仍可发送', 'gpt-4.1-mini')).toBeUndefined();
  expect(ai.result.current.error).toBe('');
  expect(library.result.current.error).toBe('属性附件失败');
  await act(async () => {
    await ai.result.current.add();
  });
  expect(ai.result.current.error).toBe('上次附件尚未完成，请重试或移除后添加。');
  expect(library.result.current.error).toBe('属性附件失败');
  expect(f.pickPdf).toHaveBeenCalledTimes(1);
  expect(await ai.result.current.preview('仍不改变发送范围', 'gpt-4.1-mini')).toBeUndefined();
  await act(async () => {
    await library.result.current.discard();
  });
  f.pickPdf.mockResolvedValueOnce({ ok: true, materials: [f.file], staged: null } as never);
  await act(async () => {
    await library.result.current.add();
  });
  await act(async () => {
    upload = ai.result.current.add();
  });
  await waitFor(() => expect(ai.result.current.staged).toBeTruthy());
  await act(async () => {
    finish({ ok: false, code: 'FAILED', message: 'AI附件失败' });
    await upload;
  });
  await expect(ai.result.current.preview('不得降级发送', 'gpt-4.1-mini')).rejects.toThrow(
    'AI附件失败',
  );
});
it('keeps a late pre-commit poll from erasing a committed source and does not let readonly diagnostics block AI', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const normal = f.material.getMockImplementation()!;
  let finish!: (r: MaterialResponse) => void;
  let lists = 0;
  f.material.mockImplementation(async (r) => {
    if (r.operation === 'list' && ++lists === 2)
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (r.operation === 'read') return { ok: false, code: 'MISSING', message: '缺失原件' };
    return normal(r);
  });
  const ai = renderHook(() => useMaterials(f.task));
  const library = renderHook(() => useMaterials(f.task, true, false));
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  await act(async () => {
    await library.result.current.add();
  });
  await act(async () => {
    finish({ ok: true, materials: [f.file] });
  });
  expect(library.result.current.items.some((item) => item.id === f.token)).toBe(true);
  await act(async () => {
    await library.result.current.readReference(f.file.id, f.task, f.file.name);
  });
  expect(library.result.current.error).toBe('缺失原件');
  await act(async () => {
    await library.result.current.discard();
  });
  expect(library.result.current.error).toBe('');
  expect(ai.result.current.error).toBe('');
  expect(await ai.result.current.preview('纯文字发送', 'gpt-4.1-mini')).toBeUndefined();
});
