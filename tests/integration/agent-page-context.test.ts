import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { createAgentApplication, createTaskApplication } from '../../packages/application/src';
import { openTaskStore } from '../../packages/local-db/src';
import { documentReviewStore } from '../../apps/desktop/src/main/document-review-store';
import type { AgentResponse } from '../../packages/contracts/src';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const base = { protocol_version: 1 as const };
const mutation = () => ({ ...base, request_id: randomUUID(), idempotency_key: randomUUID() });
const credentials = {
  get: () => 'synthetic-page-key',
  set() {},
  clear() {},
  getDefaultModel: () => 'gpt-4.1-mini' as const,
  setDefaultModel() {},
};
function ok(r: AgentResponse) {
  if (!r.ok) throw new Error(r.message);
  return r;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-page-context-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'page.sqlite'), resolve('packages/local-db/migrations'));
  const tasks = createTaskApplication(store);
  function create(title: string, objective: string, paragraphs: string[]) {
    const r = tasks.execute({ ...mutation(), operation: 'create', title, objective });
    if (!r.ok) throw Error(r.message);
    let task = r.tasks[0];
    const doc = new Y.Doc();
    for (const line of paragraphs) {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, line);
      p.push([t]);
      doc.getXmlFragment('default').push([p]);
    }
    const save = tasks.execute({
      ...mutation(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: Array.from(Y.encodeStateAsUpdate(doc)),
    });
    doc.destroy();
    if (!save.ok) throw Error(save.message);
    task = save.tasks[0];
    return task;
  }
  const a = create('页面甲', '甲任务内容', ['甲正文：允许选中的句子。', '甲正文未选内容']);
  const b = create('页面乙', '乙任务内容', ['乙正文禁止混入']);
  const start = vi.fn(
    (input: Parameters<Parameters<typeof createAgentApplication>[0]['runtime']['start']>[0]) => {
      input.onText('合成本页回答');
      input.onEnd({ status: 'succeeded', usage: null, message: '完成' });
      return { cancel() {} };
    },
  );
  const ports = {
    credentials,
    history: store.agentHistory,
    page: store.agentPage,
    project: store.catalog.agentProject,
    review: documentReviewStore(store, tasks),
    taskExists: (id: string) => tasks.execute({ ...base, operation: 'read', task_id: id }).ok,
    runtime: { start },
  };
  const app = createAgentApplication(ports);
  const preview = async (scope: string, selected_text?: string, owner = 'window') =>
    ok(
      await app.execute(
        { ...base, operation: 'preview_page', scope, ...(selected_text ? { selected_text } : {}) },
        owner,
      ),
    ).page_preview!;
  const request = (scope: string, id: string) => ({
    ...base,
    operation: 'start' as const,
    scope,
    model: 'gpt-4.1-mini' as const,
    run_id: randomUUID(),
    prompt: '请说明本页',
    confirmed: true as const,
    page_context_id: id,
  });
  return { store, tasks, a, b, start, app, ports, preview, request };
}
it('references authoritative page or selection, isolates task/document/project history and survives restart replay', async () => {
  const s = setup();
  try {
    const scope = `document:${s.a.document_id}`;
    const reference = await s.preview(scope, '允许选中的句子。');
    expect(s.start).not.toHaveBeenCalled();
    expect(reference).toMatchObject({ title: '页面甲', mode: 'selection', characters: 8 });
    expect(JSON.stringify(reference)).not.toContain('允许选中的句子');
    const request = s.request(scope, reference.id);
    const run = ok(await s.app.execute(request, 'window')).runs[0];
    expect(run.page_reference).toEqual(reference);
    const sent = s.start.mock.calls[0][0].prompt;
    expect(sent).toContain('允许选中的句子。');
    expect(sent).not.toContain('甲正文未选内容');
    expect(sent).not.toContain('甲任务内容');
    expect(sent).not.toContain('乙正文');
    expect(
      ok(await s.app.execute({ ...base, operation: 'read', scope: s.a.id }, 'window')).runs,
    ).toEqual([]);
    expect(
      ok(
        await s.app.execute(
          { ...base, operation: 'read', scope: `document:${s.b.document_id}` },
          'window',
        ),
      ).runs,
    ).toEqual([]);
    const restarted = createAgentApplication(s.ports);
    expect(ok(await restarted.execute(request, 'new-window')).runs[0].id).toBe(run.id);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(() =>
      s.store.agentHistory.save({
        ...run,
        page_context_id: randomUUID(),
        sequence: run.sequence + 1,
      }),
    ).toThrow(/identity/);
    const whole = await s.preview(s.a.id);
    ok(await s.app.execute(s.request(s.a.id, whole.id), 'window'));
    expect(s.start.mock.calls[1][0].prompt).toContain('甲任务内容');
    expect(s.start.mock.calls[1][0].prompt).not.toContain('合成本页回答');
    const project = s.store.catalog.execute({
      ...mutation(),
      operation: 'create_project',
      title: '合成项目当前页',
      status: 'active',
    });
    if (!project.ok) throw Error(project.message);
    const projectScope = `project:${project.projects[0].id}`;
    const projectRef = await s.preview(projectScope);
    ok(await s.app.execute(s.request(projectScope, projectRef.id), 'window'));
    expect(s.start.mock.calls.at(-1)![0].prompt).toContain('合成项目当前页');
    expect(s.start.mock.calls.at(-1)![0].prompt).not.toContain('甲任务内容');
  } finally {
    s.store.close();
  }
});
it('rejects forged text, cross-page/window/workspace references, changed pages and changed idempotent input before dispatch', async () => {
  const s = setup();
  try {
    const scope = `document:${s.a.document_id}`;
    expect(
      await s.app.execute(
        { ...base, operation: 'preview_page', scope, selected_text: '乙正文禁止混入' },
        'window',
      ),
    ).toMatchObject({ ok: false, code: 'STALE_PAGE_CONTEXT' });
    const ref = await s.preview(scope);
    expect(
      await s.app.execute(s.request(`document:${s.b.document_id}`, ref.id), 'window'),
    ).toMatchObject({ ok: false, code: 'STALE_PAGE_CONTEXT' });
    expect(await s.app.execute(s.request(scope, ref.id), 'other-window')).toMatchObject({
      ok: false,
      code: 'STALE_PAGE_CONTEXT',
    });
    const elsewhere = openTaskStore(
      join(roots.at(-1)!, 'page.sqlite'),
      resolve('packages/local-db/migrations'),
      'elsewhere',
    );
    try {
      expect(elsewhere.agentPage.read(scope)).toBeUndefined();
    } finally {
      elsewhere.close();
    }
    const changed = s.tasks.execute({
      ...mutation(),
      operation: 'update',
      task_id: s.a.id,
      title: '页面甲已修改',
      objective: s.a.objective,
      expected_version: s.a.version,
    });
    expect(changed.ok).toBe(true);
    expect(await s.app.execute(s.request(scope, ref.id), 'window')).toMatchObject({
      ok: false,
      code: 'STALE_PAGE_CONTEXT',
    });
    expect(s.start).not.toHaveBeenCalled();
    const fresh = await s.preview(scope);
    const request = s.request(scope, fresh.id);
    ok(await s.app.execute(request, 'window'));
    expect(await s.app.execute({ ...request, page_context_id: ref.id }, 'window')).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(s.start).toHaveBeenCalledTimes(1);
  } finally {
    s.store.close();
  }
});
it('revalidates a page after asynchronous attachment preparation and enforces the combined text budget', async () => {
  const s = setup();
  try {
    const app = createAgentApplication({
      ...s.ports,
      resolveContext: async () => {
        s.tasks.execute({
          ...mutation(),
          operation: 'update',
          task_id: s.a.id,
          title: '准备时改动',
          objective: s.a.objective,
          expected_version: s.a.version,
        });
        return '合成附件';
      },
    });
    const r = ok(
      await app.execute({ ...base, operation: 'preview_page', scope: s.a.id }, 'window'),
    ).page_preview!;
    expect(
      await app.execute({ ...s.request(s.a.id, r.id), context_id: randomUUID() }, 'window'),
    ).toMatchObject({ ok: false, code: 'STALE_PAGE_CONTEXT' });
    const budget = createAgentApplication({
      ...s.ports,
      resolveContext: async () => '长'.repeat(32_000),
    });
    const ref = ok(
      await budget.execute({ ...base, operation: 'preview_page', scope: s.a.id }, 'window'),
    ).page_preview!;
    expect(
      await budget.execute({ ...s.request(s.a.id, ref.id), context_id: randomUUID() }, 'window'),
    ).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(s.start).not.toHaveBeenCalled();
  } finally {
    s.store.close();
  }
});
