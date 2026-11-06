// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MaterialResponse } from '../../preload/caselite-api';
import ProjectFiles from './ProjectFiles';
vi.mock('../ui/PdfReader', () => ({
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
