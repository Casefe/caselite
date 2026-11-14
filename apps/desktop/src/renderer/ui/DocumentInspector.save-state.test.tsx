// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogDocument } from '../../preload/caselite-api';
import type { BodySaveState } from '../features/documents/BodyEditor';
import DocumentInspector from './DocumentInspector';

vi.mock('./SidebarAgent', () => ({
  default: ({ taskId, unavailable }: { taskId?: string; unavailable?: string }) => (
    <p aria-label="原AI范围">{taskId ?? unavailable}</p>
  ),
}));
afterEach(cleanup);
const document = {
  id: 'document-a',
  body_id: 'body-a',
  task_id: 'task-a',
  title: '合成稿',
  body_revision: 4,
  version: 1,
  matter_id: null,
  archived_at: null,
  tags: [],
} as unknown as CatalogDocument;
const retry = vi.fn();
const state: BodySaveState = {
  bodyId: document.body_id,
  revision: 4,
  phase: 'unknown',
  message: '等待核对原提交，输入已保留',
  canRetry: true,
  retry,
};
function panel(saveState: BodySaveState = state, selectedVersion: string | null = null) {
  return (
    <DocumentInspector
      document={document}
      blocked
      tagDraft={false}
      tagsDisabled
      tagsLocked
      tagEditor={0}
      suggestions={[]}
      onTags={vi.fn()}
      onTagDraft={vi.fn()}
      saveState={saveState}
      selectedVersion={selectedVersion}
    />
  );
}
it('保存未知时沿原属性/AI外壳提供可达恢复入口，不丢原字段', () => {
  render(panel());
  expect(screen.getByLabelText('文档保存状态').textContent).toContain('原提交');
  fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('原AI范围').textContent).toBe('task-a');
  for (const name of ['文档版本', '关联项目', '关联任务', '文档 ID'])
    expect(screen.getByText(name)).toBeTruthy();
});
it('不把另一正文的迟到状态显示到当前文档', () => {
  render(panel({ ...state, bodyId: 'body-b' }));
  expect(screen.queryByLabelText('文档保存状态')).toBeNull();
  expect(screen.queryByRole('button', { name: '核对保存结果' })).toBeNull();
});
it('固定版本不显示工作稿保存/恢复入口，保留原只读AI限制', () => {
  render(panel(state, 'snapshot-old'));
  expect(screen.queryByLabelText('文档保存状态')).toBeNull();
  expect(screen.queryByRole('button', { name: '核对保存结果' })).toBeNull();
  expect(screen.getByLabelText('原AI范围').textContent).toContain('固定版本');
});
