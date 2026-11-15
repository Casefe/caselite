import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { createAgentApplication, createTaskApplication } from '../../packages/application/src';
import { openTaskStore } from '../../packages/local-db/src';
import { documentReviewStore } from '../../apps/desktop/src/main/document-review-store';
import type {
  AgentModel,
  AgentResponse,
  Material,
  MaterialPreview,
} from '../../packages/contracts/src';
import { createImportantDateApplication } from '../../packages/application/src/important-date-application';
import {
  assessAgentInput,
  agentUtf8Bytes,
  AGENT_SYSTEM_TEXT,
  AGENT_TEXT_MAX_BYTES,
} from '../../packages/application/src/agent-input-budget';

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

it('applies the same budget after page wrapping and allows a full long attachment only for the qualified model', async () => {
  const s = setup();
  try {
    const reference = await s.preview(s.a.id);
    let text = 'a'.repeat(262_000);
    const capability = {
      provider: 'deepseek',
      model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com',
      contextWindow: 1_000_000,
      input: ['text'],
    };
    const app = createAgentApplication({
      ...s.ports,
      credentials: { ...credentials, getDefaultModel: () => 'deepseek-flash' },
      runtime: { start: s.start, inputCapability: () => capability },
      resolveContext: async () => text,
    });
    const wrappedReference = ok(
      await app.execute({ ...base, operation: 'preview_page', scope: s.a.id }, 'window'),
    ).page_preview!;
    const request = {
      ...s.request(s.a.id, wrappedReference.id),
      model: 'deepseek-flash',
      context_id: randomUUID(),
    };
    expect(await app.execute(request, 'window')).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(s.start).not.toHaveBeenCalled();
    expect(s.store.agentHistory.load()).toHaveLength(0);
    text = '全量材料'.repeat(9000) + 'FINAL_ATTACHMENT_END';
    expect((await app.execute({ ...request, run_id: randomUUID() }, 'window')).ok).toBe(true);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.start.mock.calls[0][0].prompt).toContain(text);
    expect(reference).toBeDefined();
  } finally {
    s.store.close();
  }
});

function dateBudgetFixture(defaultModel: AgentModel = 'deepseek-flash') {
  const s = setup();
  const typeId = 'synthetic-hearing';
  const sourceId = randomUUID(),
    derivationId = randomUUID(),
    previewId = randomUUID();
  const source: Material = {
    id: sourceId,
    task_id: s.a.id,
    asset_version_id: randomUUID(),
    name: '合成日期材料.pdf',
    sha256: 'a'.repeat(64),
    bytes: 100,
    derivation_id: derivationId,
    status: 'ready',
    page_count: 3,
    pages: [1, 2, 3].map((page) => ({
      page,
      text: '',
      origin: 'pdf_text',
      blocks: [],
      width: 595,
      height: 842,
      rotation: 0,
    })),
  };
  const preview: MaterialPreview = {
    id: previewId,
    task_id: s.a.id,
    instruction: '提取重要日期',
    model: 'deepseek-flash',
    payload: '',
    sha256: 'b'.repeat(64),
    selections: [
      { source_id: sourceId, derivation_id: derivationId, name: source.name, pages: [1, 2, 3] },
    ],
  };
  const dates = createImportantDateApplication(
    {
      task: (id) => (id === s.a.id ? s.a : null),
      types: () => [{ id: typeId, name: '合成开庭', version: 1, enabled: true, show_home: false }],
      preview: (id, scope) => (id === previewId && scope === s.a.id ? preview : undefined),
      source: (id, derivation) =>
        id === sourceId && derivation === derivationId ? source : undefined,
      configuration: (id) => (id === derivationId ? 'synthetic-date-budget-v1' : undefined),
      run: () => undefined,
      confirmations: () => [],
      receipt: () => undefined,
      commit: () => {
        throw new Error('预算场景不可确认日期');
      },
    },
    async () => {},
  );
  const binding = dates.prepare(s.a.id, preview.id, [typeId], s.a.version);
  const remaining =
    AGENT_TEXT_MAX_BYTES -
    agentUtf8Bytes(AGENT_SYSTEM_TEXT) -
    agentUtf8Bytes(dates.prompt(binding, ''));
  const setText = (text: string) => {
    preview.payload = text;
    source.pages.forEach((page, index) => {
      page.text = text.slice(index * 90_000, (index + 1) * 90_000);
    });
  };
  setText('a'.repeat(remaining - 'END_SENTINEL'.length) + 'END_SENTINEL');
  const prepare = vi.spyOn(dates, 'prepare'),
    prompt = vi.spyOn(dates, 'prompt');
  const capability = {
    provider: 'deepseek',
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: 1_000_000,
    input: ['text'],
  };
  const resolveContext = vi.fn(async () => preview.payload);
  const app = createAgentApplication({
    ...s.ports,
    dates,
    resolveContext,
    credentials: { ...credentials, getDefaultModel: () => defaultModel },
    runtime: { start: s.start, inputCapability: () => capability },
  });
  const request = {
    ...base,
    operation: 'start' as const,
    scope: s.a.id,
    run_id: randomUUID(),
    model: 'deepseek-flash' as const,
    prompt: preview.instruction,
    confirmed: true as const,
    purpose: 'important_dates' as const,
    context_id: preview.id,
    date_types: [typeId],
    task_version: s.a.version,
  };
  return { ...s, app, request, preview, prepare, prompt, resolveContext, capability, setText };
}

it('preserves MODEL_CHANGED before resolving materials or preparing dates', async () => {
  const s = dateBudgetFixture('gpt-4.1-mini');
  try {
    expect(await s.app.execute(s.request, 'window')).toMatchObject({
      ok: false,
      code: 'MODEL_CHANGED',
    });
    expect(s.resolveContext).not.toHaveBeenCalled();
    expect(s.prepare).not.toHaveBeenCalled();
    expect(s.prompt).not.toHaveBeenCalled();
    expect(s.start).not.toHaveBeenCalled();
    expect(s.store.agentHistory.load()).toHaveLength(0);
  } finally {
    s.store.close();
  }
});

it.each([0, 1])(
  'checks real date wrapping at the visible UTF8 boundary plus %s byte before registration',
  async (extra) => {
    const s = dateBudgetFixture();
    try {
      s.setText(s.preview.payload + 'x'.repeat(extra));
      expect(
        assessAgentInput({
          text: s.preview.payload,
          model: 'deepseek-flash',
          capability: s.capability,
        }).accepted,
      ).toBe(true);
      const result = await s.app.execute(s.request, 'window');
      expect(result).toMatchObject(extra ? { ok: false, code: 'BUDGET' } : { ok: true });
      expect(s.prepare).toHaveBeenCalledTimes(1);
      expect(s.prompt).toHaveBeenCalledTimes(1);
      const wrapped = s.prompt.mock.results[0].value as string;
      expect(agentUtf8Bytes(wrapped) + agentUtf8Bytes(AGENT_SYSTEM_TEXT)).toBe(
        AGENT_TEXT_MAX_BYTES + extra,
      );
      expect(wrapped.endsWith('END_SENTINEL' + 'x'.repeat(extra))).toBe(true);
      expect(s.start).toHaveBeenCalledTimes(extra ? 0 : 1);
      expect(s.store.agentHistory.load()).toHaveLength(extra ? 0 : 1);
      if (!extra) expect(s.start.mock.calls[0][0].prompt).toBe(wrapped);
    } finally {
      s.store.close();
    }
  },
);

it('rejects an unknown date type through real prepare without wrapping, registration or dispatch', async () => {
  const s = dateBudgetFixture();
  try {
    expect(
      await s.app.execute({ ...s.request, date_types: ['unknown-type'] }, 'window'),
    ).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(s.prepare).toHaveBeenCalledTimes(1);
    expect(s.prepare.mock.results[0].type).toBe('throw');
    expect(s.prompt).not.toHaveBeenCalled();
    expect(s.start).not.toHaveBeenCalled();
    expect(s.store.agentHistory.load()).toHaveLength(0);
  } finally {
    s.store.close();
  }
});
