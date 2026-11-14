// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DocumentFolderTree from './DocumentFolderTree';
import type { Matter } from '../../../preload/caselite-api';

afterEach(cleanup);

it('loads project originals when a keyboard user expands a project', () => {
  const onProjectOpen = vi.fn();
  render(
    <DocumentFolderTree
      documents={[]}
      projects={[{ id: 'keyboard-project', title: '项目 A' } as Matter]}
      selected={null}
      disabled={false}
      onSelect={vi.fn()}
      onProjectOpen={onProjectOpen}
      scopeKey="keyboard-test"
    />,
  );
  const project = screen.getByText('项目 A').closest('summary')!;
  fireEvent.keyDown(project, { key: 'ArrowRight' });
  expect(onProjectOpen).toHaveBeenCalledWith('keyboard-project');
});

it('opening project B folds project A and reads only the chosen project', () => {
  const onProjectOpen = vi.fn();
  render(
    <DocumentFolderTree
      documents={[]}
      projects={[{ id: 'a', title: '项目 A' } as Matter, { id: 'b', title: '项目 B' } as Matter]}
      selected={null}
      disabled={false}
      onSelect={vi.fn()}
      onProjectOpen={onProjectOpen}
      scopeKey="single-project-test"
    />,
  );
  const a = screen.getByText('项目 A').closest('summary')!;
  const b = screen.getByText('项目 B').closest('summary')!;
  fireEvent.click(a);
  expect(a.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(b);
  expect(a.getAttribute('aria-expanded')).toBe('false');
  expect(b.getAttribute('aria-expanded')).toBe('true');
  expect(onProjectOpen.mock.calls).toEqual([['a'], ['b']]);
});

it('project scope shows all its own documents including templates without global groups', () => {
  render(
    <DocumentFolderTree
      documents={[
        {
          id: 'own-template',
          title: '本项目模板',
          matter_id: 'a',
          collection: '合同模板',
        } as import('../../../preload/caselite-api').CatalogDocument,
        {
          id: 'other',
          title: '其他项目文档',
          matter_id: 'b',
          collection: '',
        } as import('../../../preload/caselite-api').CatalogDocument,
      ]}
      projects={[{ id: 'a', title: '项目 A' } as Matter]}
      projectId="a"
      scopeKey="project-scope-test"
      selected={null}
      disabled={false}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.queryByText('我的文档')).toBeNull();
  expect(screen.queryByText('模板')).toBeNull();
  fireEvent.click(screen.getByText('项目 A'));
  expect(screen.getByText('本项目模板')).toBeTruthy();
  expect(screen.queryByText('其他项目文档')).toBeNull();
});
