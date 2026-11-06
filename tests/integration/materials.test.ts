import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import {
  createMaterialApplication,
  type PdfProcessorPort,
} from '../../packages/application/src/material-application';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import type { MaterialResponse, Material, TextPage } from '../../packages/contracts/src/material';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const migrations = resolve('packages/local-db/migrations');
const page: TextPage = {
  page: 1,
  text: '测试合同付款条款：甲方应于交付后十日内支付货款。',
  origin: 'pdf_text',
  blocks: [],
  width: 595,
  height: 842,
  rotation: 0,
};
function ok(result: MaterialResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}
function setup(
  processor: PdfProcessorPort = {
    configuration: 'synthetic-v1',
    inspect: async () => 1,
    process: async (_bytes, input) => input.onPage(page),
  },
) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-material-test-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), migrations),
    files = createMaterialFiles(join(root, 'materials'));
  const app = createMaterialApplication({
    store: store.materials,
    files,
    processor,
    id: randomUUID,
    hash: (text) => createHash('sha256').update(text).digest('hex'),
    taskExists: (id) => store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
    createTask(token, name) {
      const r = store.execute({
        protocol_version: 1,
        operation: 'create',
        request_id: randomUUID(),
        idempotency_key: token,
        title: name,
        objective: '',
      });
      if (!r.ok) throw new Error(r.message);
      return r.tasks[0].id;
    },
  });
  const fixture = resolve('tests/fixtures/case-materials/development/contract-v1-text.pdf');
  async function add() {
    const staged = ok(await app.stage(fixture, 'home')).staged!;
    const result = ok(
      await app.execute({
        protocol_version: 1,
        scope: 'home',
        operation: 'commit',
        token: staged.token,
      }),
    );
    return { token: staged.token, source: result.materials.at(-1)! };
  }
  async function settled(): Promise<Material[]> {
    for (let i = 0; i < 200; i++) {
      const result = ok(
        await app.execute({ protocol_version: 1, scope: 'home', operation: 'list' }),
      );
      if (result.materials.every((item) => item.status !== 'processing')) return result.materials;
      await new Promise((done) => setTimeout(done, 5));
    }
    throw new Error('Processing timeout');
  }
  return { root, store, files, app, fixture, add, settled };
}
it('preserves fixed bytes, separates same-name imports, and replays a committed token after restart', async () => {
  const s = setup();
  const first = await s.add();
  await s.settled();
  await s.add();
  await s.settled();
  expect(s.store.materials.list('home')).toHaveLength(2);
  expect(
    Buffer.from(await s.files.read(first.source.asset_version_id, first.source.sha256)),
  ).toEqual(readFileSync(s.fixture));
  const replay = ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'commit',
      token: first.token,
    }),
  );
  expect(replay.materials).toHaveLength(2);
  s.store.close();
  const reopened = openTaskStore(join(s.root, 'db.sqlite'), migrations);
  expect(reopened.materials.list('home')[0].id).toBe(first.source.id);
  expect(reopened.materials.list('home')[0].pages[0].text).toBe(page.text);
  reopened.close();
});
it('rejects symlinks and renamed non-PDFs without writing a ready source', async () => {
  const s = setup();
  symlinkSync(s.fixture, join(s.root, 'linked.pdf'));
  writeFileSync(join(s.root, 'wrong.pdf'), 'not a PDF');
  expect((await s.app.stage(join(s.root, 'linked.pdf'), 'home')).ok).toBe(false);
  expect((await s.app.stage(join(s.root, 'wrong.pdf'), 'home')).ok).toBe(false);
  expect(s.store.materials.list('home')).toEqual([]);
  s.store.close();
});
it('cancels staging and cannot commit that token afterwards', async () => {
  const s = setup();
  const staged = ok(await s.app.stage(s.fixture, 'home')).staged!;
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'discard',
      token: staged.token,
    }),
  );
  expect(
    (
      await s.app.execute({
        protocol_version: 1,
        scope: 'home',
        operation: 'commit',
        token: staged.token,
      })
    ).ok,
  ).toBe(false);
  expect(s.store.materials.list('home')).toEqual([]);
  s.store.close();
});
it('recovers a file placed before its database commit without replacing the original', async () => {
  const s = setup();
  const staged = ok(await s.app.stage(s.fixture, 'home')).staged!;
  const record = s.store.materials.stage(staged.token)!;
  await s.files.place(record.token, record.sha256);
  expect(s.store.materials.list('home')).toEqual([]);
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'commit',
      token: record.token,
    }),
  );
  await s.settled();
  expect(s.store.materials.list('home')).toHaveLength(1);
  s.store.close();
});
it('detects corruption and restores only matching bytes', async () => {
  const s = setup();
  const { source } = await s.add();
  await s.settled();
  writeFileSync(
    join(s.root, 'materials/originals', source.asset_version_id + '.pdf'),
    '%PDF-damaged',
  );
  expect(
    (
      await s.app.execute({
        protocol_version: 1,
        scope: 'home',
        operation: 'read',
        source_id: source.id,
      })
    ).ok,
  ).toBe(false);
  const staged = ok(await s.app.stage(s.fixture, 'home')).staged!;
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'restore',
      source_id: source.id,
      token: staged.token,
    }),
  );
  const read = ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'read',
      source_id: source.id,
    }),
  );
  expect(Buffer.from(read.data!)).toEqual(readFileSync(s.fixture));
  s.store.close();
});
it('freezes preview content and rejects changed model, task scope, incomplete page and stale derivation', async () => {
  const s = setup();
  const { source } = await s.add();
  await s.settled();
  const request = {
    protocol_version: 1,
    scope: 'home',
    operation: 'preview',
    instruction: '列出付款要求',
    model: 'gpt-4.1-mini',
    selected: [{ source_id: source.id, pages: [1] }],
  };
  const preview = ok(await s.app.execute(request)).preview!;
  expect(preview.payload).toContain(page.text);
  expect(preview.payload).toContain('物理页 1');
  expect(await s.app.resolveContext(preview.id, 'home', request.instruction, 'gpt-4.1-mini')).toBe(
    preview.payload,
  );
  await expect(
    s.app.resolveContext(preview.id, 'home', request.instruction, 'deepseek-flash'),
  ).rejects.toThrow();
  expect(
    (await s.app.execute({ ...request, selected: [{ source_id: source.id, pages: [2] }] })).ok,
  ).toBe(false);
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'process',
      source_id: source.id,
      ocr: true,
    }),
  );
  await s.settled();
  await expect(
    s.app.resolveContext(preview.id, 'home', request.instruction, 'gpt-4.1-mini'),
  ).rejects.toThrow();
  ok(await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'new_home' }));
  expect(s.store.materials.list('home')).toEqual([]);
  expect(
    (
      await s.app.execute({
        protocol_version: 1,
        scope: 'home',
        operation: 'read',
        source_id: source.id,
      })
    ).ok,
  ).toBe(false);
  expect(s.store.materials.list(source.task_id)).toHaveLength(1);
  s.store.close();
});
it('rejects late page output after cancellation and retains checkpoint for resume', async () => {
  const processor: PdfProcessorPort = {
    configuration: 'synthetic-cancel',
    inspect: async () => 2,
    async process(_bytes, input) {
      input.onPage(page);
      await new Promise<void>((resolve) =>
        input.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      input.onPage({ ...page, page: 2 });
    },
  };
  const s = setup(processor);
  const { source } = await s.add();
  await new Promise((done) => setTimeout(done, 30));
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'cancel',
      source_id: source.id,
    }),
  );
  const material = s.store.materials.get(source.id)!;
  expect(material.status).toBe('cancelled');
  expect(material.pages.map((p) => p.page)).toEqual([1]);
  s.store.close();
});
it('refuses over-budget context without truncation', async () => {
  const s = setup({
    configuration: 'synthetic-large',
    inspect: async () => 1,
    process: async (_bytes, input) => input.onPage({ ...page, text: '合'.repeat(33000) }),
  });
  const { source } = await s.add();
  await s.settled();
  const result = await s.app.execute({
    protocol_version: 1,
    scope: 'home',
    operation: 'preview',
    instruction: '核对',
    model: 'gpt-4.1-mini',
    selected: [{ source_id: source.id, pages: [1] }],
  });
  expect(result).toMatchObject({ ok: false, code: 'BUDGET' });
  s.store.close();
});
it('does not reuse pages after processor configuration changes or a forced OCR run', async () => {
  const previous: TextPage[][] = [];
  const processor: PdfProcessorPort = {
    configuration: 'v1',
    inspect: async () => 1,
    process: async (_bytes, input) => {
      previous.push(input.previous.map((p) => ({ ...p })));
      input.onPage(page);
    },
  };
  const s = setup(processor);
  const { source } = await s.add();
  await s.settled();
  processor.configuration = 'v2';
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'process',
      source_id: source.id,
      ocr: true,
    }),
  );
  await s.settled();
  expect(previous[1]).toEqual([]);
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'process',
      source_id: source.id,
      ocr: true,
      force: true,
    }),
  );
  await s.settled();
  expect(previous[2]).toEqual([]);
  s.store.close();
});
it('replays restore after a lost acknowledgement without changing source identity', async () => {
  const s = setup();
  const { source } = await s.add();
  await s.settled();
  const token = ok(await s.app.stage(s.fixture, 'home')).staged!.token;
  const restore = {
    protocol_version: 1,
    scope: 'home',
    operation: 'restore',
    source_id: source.id,
    token,
  };
  ok(await s.app.execute(restore));
  ok(await s.app.execute(restore));
  expect(s.store.materials.list('home').map((item) => item.id)).toEqual([source.id]);
  s.store.close();
});
it('keeps the home identity while an import still needs commit or discard', async () => {
  const s = setup();
  const pending = ok(await s.app.stage(s.fixture, 'home')).staged!;
  expect(
    await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'new_home' }),
  ).toMatchObject({ ok: false, code: 'BUSY' });
  ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'commit',
      token: pending.token,
    }),
  );
  const [source] = await s.settled();
  expect(s.store.materials.task('home')).toBe(source.task_id);
  expect(s.store.materials.list('home')).toHaveLength(1);
  s.app.close();
  s.store.close();
});
