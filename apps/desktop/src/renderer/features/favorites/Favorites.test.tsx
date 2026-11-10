// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { createWorkbenchQueryClient } from '../../shared/data/workbench-query-client';
import { useProjectCatalog } from '../../shared/data/ordinary-catalog-query';
import {
  LocalPreferencesProvider,
  initialLocalPreferences,
  useLocalPreferences,
} from '../../shared/data/LocalPreferences';
import { FavoriteButton, FavoritesProvider, FavoritesSidebar } from './Favorites';
import type {
  CatalogRequest,
  LocalPreferences,
  LocalPreferencesRequest,
  Task,
} from '../../../preload/caselite-api';

afterEach(cleanup);
const taskId = 'a9a219f8-01d7-4225-bc61-a100557c0059';
const projectId = '23ae1bf6-3da8-48cc-890e-52318ce4b536';
const documentId = 'f8a29142-976a-4cd8-aadb-2226330d22fc';
function setup(fail = false) {
  let persisted: LocalPreferences = { ...initialLocalPreferences };
  let committed: { receipt: string; preferences: LocalPreferences } | null = null;
  let project: { id: string; title: string; archived_at: string | null } = {
    id: projectId,
    title: '合成项目',
    archived_at: null,
  };
  let doc = {
    id: documentId,
    task_id: taskId,
    title: '合成文档',
    archived_at: null,
    favorite: false,
    collection: '',
    tags: [],
    in_library: true,
    version: 1,
  };
  const catalog = vi.fn(async (request: CatalogRequest) => {
    if (request.operation === 'organize_document')
      doc = { ...doc, favorite: request.favorite, version: doc.version + 1 };
    return {
      ok: true,
      projects: [project],
      documents: [doc],
      tasks: [],
      receipt: null,
    };
  });
  const preferences = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'read')
      return { ok: true, preferences: structuredClone(persisted), receipt: null };
    if (request.operation === 'status') return { ok: true, ...committed };
    persisted = { ...request.values, version: request.expected_version + 1 };
    committed = { preferences: structuredClone(persisted), receipt: request.idempotency_key };
    if (fail) {
      fail = false;
      throw new Error('lost receipt');
    }
    return { ok: true, ...committed };
  });
  window.caselite = { preferences, catalog } as unknown as Window['caselite'];
  function Draft() {
    const p = useLocalPreferences();
    const projectRead = useProjectCatalog();
    return (
      <>
        <button onClick={() => p.change({ name: '尚未保存的称呼' })}>修改称呼草稿</button>
        <output aria-label="称呼草稿">{p.draft.name}</output>
        <button
          onClick={() => {
            project = { ...project, title: '项目已更名' };
            projectRead.onCommit();
          }}
        >
          模拟项目已保存
        </button>
        <button
          onClick={() => {
            project = { ...project, archived_at: '2026-11-10T00:00:00Z' };
            projectRead.onCommit();
          }}
        >
          模拟项目已归档
        </button>
      </>
    );
  }
  const onOpen = vi.fn();
  const view = () => (
    <LocalPreferencesProvider>
      <QueryClientProvider client={createWorkbenchQueryClient()}>
        <FavoritesProvider>
          <Draft />
          <FavoriteButton kind="task" id={taskId} />
          <FavoriteButton kind="project" id={projectId} />
          <FavoriteButton kind="document" id={documentId} />
          <FavoritesSidebar tasks={[{ id: taskId, title: '合成任务' } as Task]} onOpen={onOpen} />
        </FavoritesProvider>
      </QueryClientProvider>
    </LocalPreferencesProvider>
  );
  const rendered = render(view());
  return { rendered, view, preferences, catalog, onOpen, stored: () => persisted };
}
async function clickReady(name: string) {
  const button = screen.getByRole<HTMLButtonElement>('button', { name, exact: true });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

it('stars three object types, creates folders, moves existing favorites by drag and keyboard, and restores them after remount', async () => {
  const s = setup();
  await clickReady('修改称呼草稿');
  await clickReady('收藏任务');
  await clickReady('收藏项目');
  await clickReady('收藏文档');
  await screen.findByRole('button', { name: '合成文档', exact: true });
  expect(screen.getByLabelText('称呼草稿').textContent).toBe('尚未保存的称呼');
  expect(s.stored().name).toBe(initialLocalPreferences.name);
  expect(s.stored().favorite_navigation?.references.map((r) => r.kind)).toEqual([
    'task',
    'project',
  ]);
  expect(s.catalog.mock.calls.filter(([r]) => r.operation === 'organize_document')).toHaveLength(1);
  await clickReady('新建收藏文件夹');
  fireEvent.change(screen.getByLabelText('收藏文件夹名称'), { target: { value: '诉讼案件' } });
  fireEvent.keyDown(screen.getByLabelText('收藏文件夹名称'), { key: 'Enter', isComposing: true });
  expect(s.stored().favorite_navigation?.folders).toHaveLength(0);
  await clickReady('创建');
  const folderButton = await screen.findByRole('button', { name: '诉讼案件', exact: true });
  const folder = folderButton.closest('[data-favorite-folder]')!;
  const id = s.stored().favorite_navigation!.folders[0].id;
  const task = screen.getByRole('button', { name: '合成任务', exact: true }).parentElement!;
  const data = new Map<string, string>();
  const dataTransfer = {
    setData: (t: string, v: string) => data.set(t, v),
    getData: (t: string) => data.get(t) ?? '',
    effectAllowed: '',
    dropEffect: '',
  };
  fireEvent.dragStart(task, { dataTransfer });
  fireEvent.dragOver(folder, { dataTransfer });
  fireEvent.drop(folder, { dataTransfer });
  await waitFor(() =>
    expect(
      within(folder as HTMLElement).getByRole('button', { name: '合成任务', exact: true }),
    ).toBeTruthy(),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLSelectElement>('combobox', { name: '移动收藏 合成文档' }).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByRole('combobox', { name: '移动收藏 合成文档' }), {
    target: { value: id },
  });
  await waitFor(() =>
    expect(
      within(folder as HTMLElement).getByRole('button', { name: '合成文档', exact: true }),
    ).toBeTruthy(),
  );
  await clickReady('合成文档');
  expect(s.onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'document', id: documentId }),
  );
  s.rendered.unmount();
  render(s.view());
  const reopened = (await screen.findByRole('button', { name: '诉讼案件', exact: true })).closest(
    '[data-favorite-folder]',
  )!;
  expect(
    within(reopened as HTMLElement).getByRole('button', { name: '合成任务', exact: true }),
  ).toBeTruthy();
  expect(
    within(reopened as HTMLElement).getByRole('button', { name: '合成文档', exact: true }),
  ).toBeTruthy();
  await clickReady('取消收藏任务');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '合成任务', exact: true })).toBeNull(),
  );
  expect(screen.getByRole('button', { name: '诉讼案件', exact: true })).toBeTruthy();
});

it('waits for the original receipt after a lost response and never displays an unconfirmed star', async () => {
  const s = setup(true);
  await clickReady('收藏任务');
  await screen.findByRole('button', { name: '核对收藏提交' });
  expect(screen.getByRole('button', { name: '收藏任务' }).getAttribute('aria-pressed')).toBe(
    'false',
  );
  expect(screen.queryByRole('button', { name: '合成任务', exact: true })).toBeNull();
  await clickReady('核对收藏提交');
  await screen.findByRole('button', { name: '取消收藏任务' });
  expect(s.preferences.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '合成任务', exact: true })).toBeTruthy();
});

it('finishes the original folder form after receipt recovery instead of inviting duplicate creation', async () => {
  const s = setup(true);
  await clickReady('新建收藏文件夹');
  fireEvent.change(screen.getByLabelText('收藏文件夹名称'), {
    target: { value: '原键恢复文件夹' },
  });
  await clickReady('创建');
  await screen.findByRole('button', { name: '核对收藏提交' });
  expect(screen.getByLabelText('收藏文件夹名称')).toBeTruthy();
  await clickReady('核对收藏提交');
  await screen.findByRole('button', { name: '原键恢复文件夹', exact: true });
  expect(screen.queryByLabelText('收藏文件夹名称')).toBeNull();
  expect(s.preferences.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  await clickReady('新建收藏文件夹');
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '收藏文件夹名称' }).value).toBe('');
});

it('refreshes favorite project labels and hides archived targets when the project owner commits', async () => {
  setup();
  await clickReady('收藏项目');
  await screen.findByRole('button', { name: '合成项目', exact: true });
  await clickReady('模拟项目已保存');
  await screen.findByRole('button', { name: '项目已更名', exact: true });
  expect(screen.queryByRole('button', { name: '合成项目', exact: true })).toBeNull();
  await clickReady('模拟项目已归档');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '项目已更名', exact: true })).toBeNull(),
  );
});
