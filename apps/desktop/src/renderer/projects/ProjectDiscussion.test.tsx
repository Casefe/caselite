// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { CatalogRequest } from '../../preload/caselite-api';
import { draftDoc } from '../editors/RichEditor';
import ProjectDiscussion from './ProjectDiscussion';

afterEach(cleanup);

it('retries the failed page and leaves an open update discussion attached to its original entry', async () => {
  const projectId = crypto.randomUUID();
  const doc = draftDoc({ text: '测试更新', state: null });
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const makeEntry = () => ({
    id: crypto.randomUUID(),
    committed_at: new Date().toISOString(),
    state,
  });
  const latest = makeEntry();
  const earlier = makeEntry();
  let failEarlier = true;
  const catalog = vi.fn(async (request: CatalogRequest) => {
    if (request.operation !== 'list_discussion') throw new Error('Unexpected operation');
    if (request.before && failEarlier)
      return { ok: false, code: 'UNAVAILABLE', message: '合成分页失败' };
    return {
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
      discussion:
        request.scope.kind === 'update_comment'
          ? { entries: [], next: null }
          : request.before
            ? { entries: [earlier], next: 1 }
            : { entries: [latest], next: 2 },
    };
  });
  window.caselite = { catalog } as unknown as Window['caselite'];
  render(
    <ProjectDiscussion
      projectId={projectId}
      activity
      archived={false}
      disabled={false}
      onDirty={vi.fn()}
    />,
  );
  const more = await screen.findByRole('button', { name: '加载更早的项目更新' });
  fireEvent.click(more);
  await screen.findByText('合成分页失败');
  const latestArticle = screen.getByRole('article');
  const open = within(latestArticle).getByRole('button', { name: '查看与评论更新' });
  fireEvent.click(open);
  await screen.findByText('暂无更新评论。');
  const retry = screen.getByRole('button', { name: '重新读取' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  expect((more as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(latestArticle).getByRole('button', { name: '收起讨论' }));
  failEarlier = false;
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(catalog.mock.lastCall?.[0]).toMatchObject({
    operation: 'list_discussion',
    scope: { kind: 'update', project_id: projectId },
    before: 2,
  });
  expect(screen.getAllByRole('article').map((entry) => entry.dataset.discussionId)).toEqual([
    latest.id,
    earlier.id,
  ]);
});
