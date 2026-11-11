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

it('方向键只移动可见行焦点，左右键展开收起并返回父级', () => {
  const select = vi.fn();
  render(
    <DocumentFolderTree
      documents={[doc('work'), doc('personal', '个人资料')]}
      projects={[]}
      selected="work"
      disabled={false}
      onSelect={select}
    />,
  );
  const personal = screen.getByText('我的文档', { selector: 'summary span' }).closest('summary')!;
  const work = screen.getByRole('button', { name: 'work.docx' });
  personal.focus();
  fireEvent.keyDown(personal, { key: 'ArrowRight' });
  expect(document.activeElement?.textContent).toContain('工作文档');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(work);
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(work, { key: 'ArrowLeft' });
  const folder = document.activeElement!;
  expect(folder.textContent).toContain('工作文档');
  fireEvent.keyDown(folder, { key: 'ArrowLeft' });
  expect(screen.queryByRole('button', { name: 'work.docx' })).toBeNull();
  fireEvent.keyDown(folder, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(personal);
  fireEvent.keyDown(personal, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(folder);
  fireEvent.keyDown(folder, { key: 'ArrowRight' });
  fireEvent.keyDown(folder, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'work.docx' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement?.textContent).toContain('模板');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement?.textContent).toContain('模板');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  fireEvent.keyDown(personal, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(personal);
  expect(select).not.toHaveBeenCalled();
});

it('锁定、输入法组合和带修饰键的按键均不触发目录切换', () => {
  const select = vi.fn();
  const view = (disabled: boolean) => (
    <DocumentFolderTree
      documents={[doc('work')]}
      projects={[]}
      selected="work"
      disabled={disabled}
      onSelect={select}
    />
  );
  const s = render(view(false));
  const personal = screen.getByText('我的文档', { selector: 'summary span' }).closest('summary')!;
  personal.focus();
  for (const extra of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
  ]) {
    fireEvent.keyDown(personal, { key: 'ArrowDown', ...extra });
    expect(document.activeElement).toBe(personal);
  }
  s.rerender(view(true));
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])
    fireEvent.keyDown(personal, { key });
  expect(document.activeElement).toBe(personal);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'work.docx' }).disabled).toBe(true);
  expect(select).not.toHaveBeenCalled();
});

it('同名项目中的同名文档沿各自稳定身份导航和激活，不按显示标题串选', () => {
  const documents = [
    { ...doc('first', '', 'project-first'), title: '同名文书.docx' },
    { ...doc('second', '', 'project-second'), title: '同名文书.docx' },
  ];
  const select = vi.fn();
  render(
    <DocumentFolderTree
      documents={documents}
      projects={
        [
          { id: 'project-first', title: '同名项目' },
          { id: 'project-second', title: '同名项目' },
        ] as Matter[]
      }
      selected="first"
      disabled={false}
      onSelect={select}
    />,
  );
  const projects = screen
    .getAllByText('同名项目', { selector: 'summary span' })
    .map((label) => label.closest('summary')!);
  projects[0].focus();
  fireEvent.keyDown(projects[0], { key: 'ArrowRight' });
  fireEvent.keyDown(projects[0], { key: 'ArrowRight' });
  expect(document.activeElement?.getAttribute('data-document-id')).toBe('first');
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(document.activeElement!);
  expect(select).toHaveBeenLastCalledWith(documents[0]);
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  fireEvent.keyDown(projects[0], { key: 'ArrowLeft' });
  fireEvent.keyDown(projects[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(projects[1]);
  fireEvent.keyDown(projects[1], { key: 'ArrowRight' });
  fireEvent.keyDown(projects[1], { key: 'ArrowRight' });
  expect(document.activeElement?.getAttribute('data-document-id')).toBe('second');
  expect(select).toHaveBeenCalledTimes(1);
  fireEvent.click(document.activeElement!);
  expect(select).toHaveBeenLastCalledWith(documents[1]);
  expect(select).toHaveBeenCalledTimes(2);
});
