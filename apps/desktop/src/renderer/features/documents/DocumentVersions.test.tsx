// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogDocument } from '../../../preload/caselite-api';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import { DocumentVersions, FixedDocumentVersion } from './DocumentVersions';
vi.mock('../../editors/RichEditor', () => ({
  DraftEditor: ({ disabled }: { disabled: boolean }) => (
    <input aria-label="固定正文" disabled={disabled} />
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const document = { id: 'd', task_id: 't', body_id: 'b', body_revision: 7 } as CatalogDocument;
const snapshot = {
  id: 's',
  task_id: 't',
  document_id: 'd',
  body_id: 'b',
  body_revision: 2,
  note: '首稿',
  created_at: '2026-11-09',
};
function show(children: React.ReactNode) {
  return render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>{children}</QueryClientProvider>,
  );
}
it('拒绝跨正文版本列表，不暴露错误快照按钮', async () => {
  vi.stubGlobal('caselite', {
    task: vi.fn(async () => ({
      ok: true,
      snapshots: [{ ...snapshot, body_id: 'foreign' }],
      page: { offset: 0, has_more: false },
    })),
  });
  show(
    <DocumentVersions document={document} selected={null} disabled={false} onSelect={vi.fn()} />,
  );
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '暂时无法读取文档版本。');
  expect(screen.queryByText('首稿')).toBeNull();
});
it('脏状态禁止切固定版本，清洁后传递固定身份', async () => {
  vi.stubGlobal('caselite', {
    task: vi.fn(async () => ({
      ok: true,
      snapshots: [snapshot],
      page: { offset: 0, has_more: false },
    })),
  });
  const select = vi.fn();
  const s = show(
    <DocumentVersions document={document} selected={null} disabled onSelect={select} />,
  );
  const button = await screen.findByRole<HTMLButtonElement>('button', { name: /首稿/ });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(select).not.toHaveBeenCalled();
  s.rerender(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DocumentVersions document={document} selected={null} disabled={false} onSelect={select} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /首稿/ }));
  expect(select).toHaveBeenCalledWith('s');
});
it('固定版本只读且不能用当前稿或另一文档冒充', async () => {
  const read = vi.fn(async () => ({ ok: true, snapshots: [snapshot], state: [1] }));
  vi.stubGlobal('caselite', { task: read });
  const s = show(<FixedDocumentVersion document={document} id="s" />);
  expect((await screen.findByLabelText<HTMLInputElement>('固定正文')).disabled).toBe(true);
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({ operation: 'read_snapshot', document_id: 'd', snapshot_id: 's' }),
  );
  read.mockResolvedValue({
    ok: true,
    snapshots: [{ ...snapshot, document_id: 'foreign' }],
    state: [1],
  });
  s.rerender(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <FixedDocumentVersion document={document} id="bad" />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '固定版本不可读取，请重新选择版本。',
  );
  expect(screen.queryByLabelText('固定正文')).toBeNull();
});
