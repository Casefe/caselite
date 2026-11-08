// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MaterialResponse } from '../../../preload/caselite-api';
import ProjectFiles from './ProjectFiles';
vi.mock('../../ui/PdfReader', () => ({
  default: ({ name }: { name: string }) => <div>固定原件：{name}</div>,
}));
afterEach(cleanup);
const source = (id: string) => ({
  id,
  task_id: 't',
  asset_version_id: id,
  name: '同名.pdf',
  bytes: 100,
  page_count: 1,
  status: 'ready' as const,
  pages: [],
  sha256: 'a'.repeat(64),
  derivation_id: null,
});
it('keeps duplicate names distinct, filters, retries failed reads and opens the exact fixed source', async () => {
  const rows = [source('one'), source('two')];
  let fail = true;
  const material = vi.fn(async (r) => {
    if (r.operation === 'list_project') return { ok: true, materials: rows };
    if (fail) return { ok: false, message: '原件缺失' };
    return { ok: true, materials: rows, data: new Uint8Array([1]) };
  });
  window.caselite = { material } as unknown as Window['caselite'];
  render(<ProjectFiles projectId="p" disabled={false} />);
  expect(await screen.findAllByText('同名.pdf')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('搜索项目文件'), { target: { value: '无结果' } });
  expect(screen.getByText('没有符合筛选条件的文件。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索项目文件'), { target: { value: '' } });
  fireEvent.click(screen.getAllByText('同名.pdf')[1]);
  await screen.findByText('原件缺失');
  expect(screen.getAllByText('同名.pdf')).toHaveLength(2);
  fail = false;
  fireEvent.click(screen.getByText('重试读取'));
  await screen.findByText('固定原件：同名.pdf');
  expect(material.mock.calls.at(-1)?.[0]).toMatchObject({
    project_id: 'p',
    source_id: 'two',
    operation: 'read_project',
  });
});
it('ignores a response after leaving its project', async () => {
  let finish!: (r: MaterialResponse) => void;
  window.caselite = {
    material: vi.fn(
      () =>
        new Promise<MaterialResponse>((resolve) => {
          finish = resolve;
        }),
    ),
  } as unknown as Window['caselite'];
  const view = render(<ProjectFiles projectId="a" disabled={false} />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.unmount();
  finish({ ok: true, materials: [source('old')] });
  expect(screen.queryByText('同名.pdf')).toBeNull();
});

it('compact shows only the last three registered sources in reverse registration order and revalidates the exact source', async () => {
  const rows = ['z', 'a', 'y', 'b'].map(source);
  const material = vi.fn(async (r) =>
    r.operation === 'list_project'
      ? { ok: true, materials: rows }
      : { ok: false, message: '目标不在当前项目' },
  );
  window.caselite = { material } as unknown as Window['caselite'];
  const view = render(<ProjectFiles projectId="p" disabled={false} compact />);
  await screen.findAllByText('同名.pdf');
  expect(
    Array.from(view.container.querySelectorAll('[data-source-id]')).map((e) =>
      e.getAttribute('data-source-id'),
    ),
  ).toEqual(['b', 'y', 'a']);
  expect(screen.queryByLabelText('文件排序')).toBeNull();
  fireEvent.click(screen.getAllByText('同名.pdf')[0]);
  await screen.findByText('目标不在当前项目');
  expect(material.mock.calls.at(-1)?.[0]).toMatchObject({
    operation: 'read_project',
    project_id: 'p',
    source_id: 'b',
  });
  expect(screen.queryByText(/固定原件/)).toBeNull();
});

it('compact distinguishes a failed query from a real empty project and discards a late project response', async () => {
  let finish!: (r: MaterialResponse) => void;
  window.caselite = {
    material: vi.fn((r) =>
      r.project_id === 'old'
        ? new Promise<MaterialResponse>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ ok: false, message: '无权读取项目' }),
    ),
  } as unknown as Window['caselite'];
  const view = render(<ProjectFiles key="old" projectId="old" disabled={false} compact />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<ProjectFiles key="new" projectId="new" disabled={false} compact />);
  await screen.findByText('无权读取项目');
  await act(async () => {
    finish({ ok: true, materials: [source('old-source')] });
  });
  expect(screen.queryByText('同名.pdf')).toBeNull();
  expect(screen.queryByText('项目还没有已登记材料，请在任务中添加 PDF 或 Word。')).toBeNull();
});

it('discards previously visible files when a preview read is denied by project scope', async () => {
  window.caselite = {
    material: vi.fn(async (request) =>
      request.operation === 'list_project'
        ? { ok: true, materials: [source('private')] }
        : { ok: false, code: 'SCOPE', message: '材料不在当前项目范围内。' },
    ),
  } as unknown as Window['caselite'];
  render(<ProjectFiles projectId="p" disabled={false} />);
  fireEvent.click(await screen.findByText('同名.pdf'));
  await screen.findByRole('alert');
  expect(screen.queryByText('同名.pdf')).toBeNull();
  expect(screen.queryByRole('complementary', { name: '文件预览' })).toBeNull();
});

it('reads Word from its exact project source and keeps copy authorization in the project scope', async () => {
  const docx = {
    ...source('word'),
    name: '中文合同.docx',
    pages: [
      {
        page: 1,
        text: '付款期限十日',
        origin: 'docx_text' as const,
        docx_review: { revisions: true, comments: true },
      },
    ],
  };
  const material = vi.fn(async (r) =>
    r.operation === 'save_project_original'
      ? { ok: false, code: 'SCOPE', message: '材料已移出当前项目' }
      : {
          ok: true,
          materials: [docx],
          ...(r.operation === 'read_project' ? { data: new Uint8Array([80, 75]) } : {}),
        },
  );
  window.caselite = { material } as unknown as Window['caselite'];
  render(<ProjectFiles projectId="p" disabled={false} />);
  fireEvent.click(await screen.findByText('中文合同.docx'));
  await screen.findByText('固定原件已校验 · 以下为提取正文');
  expect(screen.getByText(/原件含修订和批注/)).toBeTruthy();
  expect(screen.getByText(/提取段 1 · 付款期限十日/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存原件副本' }));
  await screen.findByText('材料已移出当前项目');
  expect(screen.queryByLabelText('Word 固定原件')).toBeNull();
  expect(screen.queryByText('中文合同.docx')).toBeNull();
  expect(material.mock.calls.at(-1)?.[0]).toEqual({
    protocol_version: 1,
    operation: 'save_project_original',
    project_id: 'p',
    source_id: 'word',
  });
});
