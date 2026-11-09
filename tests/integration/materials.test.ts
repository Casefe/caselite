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
  docxPreview?: (bytes: Uint8Array) => Promise<{ html: string; warningCount: number }>,
) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-material-test-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), migrations),
    files = createMaterialFiles(join(root, 'materials'));
  const app = createMaterialApplication({
    store: store.materials,
    files,
    processor,
    docxProcessor: docxPreview ? processor : undefined,
    docxPreview,
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
it('serializes semantic preview, releases a failed worker slot and rechecks source scope', async () => {
  let resolve!: (value: { html: string; warningCount: number }) => void;
  let reject!: (reason: Error) => void;
  let calls = 0;
  const s = setup(undefined, async () => {
    calls++;
    return new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
  });
  try {
    // 仅模拟转换器，真实 ZIP/Mammoth 由打包桌面合成 DOCX 另验。
    const file = join(s.root, 'synthetic.docx');
    writeFileSync(file, Buffer.from([80, 75, 3, 4, 0, 0, 0, 0]));
    const stage = ok(await s.app.stage(file, 'home')).staged!;
    const source = ok(
      await s.app.execute({
        protocol_version: 1,
        operation: 'commit',
        scope: 'home',
        token: stage.token,
      }),
    ).materials[0];
    await s.settled();
    const request = {
      protocol_version: 1,
      operation: 'docx_semantic_preview',
      scope: 'home',
      source_id: source.id,
    };
    const first = s.app.execute(request);
    for (let i = 0; i < 100 && calls === 0; i++) await new Promise((done) => setTimeout(done, 5));
    expect(calls).toBe(1);
    expect(await s.app.execute(request)).toMatchObject({ ok: false, code: 'BUSY' });
    expect(calls).toBe(1);
    reject(new Error('converter failure'));
    expect(await first).toMatchObject({ ok: false });
    const second = s.app.execute(request);
    for (let i = 0; i < 100 && calls === 1; i++) await new Promise((done) => setTimeout(done, 5));
    expect(calls).toBe(2);
    ok(await s.app.execute({ protocol_version: 1, operation: 'new_home', scope: 'home' }));
    resolve({ html: '<p>不能跨范围泄露</p>', warningCount: 0 });
    expect(await second).toMatchObject({ ok: false });
  } finally {
    s.store.close();
  }
});
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

it('does not return original bytes after the home scope changes during a read', async () => {
  const s = setup();
  try {
    const { source } = await s.add();
    await s.settled();
    const read = s.files.read.bind(s.files);
    let release!: () => void;
    s.files.read = async (id, sha) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return read(id, sha);
    };
    const pending = s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'read',
      source_id: source.id,
    });
    ok(await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'new_home' }));
    release();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'MATERIAL_UNAVAILABLE' });
    expect(result).not.toHaveProperty('data');
  } finally {
    s.store.close();
  }
});
it('projects existing fixed sources, rejects foreign scopes, and rechecks membership after an asynchronous read', async () => {
  const s = setup();
  const first = await s.add();
  await s.settled();
  await s.add();
  await s.settled();
  const command = (input: object) =>
    s.store.catalog.execute({
      protocol_version: 1,
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      ...input,
    } as Parameters<typeof s.store.catalog.execute>[0]);
  const created = command({ operation: 'create_project', title: '合成项目' });
  if (!created.ok) throw new Error(created.message);
  const project = created.target_id!;
  const query = { protocol_version: 1, operation: 'list_project', project_id: project };
  expect(ok(await s.app.execute(query)).materials).toEqual([]);
  const read = s.store.execute({
    protocol_version: 1,
    operation: 'read',
    task_id: first.source.task_id,
  });
  if (!read.ok) throw new Error(read.message);
  command({
    operation: 'assign_task',
    task_id: first.source.task_id,
    expected_version: read.tasks[0].version,
    matter_id: project,
  });
  const listed = ok(await s.app.execute(query)).materials;
  const other = openTaskStore(join(s.root, 'db.sqlite'), migrations, 'other-workspace');
  expect(other.materials.projectSources(project)).toBeUndefined();
  other.close();
  expect(listed.map((m) => m.id)).toEqual(s.store.materials.list('home').map((m) => m.id));
  expect(new Set(listed.map((m) => m.name)).size).toBe(1);
  expect(new Set(listed.map((m) => m.id)).size).toBe(2);
  const request = { ...query, operation: 'read_project', source_id: first.source.id };
  expect(Buffer.from(ok(await s.app.execute(request)).data!)).toEqual(readFileSync(s.fixture));
  expect((await s.app.execute({ ...request, project_id: randomUUID() })).ok).toBe(false);
  const originalRead = s.files.read;
  s.files.read = async (...args) => {
    const task = s.store.execute({
      protocol_version: 1,
      operation: 'read',
      task_id: first.source.task_id,
    });
    if (!task.ok) throw new Error(task.message);
    command({
      operation: 'assign_task',
      task_id: first.source.task_id,
      expected_version: task.tasks[0].version,
      matter_id: null,
    });
    return originalRead(...args);
  };
  expect((await s.app.execute(request)).ok).toBe(false);
  expect(ok(await s.app.execute(query)).materials).toEqual([]);
  expect(s.store.materials.list(first.source.task_id).map((m) => m.id)).toEqual(
    listed.map((m) => m.id),
  );
  const taskAfter = s.store.execute({
    protocol_version: 1,
    operation: 'read',
    task_id: first.source.task_id,
  });
  if (!taskAfter.ok) throw new Error(taskAfter.message);
  command({
    operation: 'assign_task',
    task_id: first.source.task_id,
    expected_version: taskAfter.tasks[0].version,
    matter_id: project,
  });
  s.files.read = async (...args) => {
    command({ operation: 'archive_project', id: project, expected_version: 1, archived: true });
    return originalRead(...args);
  };
  expect((await s.app.execute(request)).ok).toBe(false);
  expect((await s.app.execute(query)).ok).toBe(false);
  s.store.close();
  const reopened = openTaskStore(join(s.root, 'db.sqlite'), migrations);
  expect(reopened.materials.list(first.source.task_id)[0].sha256).toBe(first.source.sha256);
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
  expect(
    await s.app.resolveContext(preview.id, 'home', request.instruction, 'gpt-4.1-mini'),
  ).toMatchObject({ text: preview.payload });
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

it('automatically awaits text extraction and freezes scan images without local OCR for a vision model', async () => {
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  const modes: boolean[] = [];
  let image = 'c3ludGhldGljLWltYWdl';
  const s = setup({
    configuration: 'vision-test',
    inspect: async () => 1,
    async process(_bytes, input) {
      modes.push(input.ocr);
      await wait;
      input.onPage({ ...page, origin: 'needs_ocr', text: '' });
    },
    render: async () => [image],
  });
  const { source } = await s.add();
  const pending = s.app.execute({
    protocol_version: 1,
    scope: 'home',
    operation: 'preview',
    instruction: '分析扫描件',
    model: 'deepseek-flash',
    automatic: true,
    selected: [{ source_id: source.id, pages: [1] }],
  });
  release();
  const preview = ok(await pending).preview!;
  expect(modes).toEqual([false]);
  expect(preview.images).toHaveLength(1);
  expect(preview.payload).toContain('物理页 1｜对应附图 1');
  expect(
    await s.app.resolveContext(preview.id, 'home', '分析扫描件', 'deepseek-flash'),
  ).toMatchObject({
    images: [{ type: 'image', data: image }],
    attachments: [{ source_id: source.id, pages: [1] }],
  });
  image = 'changed';
  await expect(
    s.app.resolveContext(preview.id, 'home', '分析扫描件', 'deepseek-flash'),
  ).rejects.toThrow('IMAGE_CHANGED');
  s.store.close();
});
it('automatically uses local OCR only for a text model and includes the complete derived text', async () => {
  const modes: boolean[] = [];
  const s = setup({
    configuration: 'ocr-test',
    inspect: async () => 1,
    async process(_bytes, input) {
      modes.push(input.ocr);
      input.onPage({
        ...page,
        origin: input.ocr ? 'ocr_candidate' : 'needs_ocr',
        text: input.ocr ? page.text : '',
      });
    },
    render: async () => {
      throw new Error('Must not render to text model');
    },
  });
  const { source } = await s.add();
  const preview = ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'preview',
      instruction: '分析扫描件',
      model: 'deepseek-v4-pro',
      automatic: true,
      selected: [{ source_id: source.id, pages: [1] }],
    }),
  ).preview!;
  expect(modes).toEqual([false, true]);
  expect(preview.images).toBeUndefined();
  expect(preview.payload).toContain(page.text);
  s.store.close();
});

it('a user resend retries failed local preparation without dropping pages', async () => {
  let fail = true;
  const s = setup({
    configuration: 'retry-test',
    inspect: async () => 1,
    async process(_bytes, input) {
      if (fail) throw new Error('Temporary local failure');
      input.onPage(page);
    },
  });
  const { source } = await s.add();
  await s.settled();
  expect(s.store.materials.get(source.id)?.status).toBe('failed');
  fail = false;
  const r = ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'preview',
      instruction: '重试',
      model: 'gpt-4.1-mini',
      automatic: true,
      selected: [{ source_id: source.id, pages: [1] }],
    }),
  );
  expect(r.preview?.payload).toContain(page.text);
  s.store.close();
});

it('keeps the target of a failed original-file restore and refuses to turn it into a new import', async () => {
  const s = setup();
  const { source } = await s.add();
  await s.settled();
  const wrong = join(s.root, 'wrong.pdf');
  writeFileSync(wrong, '%PDF-1.4 synthetic wrong original');
  const staged = ok(await s.app.stage(wrong, 'home')).staged!;
  expect(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'restore',
      source_id: source.id,
      token: staged.token,
    }),
  ).toMatchObject({ ok: false, code: 'MISMATCH' });
  expect(
    ok(await s.app.execute({ protocol_version: 1, scope: 'home', operation: 'list' })).staged,
  ).toMatchObject({ token: staged.token, restore_source_id: source.id });
  expect(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'commit',
      token: staged.token,
    }),
  ).toMatchObject({ ok: false, code: 'RESTORE_REQUIRED' });
  expect(s.store.materials.list('home')).toHaveLength(1);
  expect(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'read',
      source_id: source.id,
    }),
  ).toMatchObject({ ok: true });
  s.store.close();
  const reopened = openTaskStore(join(s.root, 'db.sqlite'), migrations);
  expect(reopened.materials.pending('home')).toMatchObject({
    token: staged.token,
    restore_source_id: source.id,
  });
  reopened.close();
});

it('does not rewrite a staged import intent while its commit is already in flight', async () => {
  let pause = false;
  let resume!: () => void;
  const s = setup({
    configuration: 'intent-lock',
    async inspect() {
      if (pause)
        await new Promise<void>((done) => {
          resume = done;
        });
      return 1;
    },
    process: async (_bytes, input) => input.onPage(page),
  });
  const first = await s.add();
  await s.settled();
  const staged = ok(await s.app.stage(s.fixture, 'home')).staged!;
  pause = true;
  const commit = s.app.execute({
    protocol_version: 1,
    scope: 'home',
    operation: 'commit',
    token: staged.token,
  });
  while (!resume) await new Promise((done) => setTimeout(done, 1));
  expect(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'restore',
      token: staged.token,
      source_id: first.source.id,
    }),
  ).toMatchObject({ ok: false, code: 'BUSY' });
  expect(s.store.materials.stage(staged.token)?.restore_source_id).toBeUndefined();
  resume();
  expect(await commit).toMatchObject({ ok: true });
  await s.settled();
  s.store.close();
});

it('vision analysis reads the original scan even when a local OCR candidate already exists', async () => {
  let processing = 0;
  const s = setup({
    configuration: 'cached-ocr',
    inspect: async () => 1,
    process: async (_bytes, input) => {
      processing++;
      input.onPage({ ...page, origin: 'ocr_candidate', text: 'OCR_WRONG_AMOUNT_999' });
    },
    render: async () => ['c3ludGhldGljLXBhZ2U='],
  });
  const { source } = await s.add();
  await s.settled();
  const preview = ok(
    await s.app.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'preview',
      automatic: true,
      model: 'deepseek-flash',
      instruction: '分析原件',
      selected: [{ source_id: source.id, pages: [1] }],
    }),
  ).preview!;
  expect(preview.images).toHaveLength(1);
  expect(preview.payload).toContain('对应附图 1');
  expect(preview.payload).not.toContain('OCR_WRONG_AMOUNT_999');
  expect(processing).toBe(1);
  s.store.close();
});
it('a ready selected file does not wait for unrelated background OCR', async () => {
  let pause = false;
  let resume!: () => void;
  const s = setup({
    configuration: 'unrelated-job',
    inspect: async () => 1,
    process: async (_bytes, input) => {
      if (pause)
        await new Promise<void>((done) => {
          resume = done;
        });
      input.onPage(page);
    },
  });
  const first = await s.add();
  await s.settled();
  pause = true;
  await s.add();
  let completed = false;
  const pending = s.app
    .execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'preview',
      automatic: true,
      model: 'gpt-4.1-mini',
      instruction: '只分析第一份',
      selected: [{ source_id: first.source.id, pages: [1] }],
    })
    .then((r) => {
      completed = true;
      return r;
    });
  try {
    await new Promise((done) => setTimeout(done, 50));
    expect(completed).toBe(true);
    const preview = ok(await pending).preview!;
    expect(preview.selections.map((item) => item.source_id)).toEqual([first.source.id]);
  } finally {
    resume();
    await s.settled();
    s.store.close();
  }
});

it('queues required local OCR behind a busy worker without making the user resubmit', async () => {
  let waiting = false;
  let resume!: () => void;
  const s = setup({
    configuration: 'ocr-queue',
    inspect: async () => 1,
    process: async (_bytes, input) => {
      if (waiting) {
        await new Promise<void>((done) => {
          resume = done;
        });
        waiting = false;
      }
      input.onPage({
        ...page,
        origin: input.ocr ? 'ocr_candidate' : 'needs_ocr',
        text: input.ocr ? page.text : '',
      });
    },
  });
  const first = await s.add();
  await s.settled();
  waiting = true;
  await s.add();
  const pending = s.app.execute({
    protocol_version: 1,
    scope: 'home',
    operation: 'preview',
    automatic: true,
    model: 'deepseek-v4-pro',
    instruction: '分析第一份',
    selected: [{ source_id: first.source.id, pages: [1] }],
  });
  try {
    await new Promise((done) => setTimeout(done, 10));
    resume();
    const preview = ok(await pending).preview!;
    expect(preview.payload).toContain(page.text);
    expect(preview.selections).toHaveLength(1);
  } finally {
    s.app.close();
    await s.settled();
    s.store.close();
  }
});
