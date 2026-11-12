// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogRequest } from '../../packages/contracts/src';
import { createCatalogApplication } from '../../packages/application/src';
import { DiscussionFeed } from '../../apps/desktop/src/renderer/shared/discussion/DiscussionFeed';

const originalApi = Object.getOwnPropertyDescriptor(window, 'caselite');
afterEach(() => {
  cleanup();
  if (originalApi) Object.defineProperty(window, 'caselite', originalApi);
  else Reflect.deleteProperty(window, 'caselite');
});
const empty = { ok: true, discussion: { entries: [], next: null } };
type Publication = Extract<CatalogRequest, { operation: 'publish_discussion' }>;
function confirmed(request: Publication) {
  return { ok: true, receipt: request.idempotency_key, target_id: crypto.randomUUID() };
}
function editor() {
  return screen.getByRole('textbox', { name: '项目评论' }) as HTMLElement & { editor: Editor };
}
async function mount(catalog: ReturnType<typeof vi.fn>, text = '合成评论草稿') {
  Object.defineProperty(window, 'caselite', { configurable: true, value: { catalog } });
  render(
    <DiscussionFeed
      scope={{ kind: 'project_comment', project_id: crypto.randomUUID() }}
      archived={false}
      disabled={false}
      compose
      onDirty={vi.fn()}
    />,
  );
  await screen.findByText('暂无项目评论。');
  act(() => {
    editor().editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
  });
  return screen.getByRole('button', { name: '发布项目评论' });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function publications(catalog: ReturnType<typeof vi.fn>): Publication[] {
  return catalog.mock.calls
    .map(([request]) => request as CatalogRequest)
    .filter((request): request is Publication => request.operation === 'publish_discussion');
}

it('keeps a pending draft and sends only one publication for repeated clicks', async () => {
  const pending = deferred<ReturnType<typeof confirmed>>();
  const catalog = vi.fn((request: CatalogRequest) =>
    request.operation === 'publish_discussion' ? pending.promise : Promise.resolve(empty),
  );
  const button = await mount(catalog);
  fireEvent.click(button);
  fireEvent.click(button);
  expect(publications(catalog)).toHaveLength(1);
  expect(editor().editor.getText()).toBe('合成评论草稿');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    pending.resolve(confirmed(publications(catalog)[0]));
    await pending.promise;
  });
  await screen.findByText('已发布项目评论。');
  expect(editor().editor.getText()).toBe('');
});

it('retains an unknown publication and replays its exact identity only after status reports not found', async () => {
  let attempts = 0;
  let first!: Publication;
  const catalog = vi.fn(async (request: CatalogRequest) => {
    if (request.operation === 'publish_discussion') {
      if (++attempts === 1) {
        first = structuredClone(request);
        throw new Error('synthetic lost acknowledgement');
      }
      return confirmed(request);
    }
    if (request.operation === 'status')
      return { ok: false, code: 'NOT_FOUND', message: '合成未提交' };
    return empty;
  });
  fireEvent.click(await mount(catalog));
  const check = await screen.findByRole('button', { name: '核对原发布' });
  expect(editor().editor.getText()).toBe('合成评论草稿');
  expect(publications(catalog)).toHaveLength(1);
  expect((screen.getByRole('button', { name: '发布项目评论' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(check);
  await screen.findByText('已发布项目评论。');
  const sent = publications(catalog);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(first);
  expect(catalog.mock.calls.map(([request]) => request.operation)).toEqual([
    'list_discussion',
    'publish_discussion',
    'status',
    'publish_discussion',
    'list_discussion',
  ]);
});

it('does not replay on uncertain status and clears the draft only after its original receipt is confirmed', async () => {
  let statusReads = 0;
  let original!: Publication;
  const catalog = vi.fn(async (request: CatalogRequest) => {
    if (request.operation === 'publish_discussion') {
      original = request;
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成提交未知' };
    }
    if (request.operation === 'status')
      return ++statusReads === 1
        ? { ok: false, code: 'UNAVAILABLE', message: '合成核对不可用' }
        : confirmed(original);
    return empty;
  });
  fireEvent.click(await mount(catalog));
  fireEvent.click(await screen.findByRole('button', { name: '核对原发布' }));
  await screen.findByText('合成核对不可用');
  expect(editor().editor.getText()).toBe('合成评论草稿');
  expect(publications(catalog)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '核对原发布' }));
  await screen.findByText('已发布项目评论。');
  expect(publications(catalog)).toHaveLength(1);
  expect(
    catalog.mock.calls.flatMap(([r]) => (r.operation === 'status' ? [r.idempotency_key] : [])),
  ).toEqual([original.idempotency_key, original.idempotency_key]);
  expect(editor().editor.getText()).toBe('');
});

it('preserves a rejected draft so the user can deliberately submit a new publication', async () => {
  let attempts = 0;
  const catalog = vi.fn(async (request: CatalogRequest) => {
    if (request.operation === 'publish_discussion')
      return ++attempts === 1
        ? { ok: false, code: 'CONFLICT', message: '合成明确拒绝' }
        : confirmed(request);
    return empty;
  });
  fireEvent.click(await mount(catalog));
  await screen.findByText('合成明确拒绝');
  expect(editor().editor.getText()).toBe('合成评论草稿');
  expect(screen.queryByRole('button', { name: '核对原发布' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '发布项目评论' }));
  await screen.findByText('已发布项目评论。');
  const sent = publications(catalog);
  expect(sent).toHaveLength(2);
  expect(sent[1].idempotency_key).not.toBe(sent[0].idempotency_key);
  expect(sent[1].state).toEqual(sent[0].state);
});

it('treats a mismatched success receipt as unknown and retains the original draft', async () => {
  const catalog = vi.fn(async (request: CatalogRequest) =>
    request.operation === 'publish_discussion'
      ? { ok: true, receipt: crypto.randomUUID(), target_id: crypto.randomUUID() }
      : empty,
  );
  fireEvent.click(await mount(catalog));
  await screen.findByText('发布结果未知，草稿已保留。请核对原发布。');
  expect(editor().editor.getText()).toBe('合成评论草稿');
  expect(screen.queryByText('已发布项目评论。')).toBeNull();
  expect(publications(catalog)).toHaveLength(1);
});

it('does not publish during composition and renders literal HTML text safely', async () => {
  const catalog = vi.fn(async (request: CatalogRequest) =>
    request.operation === 'publish_discussion' ? confirmed(request) : empty,
  );
  const text = '<img src=x onerror="synthetic()"><script>合成文字</script>';
  const button = await mount(catalog, text);
  expect(editor().editor.getText()).toBe(text);
  expect(editor().querySelector('img,script')).toBeNull();
  fireEvent.compositionStart(editor());
  fireEvent.click(button);
  expect(publications(catalog)).toHaveLength(0);
  fireEvent.compositionEnd(editor());
  fireEvent.click(button);
  await screen.findByText('已发布项目评论。');
  expect(publications(catalog)).toHaveLength(1);
});

it.each(['actor', 'workspace_id', 'body_id', 'committed_at', 'comment_html'])(
  'rejects forged %s before the publication port',
  (field) => {
    const execute = vi.fn();
    const app = createCatalogApplication({ execute });
    const result = app.execute({
      protocol_version: 1,
      operation: 'publish_discussion',
      request_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      scope: { kind: 'project_comment', project_id: crypto.randomUUID() },
      state: [1],
      [field]: 'synthetic-forgery',
    });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(execute).not.toHaveBeenCalled();
  },
);
