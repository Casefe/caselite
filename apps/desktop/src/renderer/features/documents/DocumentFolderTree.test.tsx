// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogDocument, Matter } from '../../../preload/caselite-api';
import DocumentFolderTree, {
  documentFolderGroups,
  documentFolderPath,
  type DocumentFolder,
} from './DocumentFolderTree';
afterEach(cleanup);
const doc = (id: string, collection = '', matter_id: string | null = null): CatalogDocument => ({
  id,
  task_id: 'task-' + id,
  body_id: 'body-' + id,
  title: id + '.docx',
  collection,
  matter_id,
  archived_at: null,
  body_revision: 1,
  version: 1,
  tags: [],
  favorite: false,
  in_library: false,
  updated_at: '2026-11-09',
});
it('目录投影每份文件只出现一次，保留未知项目与分类，模板优先归属', () => {
  const documents = [
    doc('work'),
    doc('personal', '个人资料'),
    doc('unsorted', '待整理'),
    doc('custom', '自定义'),
    doc('orphan', '', 'unknown'),
    doc('template', '合同模板', 'known'),
  ];
  const groups = documentFolderGroups(documents, [{ id: 'known', title: '项目甲' }] as Matter[]);
  const flatten = (folders: DocumentFolder[]): CatalogDocument[] =>
    folders.flatMap((f) => (f.children ? flatten(f.children) : f.documents));
  const ids = flatten(groups).map((d) => d.id);
  expect(ids.sort()).toEqual(documents.map((d) => d.id).sort());
  expect(new Set(ids).size).toBe(documents.length);
  expect(documentFolderPath(groups, 'template')).toEqual(['模板', '合同模板']);
  expect(documentFolderPath(groups, 'orphan')).toEqual(['案件文档', '项目文档']);
});
it('展开文件夹显示直属文件，点文件触发稳定身份，脏状态禁止折叠或选别的文件', () => {
  const documents = [doc('work'), doc('personal', '个人资料')],
    select = vi.fn();
  const view = (disabled: boolean) => (
    <DocumentFolderTree
      documents={documents}
      projects={[]}
      selected="work"
      disabled={disabled}
      onSelect={select}
    />
  );
  const s = render(view(false));
  expect(screen.getByRole('button', { name: 'work.docx' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.queryByRole('button', { name: 'personal.docx' })).toBeNull();
  fireEvent.click(screen.getByText('个人资料', { selector: 'summary span' }));
  fireEvent.click(screen.getByRole('button', { name: 'personal.docx' }));
  expect(select).toHaveBeenCalledExactlyOnceWith(documents[1]);
  s.rerender(view(true));
  fireEvent.click(screen.getByText('个人资料', { selector: 'summary span' }));
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'personal.docx' });
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(select).toHaveBeenCalledTimes(1);
});
