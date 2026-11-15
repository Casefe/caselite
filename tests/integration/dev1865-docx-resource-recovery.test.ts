import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inspectZip } from '../../apps/desktop/src/main/adapters/docx-worker';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import { createMaterialApplication } from '../../packages/application/src/material-application';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import type { MaterialResponse, TaskResponse } from '../../packages/contracts/src';
import { docxFixture } from './docx-regression-fixture';
import { sourceDocxProcessor } from './docx-source-worker';

const require = createRequire(new URL('../../packages/local-db/package.json', import.meta.url));
const Y = require('yjs') as typeof import('yjs');
const body = '<w:p><w:r><w:t>保全的合成原文</w:t></w:r></w:p>';
const sparseWorkerSource =
  "require('node:worker_threads').parentPort.once('message', () => {require('node:worker_threads').parentPort.postMessage({paragraphs:new Array(1),review:{revisions:false,comments:false}});});";
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const roots: string[] = [];
let worker: ReturnType<typeof sourceDocxProcessor>;
beforeAll(() => {
  worker = sourceDocxProcessor();
});
afterAll(() => worker.dispose());
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function input(onPage: (page: { text: string }) => void, signal = new AbortController().signal) {
  return { onPage, signal, previous: [], ocr: false };
}

it('bounds expanded deflate data and preserves the source on both success and failure', async () => {
  const normal = docxFixture(body, [
    { name: 'word/media/synthetic.bin', data: Buffer.alloc(1024 * 1024, 65), deflate: true },
  ]);
  const original = digest(normal);
  expect(normal.length).toBeLessThan(4096);
  const pages: string[] = [];
  await worker.api.createDocxProcessor().process(
    normal,
    input((page) => pages.push(page.text)),
  );
  expect(pages).toEqual(['保全的合成原文']);
  expect(digest(normal)).toBe(original);

  const oversized = docxFixture(body, [
    { name: 'word/media/synthetic.bin', data: Buffer.alloc(32 * 1024 * 1024, 65), deflate: true },
  ]);
  const oversizedHash = digest(oversized);
  await expect(
    worker.api.createDocxProcessor().process(
      oversized,
      input(() => {
        throw new Error('must not emit a page');
      }),
    ),
  ).rejects.toThrow('Invalid DOCX');
  expect(digest(oversized)).toBe(oversizedHash);
});

it('accepts an XML tree at the measured depth ceiling and rejects deeper XML before conversion', async () => {
  const nested = (depth: number) =>
    docxFixture(body, [
      {
        name: 'word/additional.xml',
        data:
          '<root>' + '<node>'.repeat(depth - 1) + 'text' + '</node>'.repeat(depth - 1) + '</root>',
        deflate: true,
      },
    ]);
  await expect(worker.api.readDocxSemanticHtml(nested(256))).resolves.toMatchObject({
    html: '<p>保全的合成原文</p>',
  });
  await expect(inspectZip(nested(257))).rejects.toThrow('DOCX XML depth budget');
  await expect(worker.api.readDocxSemanticHtml(nested(4096))).rejects.toThrow('Invalid DOCX');
});

it('rejects a scan-only DOCX as empty extraction while retaining its fixed bytes', async () => {
  const bytes = docxFixture('<w:p><w:r><w:drawing/></w:r></w:p>', [
    {
      name: 'word/media/synthetic.png',
      data: Buffer.from([137, 80, 78, 71]),
    },
  ]);
  const original = digest(bytes);
  const pages: string[] = [];
  await expect(
    worker.api.createDocxProcessor().process(
      bytes,
      input((page) => pages.push(page.text)),
    ),
  ).rejects.toThrow('Invalid DOCX');
  expect(pages).toEqual([]);
  expect(digest(bytes)).toBe(original);
});

it.each([
  ['exception', "throw new Error('synthetic failure')"],
  ['exit', 'process.exit(7)'],
  [
    'bad result',
    "require('node:worker_threads').parentPort.postMessage({paragraphs:['正文',42],review:{revisions:false,comments:false}})",
  ],
])(
  'rejects actual worker %s without returning partial output and allows a later normal run',
  async (_name, workerSource) => {
    const faulty = sourceDocxProcessor({ workerSource });
    const pages: string[] = [];
    try {
      await expect(
        faulty.api.createDocxProcessor().process(
          docxFixture(body),
          input((page) => pages.push(page.text)),
        ),
      ).rejects.toThrow();
      expect(pages).toEqual([]);
    } finally {
      faulty.dispose();
    }
    await expect(worker.api.createDocxProcessor().inspect(docxFixture(body))).resolves.toBe(1);
  },
);

it('terminates an idle actual worker at the existing eight-second deadline', async () => {
  const faulty = sourceDocxProcessor({ workerSource: 'setInterval(() => {}, 1000)' });
  const start = performance.now();
  try {
    await expect(faulty.api.createDocxProcessor().inspect(docxFixture(body))).rejects.toThrow(
      'DOCX timeout',
    );
    expect(performance.now() - start).toBeGreaterThanOrEqual(7900);
  } finally {
    faulty.dispose();
  }
}, 12_000);

it('rejects actual sparse worker results in inspect and process without publishing pages, then recovers', async () => {
  const faulty = sourceDocxProcessor({ workerSource: sparseWorkerSource });
  const pages: string[] = [];
  const bytes = docxFixture(body),
    original = digest(bytes);
  try {
    await expect(faulty.api.createDocxProcessor().inspect(bytes)).rejects.toThrow('Invalid DOCX');
    await expect(
      faulty.api.createDocxProcessor().process(
        bytes,
        input((page) => pages.push(page.text)),
      ),
    ).rejects.toThrow('Invalid DOCX');
    expect(pages).toEqual([]);
    expect(digest(bytes)).toBe(original);
  } finally {
    faulty.dispose();
  }
  await worker.api.createDocxProcessor().process(
    bytes,
    input((page) => pages.push(page.text)),
  );
  expect(pages).toEqual(['保全的合成原文']);
});

it('cancels an actual worker before its delayed result and prevents late pages', async () => {
  const root = mkdtempSync(resolve('apps/desktop/.webpack/docx-cancel-'));
  roots.push(root);
  const started = join(root, 'worker-started');
  const faulty = sourceDocxProcessor({
    workerSource: `
    require('node:worker_threads').parentPort.once('message', () => {
      require('node:fs').writeFileSync(${JSON.stringify(started)}, 'started');
      setTimeout(() => {
        require('node:worker_threads').parentPort.postMessage({paragraphs:['迟到正文'],review:{revisions:false,comments:false}});
      }, 250);
    });
  `,
  });
  const controller = new AbortController(),
    pages: string[] = [];
  try {
    const pending = faulty.api.createDocxProcessor().process(
      docxFixture(body),
      input((page) => pages.push(page.text), controller.signal),
    );
    const rejected = expect(pending).rejects.toThrow('CANCELLED');
    await expect.poll(() => existsSync(started), { interval: 5 }).toBe(true);
    controller.abort();
    await rejected;
    await new Promise((done) => setTimeout(done, 300));
    expect(pages).toEqual([]);
  } finally {
    faulty.dispose();
  }
});

function good<T extends MaterialResponse | TaskResponse>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result as Extract<T, { ok: true }>;
}

it('keeps failed imports and cancelled late workers out of ready/body state across SQLite restart', async () => {
  const root = mkdtempSync(resolve('apps/desktop/.webpack/docx-recovery-'));
  roots.push(root);
  const database = join(root, 'test.sqlite'),
    migrations = resolve('packages/local-db/migrations');
  let store = openTaskStore(database, migrations);
  const task = good(
    store.execute({
      protocol_version: 1,
      operation: 'create',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      title: '已确认合成稿',
      objective: '',
    }),
  ).tasks[0];
  const doc = new Y.Doc(),
    paragraph = new Y.XmlElement('paragraph'),
    text = new Y.XmlText();
  text.insert(0, '此前确认并保存的正文');
  paragraph.insert(0, [text]);
  doc.getXmlFragment('default').insert(0, [paragraph]);
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  good(
    store.execute({
      protocol_version: 1,
      operation: 'save',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state,
    }),
  );
  const bodyHash = digest(Uint8Array.from(state));
  const files = createMaterialFiles(join(root, 'materials'));
  const processor = worker.api.createDocxProcessor();
  const normalProcess = processor.process;
  const crashed = sourceDocxProcessor({ workerSource: "throw new Error('synthetic crash')" });
  const sparse = sourceDocxProcessor({ workerSource: sparseWorkerSource });
  const faulty = sourceDocxProcessor({
    workerSource: `require('node:worker_threads').parentPort.once('message', () => setTimeout(() => {require('node:worker_threads').parentPort.postMessage({paragraphs:['迟到正文'],review:{revisions:false,comments:false}})}, 100));`,
  });
  const createApp = () =>
    createMaterialApplication({
      store: store.materials,
      files,
      processor,
      docxProcessor: processor,
      id: randomUUID,
      hash: (value) => digest(Buffer.from(value)),
      taskExists: (id) => store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
      createTask() {
        throw new Error('must reuse existing task');
      },
    });
  const app = createApp();
  const scope = task.id;
  const original = docxFixture(body),
    originalPath = join(root, 'normal.docx');
  writeFileSync(originalPath, original);
  let sourceId: string, assetId: string, sourceHash: string;
  try {
    const staged = good(await app.stage(originalPath, scope)).staged!;
    const result = good(
      await app.execute({ protocol_version: 1, operation: 'commit', scope, token: staged.token }),
    );
    const source = result.materials[0];
    sourceId = source.id;
    assetId = source.asset_version_id;
    sourceHash = source.sha256;
    await expect.poll(() => store.materials.get(source.id)?.status).toBe('ready');
    const oldPages = store.materials.get(source.id)!.pages;
    const oldDerivation = store.materials.get(source.id)!.derivation_id!;
    const badPath = join(root, 'bad.docx');
    writeFileSync(
      badPath,
      docxFixture(body, [{ name: 'unsafe.xml', data: '<!DOCTYPE root><root/>' }]),
    );
    const badStage = good(await app.stage(badPath, scope)).staged!;
    expect(
      await app.execute({ protocol_version: 1, operation: 'commit', scope, token: badStage.token }),
    ).toMatchObject({ ok: false });
    expect(store.materials.list(scope)).toHaveLength(1);
    expect(store.materials.get(source.id)!.pages).toEqual(oldPages);

    // 仅替换测试注入的处理器方法，真实Application/SQLite/文件Owner仍执行生产路径。
    processor.process = crashed.api.createDocxProcessor().process;
    good(
      await app.execute({
        protocol_version: 1,
        operation: 'process',
        scope,
        source_id: source.id,
        ocr: false,
        force: true,
      }),
    );
    await expect.poll(() => store.materials.get(source.id)?.status).toBe('failed');
    expect(store.materials.get(source.id)!.pages).toEqual([]);
    expect(store.materials.fixed(source.id, oldDerivation)!.pages).toEqual(oldPages);
    processor.process = sparse.api.createDocxProcessor().process;
    good(
      await app.execute({
        protocol_version: 1,
        operation: 'process',
        scope,
        source_id: source.id,
        ocr: false,
        force: true,
      }),
    );
    await expect.poll(() => store.materials.get(source.id)?.status).toBe('failed');
    expect(store.materials.get(source.id)!.pages).toEqual([]);
    expect(store.materials.fixed(source.id, oldDerivation)!.pages).toEqual(oldPages);
    const afterSparse = good(
      store.execute({ protocol_version: 1, operation: 'read', task_id: task.id }),
    );
    expect(afterSparse.tasks[0].body_revision).toBe(1);
    expect(digest(Uint8Array.from(afterSparse.state!))).toBe(bodyHash);
    expect(digest(await files.read(assetId, sourceHash))).toBe(digest(original));
    processor.process = faulty.api.createDocxProcessor().process;
    good(
      await app.execute({
        protocol_version: 1,
        operation: 'process',
        scope,
        source_id: source.id,
        ocr: false,
        force: true,
      }),
    );
    good(
      await app.execute({ protocol_version: 1, operation: 'cancel', scope, source_id: source.id }),
    );
    expect(store.materials.get(source.id)).toMatchObject({ status: 'cancelled', pages: [] });
    await new Promise((done) => setTimeout(done, 150));
    expect(store.materials.get(source.id)).toMatchObject({ status: 'cancelled', pages: [] });
    const read = good(store.execute({ protocol_version: 1, operation: 'read', task_id: task.id }));
    expect(read.tasks[0].body_revision).toBe(1);
    expect(digest(Uint8Array.from(read.state!))).toBe(bodyHash);
    expect(digest(await files.read(assetId, sourceHash))).toBe(digest(original));
    expect(digest(readFileSync(originalPath))).toBe(digest(original));
  } finally {
    crashed.dispose();
    sparse.dispose();
    faulty.dispose();
    store.close();
  }
  store = openTaskStore(database, migrations);
  try {
    const reopened = good(
      store.execute({ protocol_version: 1, operation: 'read', task_id: task.id }),
    );
    expect(reopened.tasks[0].body_revision).toBe(1);
    expect(digest(Uint8Array.from(reopened.state!))).toBe(bodyHash);
    expect(store.materials.get(sourceId)).toMatchObject({ status: 'cancelled', pages: [] });
    expect(digest(await files.read(assetId, sourceHash))).toBe(digest(original));
    processor.process = normalProcess;
    good(
      await createApp().execute({
        protocol_version: 1,
        operation: 'process',
        scope,
        source_id: sourceId,
        ocr: false,
      }),
    );
    await expect.poll(() => store.materials.get(sourceId)?.status).toBe('ready');
    expect(store.materials.get(sourceId)!.pages.map((page) => page.text)).toEqual([
      '保全的合成原文',
    ]);
    const recovered = good(
      store.execute({ protocol_version: 1, operation: 'read', task_id: task.id }),
    );
    expect(recovered.tasks[0].body_revision).toBe(1);
    expect(digest(Uint8Array.from(recovered.state!))).toBe(bodyHash);
  } finally {
    store.close();
  }
});
