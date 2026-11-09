import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import {
  emptyTaskCalendar,
  defaultExportStyle,
  exportConfigurationContent,
  type ExportConfiguration,
  type ExportStyle,
} from '@caselite/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  linkSync,
  lstatSync,
  symlinkSync,
  copyFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as Y from 'yjs';
import Database from 'better-sqlite3';
import { integrationMigrations } from '../../packages/local-db/src/migration-manifest';
import { extractRawText, convertToHtml } from 'mammoth';
import { fromBuffer } from 'yauzl';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import {
  createTaskApplication,
  createDeliveryExportApplication,
} from '../../packages/application/src';
import type {
  Task,
  TaskRequest,
  TaskResponse,
  DeliverySnapshot,
} from '../../packages/contracts/src';
import { renderSnapshotWord } from '../../apps/desktop/src/main/adapters/snapshot-word';
import { createDeliveryExportFiles } from '../../apps/desktop/src/main/adapters/delivery-export-files';

const roots: string[] = [],
  closes: Array<() => void> = [];
afterEach(() => {
  closes.splice(0).forEach((c) => c());
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
});
const migrations = resolve('packages/local-db/migrations');
function configuration(style: ExportStyle, resource = 'a'.repeat(64)): ExportConfiguration {
  const value: ExportConfiguration = {
    version: 1,
    style,
    font: { family: 'Arial Unicode MS', sha256: resource },
    fingerprint: '0'.repeat(64),
  };
  return {
    ...value,
    fingerprint: createHash('sha256').update(exportConfigurationContent(value)).digest('hex'),
  };
}

it('freezes distinct style identities without replacing legacy exports, receipts or saved snapshot bytes', async () => {
  const s = setup();
  const task = seed(s.task),
    snapshot = fixed(s.task, task);
  const legacyRequest = request(task, snapshot);
  const legacy = good(await s.app.execute(legacyRequest)).exports![0];
  const legacyFile = join(s.filesRoot, 'fixed', legacy.id + '.docx');
  const legacyBytes = readFileSync(legacyFile);
  // 本项只核配置身份与真实持久化；渲染先沿现有Word，样式排版由后续适配器专项核对。
  const render = vi.fn<Parameters<typeof createDeliveryExportApplication>[0]['render']>(
    (saved, state) => renderSnapshotWord(saved, new Uint8Array(state)),
  );
  const configurationPort = { resolve: async (style: ExportStyle) => configuration(style) };
  const app = createDeliveryExportApplication({
    ...s.ports,
    render,
    configuration: configurationPort,
  });
  const firstRequest = { ...request(task, snapshot), export_style: defaultExportStyle };
  const first = good(await app.execute(firstRequest)).exports![0];
  const secondStyle = { ...defaultExportStyle, font_size: 14, header: '合成内部稿' };
  const second = good(await app.execute({ ...request(task, snapshot), export_style: secondStyle }))
    .exports![0];
  expect(new Set([legacy.id, first.id, second.id]).size).toBe(3);
  expect(first.configuration?.fingerprint).not.toBe(second.configuration?.fingerprint);
  expect(render.mock.calls.map((call) => call[5]?.style.font_size)).toEqual([12, 14]);
  expect(good(await app.execute({ ...firstRequest, ...identity() })).exports![0]).toEqual(first);
  expect(good(await app.execute(firstRequest)).exports![0]).toEqual(first);
  expect(render).toHaveBeenCalledTimes(2);
  const result = good(
    await app.execute({
      protocol_version: 1,
      operation: 'read_export',
      task_id: task.id,
      document_id: task.document_id,
      snapshot_id: snapshot.id,
      format: 'docx',
      export_style: defaultExportStyle,
      include_history: true,
    }),
  );
  expect(result.exports?.[0].id).toBe(first.id);
  expect(result.export_history?.map((row) => row.id)).toEqual(
    expect.arrayContaining([legacy.id, first.id, second.id]),
  );
  expect(readFileSync(legacyFile)).toEqual(legacyBytes);
  expect(good(await s.app.execute(legacyRequest)).exports![0]).toEqual(legacy);
  expect(() =>
    s.db
      .prepare(
        'UPDATE delivery_exports SET configuration_json=NULL,configuration_fingerprint=? WHERE id=?',
      )
      .run('', first.id),
  ).toThrow(/immutable/);
  s.close();
  const reopened = s.open();
  const again = createDeliveryExportApplication({
    ...reopened.ports,
    render,
    configuration: configurationPort,
  });
  expect(good(await again.execute(firstRequest)).exports![0]).toEqual(first);
  expect(render).toHaveBeenCalledTimes(2);
});

it('replays durable configured exports without resolving unavailable fonts and keeps legacy lookup separate', async () => {
  const s = setup();
  const task = seed(s.task),
    snapshot = fixed(s.task, task);
  const resolveFont = vi.fn(async (style: ExportStyle) => configuration(style));
  const render = vi.fn<Parameters<typeof createDeliveryExportApplication>[0]['render']>(
    (saved, state) => renderSnapshotWord(saved, new Uint8Array(state)),
  );
  const app = createDeliveryExportApplication({
    ...s.ports,
    render,
    configuration: { resolve: resolveFont },
  });
  const original = { ...request(task, snapshot), export_style: defaultExportStyle };
  const first = good(await app.execute(original));
  const bytes = readFileSync(join(s.filesRoot, 'fixed', first.exports![0].id + '.docx'));
  resolveFont.mockRejectedValue(new Error('PDF_FONT_UNAVAILABLE'));
  expect(await app.execute(original)).toEqual(first);
  expect(
    await app.execute({ ...original, export_style: { ...defaultExportStyle, font_size: 14 } }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(resolveFont).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledTimes(1);
  expect(s.store.deliveryExports.read(snapshot.id, 'docx')).toBeUndefined();
  expect(s.store.deliveryExports.read(snapshot.id, 'docx', first.exports![0].id)).toEqual(
    first.exports![0],
  );
  expect(await app.execute({ ...original, ...identity() })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(s.store.deliveryExports.list(snapshot.id, 'docx')).toHaveLength(1);
  expect(readFileSync(join(s.filesRoot, 'fixed', first.exports![0].id + '.docx'))).toEqual(bytes);
});

it('renders the shared Letter layout, font, margins and page fields into real DOCX parts', async () => {
  const s = setup(),
    task = seed(s.task),
    snapshot = fixed(s.task, task);
  const fixedRead = good(
    s.task.execute({
      protocol_version: 1,
      operation: 'read_snapshot',
      task_id: task.id,
      document_id: task.document_id,
      snapshot_id: snapshot.id,
    }),
  );
  const selected = configuration({
    ...defaultExportStyle,
    paper: 'Letter',
    font_size: 14,
    margins: { top: 18, right: 24, bottom: 22, left: 26 },
    header: '<合成页眉> {page}/{pages}',
    footer: '合成页脚',
  });
  const output = Buffer.from(
    await renderSnapshotWord(snapshot, new Uint8Array(fixedRead.state!), selected),
  );
  const xml = await xmlPart(output, 'word/document.xml');
  expect(xml).toContain('w:w="12240" w:h="15840"');
  for (const [side, mm] of Object.entries(selected.style.margins))
    expect(xml).toContain(`w:${side}="${Math.round((mm * 1440) / 25.4)}"`);
  const styles = await xmlPart(output, 'word/styles.xml');
  expect(styles).toContain('Arial Unicode MS');
  expect(styles).toContain('w:val="28"');
  const header = await xmlPart(output, 'word/header1.xml');
  expect(header).toContain('&lt;合成页眉&gt;');
  expect(header).toContain('PAGE');
  expect(header).toContain('NUMPAGES');
  expect(await xmlPart(output, 'word/footer1.xml')).toContain('合成页脚');
  expect((await extractRawText({ buffer: output })).value).toContain('十日');
});

it('keeps a pending request bound to its original font resource instead of silently regenerating it', async () => {
  const s = setup();
  const task = seed(s.task),
    snapshot = fixed(s.task, task);
  let resource = 'a'.repeat(64);
  const render = vi.fn<Parameters<typeof createDeliveryExportApplication>[0]['render']>(
    (saved, state) => renderSnapshotWord(saved, new Uint8Array(state)),
  );
  render.mockRejectedValueOnce(new Error('Synthetic renderer failure'));
  const app = createDeliveryExportApplication({
    ...s.ports,
    render,
    configuration: { resolve: async (style) => configuration(style, resource) },
  });
  const original = { ...request(task, snapshot), export_style: defaultExportStyle };
  expect(await app.execute(original)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
  expect(() =>
    s.db
      .prepare(
        "UPDATE delivery_exports SET configuration_json=?,configuration_fingerprint=? WHERE status='pending'",
      )
      .run('null', 'a'.repeat(64)),
  ).toThrow(/CHECK/);
  resource = 'b'.repeat(64);
  expect(await app.execute(original)).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
    message: expect.stringContaining('字体资源已变化'),
  });
  expect(render).toHaveBeenCalledTimes(1);
  const replacement = good(await app.execute({ ...original, ...identity() })).exports![0];
  expect(replacement.configuration?.font.sha256).toBe(resource);
  expect(s.store.deliveryExports.list(snapshot.id, 'docx')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: 'pending',
        configuration: expect.objectContaining({
          font: { family: 'Arial Unicode MS', sha256: 'a'.repeat(64) },
        }),
      }),
    ]),
  );
  expect(render).toHaveBeenCalledTimes(2);
});
function xmlPart(buffer: Buffer, name: string): Promise<string> {
  return new Promise((resolve, reject) =>
    fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on('data', (v) => chunks.push(v));
          stream.on('error', reject);
          stream.on('end', () => {
            zip.close();
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        });
      });
      zip.on('end', () => reject(new Error('Missing XML part')));
      zip.readEntry();
    }),
  );
}
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function good(r: TaskResponse) {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r;
}
function element(
  name: string,
  children: Array<Y.XmlElement | Y.XmlText> = [],
  attrs: Record<string, unknown> = {},
) {
  const node = new Y.XmlElement(name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v as string));
  node.insert(0, children);
  return node;
}
function text(s: string) {
  const t = new Y.XmlText();
  t.insert(0, s);
  return t;
}
function binary(s: string) {
  const d = new Y.Doc();
  d.getXmlFragment('default').insert(0, [element('paragraph', [text(s)])]);
  const state = Array.from(Y.encodeStateAsUpdate(d));
  d.destroy();
  return state;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-word-export-'));
  roots.push(root);
  const file = join(root, 'workspace.sqlite'),
    filesRoot = join(root, 'exports');
  const opened = vi.fn(async (path: string) => {
      void path;
      return '';
    }),
    render = vi.fn(async (s: DeliverySnapshot, state: number[]) =>
      renderSnapshotWord(s, new Uint8Array(state)),
    );
  const open = (workspace = 'local') => {
    const store = openTaskStore(file, migrations, workspace),
      task = createTaskApplication(store),
      files = createDeliveryExportFiles(filesRoot, opened);
    let closed = false;
    const close = () => {
      if (!closed) {
        store.close();
        closed = true;
      }
    };
    closes.push(close);
    const ports = {
      task,
      store: store.deliveryExports,
      files,
      render,
      hash: (b: Uint8Array) => createHash('sha256').update(b).digest('hex'),
    };
    return { task, store, files, ports, app: createDeliveryExportApplication(ports), close };
  };
  const state = open();
  const db = openToolchainProbe(file, migrations).sqlite;
  closes.push(() => {
    if (db.open) db.close();
  });
  return { root, file, filesRoot, opened, render, open, db, ...state };
}
function seed(task: ReturnType<typeof createTaskApplication>) {
  const t = good(
    task.execute({ ...identity(), operation: 'create', title: '合成付款合同', objective: '' }),
  ).tasks[0];
  return save(task, t, '付款期限为十日。');
}
function save(app: ReturnType<typeof createTaskApplication>, t: Task, value: string) {
  return good(
    app.execute({
      ...identity(),
      operation: 'save',
      task_id: t.id,
      document_id: t.document_id,
      body_id: t.body_id,
      expected_revision: t.body_revision,
      editor_schema: 1,
      state: binary(value),
    }),
  ).tasks[0];
}
function fixed(app: ReturnType<typeof createTaskApplication>, t: Task) {
  return good(
    app.execute({
      ...identity(),
      operation: 'create_snapshot',
      task_id: t.id,
      document_id: t.document_id,
      body_id: t.body_id,
      expected_revision: t.body_revision,
      expected_metadata_version: t.document_metadata_version!,
      expected_task_version: t.version,
      note: '合成固定稿',
    }),
  ).snapshots![0];
}
const request = (
  t: Task,
  s: DeliverySnapshot,
): Extract<TaskRequest, { operation: 'export_snapshot' }> => ({
  ...identity(),
  operation: 'export_snapshot',
  task_id: t.id,
  document_id: t.document_id,
  snapshot_id: s.id,
  format: 'docx',
});
const fixedPath = (root: string, id: string) => join(root, 'fixed', id + '.docx');

it('exports old saved Chinese content after editing v2, opens an independent editable copy, and reuses output across restart', async () => {
  const s = setup(),
    t = seed(s.task),
    old = fixed(s.task, t),
    r = request(t, old);
  save(s.task, t, '付款期限为三十日。');
  const exported = good(await s.app.execute(r)),
    artifact = exported.exports![0],
    path = fixedPath(s.filesRoot, artifact.id),
    original = readFileSync(path);
  expect((await extractRawText({ buffer: original })).value).toContain('付款期限为十日。');
  expect((await extractRawText({ buffer: original })).value).not.toContain('三十日');
  const openRequest = {
    protocol_version: 1,
    operation: 'open_export',
    task_id: t.id,
    document_id: t.document_id,
    snapshot_id: old.id,
    export_id: artifact.id,
  };
  good(await s.app.execute(openRequest));
  const work = s.opened.mock.calls[0][0];
  expect(work).not.toBe(path);
  expect(lstatSync(work).ino).not.toBe(lstatSync(path).ino);
  writeFileSync(work, 'synthetic external edit');
  good(await s.app.execute(openRequest));
  expect(readFileSync(work, 'utf8')).toBe('synthetic external edit');
  expect(readFileSync(path)).toEqual(original);
  s.close();
  const reopened = s.open();
  expect(good(await reopened.app.execute(r))).toEqual(exported);
  expect(good(await reopened.app.execute({ ...r, ...identity() })).exports?.[0]).toEqual(artifact);
  expect(s.render).toHaveBeenCalledTimes(1);
  expect(readdirSync(join(s.filesRoot, 'fixed'))).toEqual([artifact.id + '.docx']);
  expect(
    s.db.prepare("SELECT count(*) AS n FROM task_activity WHERE operation='export_snapshot'").get(),
  ).toEqual({ n: 1 });
});

it('serializes double-click/new-key requests and rejects altered original keys or wrong scope', async () => {
  const s = setup(),
    t = seed(s.task),
    snap = fixed(s.task, t),
    r = request(t, snap);
  const results = await Promise.all([
    s.app.execute(r),
    s.app.execute(r),
    s.app.execute({ ...r, ...identity() }),
  ]);
  expect(new Set(results.map((v) => good(v).exports![0].id)).size).toBe(1);
  expect(s.render).toHaveBeenCalledTimes(1);
  expect(await s.app.execute({ ...r, format: 'pdf' })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(await s.app.execute({ ...r, format: 'rtf' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(await s.app.execute({ ...r, task_id: randomUUID() })).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  expect(await s.open('other-workspace').app.execute(r)).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  const next = save(s.task, t, '付款期限为三十日。'),
    newSnap = fixed(s.task, next);
  expect(await s.app.execute({ ...r, snapshot_id: newSnap.id })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
});

it.each(['task_activity', 'task_receipts'])(
  'recovers a placed artifact after %s failure without re-rendering or duplicate success activity',
  async (table) => {
    const s = setup(),
      t = seed(s.task),
      snap = fixed(s.task, t),
      r = request(t, snap);
    s.db.exec(
      `CREATE TRIGGER export_fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`,
    );
    expect(await s.app.execute(r)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(s.db.prepare('SELECT status FROM delivery_exports').get()).toEqual({
      status: 'pending',
    });
    expect(
      s.task.execute({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: r.idempotency_key,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    s.db.exec('DROP TRIGGER export_fault');
    s.close();
    const reopened = s.open();
    expect(good(await reopened.app.execute(r)).exports![0].status).toBe('ready');
    expect(s.render).toHaveBeenCalledTimes(1);
    expect(
      s.db
        .prepare("SELECT count(*) AS n FROM task_activity WHERE operation='export_snapshot'")
        .get(),
    ).toEqual({ n: 1 });
  },
);

it('recovers the exact link-before-unlink crash window and rejects foreign links', async () => {
  const s = setup(),
    t = seed(s.task),
    snap = fixed(s.task, t),
    r = request(t, snap);
  let row = s.store.deliveryExports.reserve(r);
  const bytes = await renderSnapshotWord(
    snap,
    new Uint8Array(
      good(
        s.task.execute({
          protocol_version: 1,
          operation: 'read_snapshot',
          task_id: t.id,
          document_id: t.document_id,
          snapshot_id: snap.id,
        }),
      ).state!,
    ),
  );
  row = s.store.deliveryExports.stage(
    row,
    createHash('sha256').update(bytes).digest('hex'),
    bytes.length,
  );
  mkdirSync(join(s.filesRoot, 'fixed'), { recursive: true });
  const path = fixedPath(s.filesRoot, row.id);
  writeFileSync(path + '.part', bytes);
  linkSync(path + '.part', path);
  expect(lstatSync(path).nlink).toBe(2);
  good(await s.app.execute(r));
  expect(lstatSync(path).nlink).toBe(1);
  expect(s.render).toHaveBeenCalledTimes(0);
  expect(() => s.db.prepare("UPDATE delivery_exports SET status='pending'").run()).toThrow();
  linkSync(path, join(s.root, 'foreign-link.docx'));
  expect(await s.app.execute({ ...r, ...identity() })).toMatchObject({ ok: false });
});

it('leaves failures visible and never overwrites damaged, missing or linked ready output', async () => {
  const s = setup(),
    t = seed(s.task),
    snap = fixed(s.task, t),
    r = request(t, snap);
  const row = good(await s.app.execute(r)).exports![0],
    path = fixedPath(s.filesRoot, row.id);
  writeFileSync(path, 'synthetic damage');
  expect(
    await s.app.execute({
      protocol_version: 1,
      operation: 'read_export',
      task_id: t.id,
      document_id: t.document_id,
      snapshot_id: snap.id,
    }),
  ).toMatchObject({ ok: false, code: 'READ_FAILED' });
  expect(await s.app.execute(r)).toMatchObject({ ok: false });
  expect(readFileSync(path, 'utf8')).toBe('synthetic damage');
  expect(s.render).toHaveBeenCalledTimes(1);
  rmSync(path);
  symlinkSync(join(s.root, 'elsewhere'), path);
  expect(await s.app.execute(r)).toMatchObject({ ok: false });
  expect(lstatSync(path).isSymbolicLink()).toBe(true);
});

it('retries generation failure under the same identity and keeps opening failures separate from generation', async () => {
  const s = setup(),
    t = seed(s.task),
    snap = fixed(s.task, t),
    r = request(t, snap);
  s.render.mockRejectedValueOnce(new Error('synthetic timeout'));
  expect(await s.app.execute(r)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
  const row = good(await s.app.execute(r)).exports![0];
  s.opened.mockResolvedValueOnce('synthetic no application');
  expect(
    await s.app.execute({
      protocol_version: 1,
      operation: 'open_export',
      task_id: t.id,
      document_id: t.document_id,
      snapshot_id: snap.id,
      export_id: row.id,
    }),
  ).toMatchObject({ ok: false, code: 'READ_FAILED' });
  expect(good(await s.app.execute(r)).exports![0]).toEqual(row);
  expect(s.render).toHaveBeenCalledTimes(2);
});

it('round-trips headings, ordered start, bold Chinese and horizontal/vertical table merges; rejects unknown nodes', async () => {
  const s = setup(),
    t = seed(s.task),
    snapshot = fixed(s.task, t),
    d = new Y.Doc();
  const p = (value: string) => element('paragraph', [text(value)]);
  const bold = text('中文加粗');
  bold.format(0, 4, { bold: {} });
  d.getXmlFragment('default').insert(0, [
    element('heading', [text('合同标题')], { level: 2 }),
    element('paragraph', [bold]),
    element(
      'orderedList',
      [element('listItem', [p('编号三')]), element('listItem', [p('编号四')])],
      { start: 3, type: null },
    ),
    element('table', [
      element('tableRow', [
        element('tableCell', [p('纵向合并')], { rowspan: 2, colspan: 1 }),
        element('tableCell', [p('横向合并')], { colspan: 2, rowspan: 1 }),
      ]),
      element('tableRow', [element('tableCell', [p('乙')]), element('tableCell', [p('丙')])]),
    ]),
  ]);
  const buffer = Buffer.from(await renderSnapshotWord(snapshot, Y.encodeStateAsUpdate(d))),
    html = (await convertToHtml({ buffer })).value;
  expect(html).toContain('<h2>合同标题</h2>');
  expect(html).toContain('<strong>中文加粗</strong>');
  expect(html).toContain('<ol>');
  // Mammoth不投影start；直接核对同一DOCX的编号定义与段落numId绑定，保留起始值语义验收。
  const numbering = await xmlPart(buffer, 'word/numbering.xml'),
    document = await xmlPart(buffer, 'word/document.xml');
  const mapped = [...numbering.matchAll(/<w:num w:numId="(\d+)">([\s\S]*?)<\/w:num>/g)].find((m) =>
    m[2].includes('<w:startOverride w:val="3"/>'),
  );
  expect(mapped).toBeDefined();
  expect(numbering).toContain('<w:start w:val="3"/>');
  expect(document).toContain(`<w:numId w:val="${mapped![1]}"/>`);
  expect(html).toContain('rowspan="2"');
  expect(html).toContain('colspan="2"');
  d.getXmlFragment('default').insert(0, [element('unknownImage')]);
  await expect(renderSnapshotWord(snapshot, Y.encodeStateAsUpdate(d))).rejects.toThrow();
  d.destroy();
});

it('upgrades an 18-migration database preserving existing snapshot bytes and receipts before exporting', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-word-upgrade-'));
  roots.push(root);
  const folder = join(root, 'old-migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(
    readFileSync(resolve('tests/fixtures/migration-histories/A.json'), 'utf8'),
  );
  journal.entries = journal.entries.slice(0, 18);
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(join(migrations, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  const file = join(root, 'old.sqlite'),
    old = openTaskStore(file, folder),
    app = createTaskApplication(old),
    task = seed(app),
    snapshot = fixed(app, task);
  const query = {
    protocol_version: 1,
    operation: 'read_snapshot',
    task_id: task.id,
    document_id: task.document_id,
    snapshot_id: snapshot.id,
  };
  const before = good(app.execute(query));
  old.close();
  const upgraded = openTaskStore(file, migrations);
  closes.push(() => upgraded.close());
  const tasks = createTaskApplication(upgraded);
  expect(good(tasks.execute(query))).toEqual({
    ...before,
    tasks: before.tasks.map((task) => ({
      ...task,
      subscribed: false,
      calendar: emptyTaskCalendar,
    })),
  });
  const files = createDeliveryExportFiles(join(root, 'exports'), async () => '');
  const controller = createDeliveryExportApplication({
    task: tasks,
    store: upgraded.deliveryExports,
    files,
    render: (s, b) => renderSnapshotWord(s, new Uint8Array(b)),
    hash: (b) => createHash('sha256').update(b).digest('hex'),
  });
  expect(good(await controller.execute(request(task, snapshot))).exports![0].status).toBe('ready');
  const db = openToolchainProbe(file, migrations).sqlite;
  expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
    n: integrationMigrations.length,
  });
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(db.pragma('foreign_key_check')).toEqual([]);
  db.close();
});

it('upgrades the released complete 25-entry schema without altering ready Word bytes, receipts or body revisions', async () => {
  const s = setup();
  const task = seed(s.task),
    snapshot = fixed(s.task, task);
  const original = request(task, snapshot);
  const acknowledged = good(await s.app.execute(original));
  const row = acknowledged.exports![0];
  const output = join(s.filesRoot, 'fixed', row.id + '.docx');
  const outputBytes = readFileSync(output);
  const legacyFile = join(s.root, 'released-25.sqlite');
  const legacy = new Database(legacyFile);
  legacy.exec(
    'PRAGMA foreign_keys=OFF; CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash text NOT NULL,created_at numeric)',
  );
  for (const entry of integrationMigrations.slice(0, 25)) {
    const sql = readFileSync(join(migrations, entry.tag + '.sql'), 'utf8');
    expect(createHash('sha256').update(sql).digest('hex')).toBe(entry.hash);
    legacy.exec(sql);
    legacy
      .prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)')
      .run(entry.hash, entry.when);
  }
  legacy.prepare('ATTACH DATABASE ? AS seeded').run(s.file);
  // 只构造合成旧库：从已保存样本复制旧Schema共有列，新配置列绝不进入旧fixture。
  const tables = legacy
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY name",
    )
    .all() as { name: string }[];
  const preserved = tables.map(({ name }) => {
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const table = quote(name);
    const columns = (legacy.pragma(`table_info(${table})`) as { name: string }[])
      .map((c) => quote(c.name))
      .join(',');
    legacy.exec(
      `INSERT OR IGNORE INTO ${table}(${columns}) SELECT ${columns} FROM seeded.${table}`,
    );
    const rows = legacy.prepare(`SELECT ${columns} FROM ${table}`).all();
    expect(rows).toEqual(legacy.prepare(`SELECT ${columns} FROM seeded.${table}`).all());
    return { table, columns, rows };
  });
  legacy.exec('DETACH DATABASE seeded; PRAGMA foreign_keys=ON');
  expect(legacy.pragma('foreign_key_check')).toEqual([]);
  expect(legacy.pragma('table_info(delivery_exports)')).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'configuration_json' })]),
  );
  expect(legacy.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 25 });
  legacy.close();
  const prepare = Database.prototype.prepare;
  let injected = false;
  const failure = vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
    this: Database.Database,
    sql: string,
  ) {
    if (
      sql.includes('CREATE UNIQUE INDEX `delivery_exports_snapshot_format`') &&
      sql.includes('configuration_fingerprint')
    ) {
      injected = true;
      throw new Error('Synthetic configured export index failure');
    }
    return prepare.call(this, sql);
  });
  try {
    expect(() => openTaskStore(legacyFile, migrations)).toThrow();
    expect(injected).toBe(true);
  } finally {
    failure.mockRestore();
  }
  const rolledBack = new Database(legacyFile);
  try {
    expect(rolledBack.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
      n: 25,
    });
    expect(rolledBack.pragma('table_info(delivery_exports)')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'configuration_json' })]),
    );
    for (const { table, columns, rows } of preserved)
      expect(rolledBack.prepare(`SELECT ${columns} FROM ${table}`).all()).toEqual(rows);
    expect(rolledBack.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    rolledBack.close();
  }
  for (let pass = 0; pass < 2; pass++) {
    const upgraded = openTaskStore(legacyFile, migrations);
    const db = openToolchainProbe(legacyFile, migrations).sqlite;
    try {
      expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 26 });
      for (const { table, columns, rows } of preserved)
        expect(db.prepare(`SELECT ${columns} FROM ${table}`).all()).toEqual(rows);
      expect(
        db
          .prepare(
            'SELECT configuration_json,configuration_fingerprint FROM delivery_exports WHERE id=?',
          )
          .get(row.id),
      ).toEqual({ configuration_json: null, configuration_fingerprint: '' });
      const taskApp = createTaskApplication(upgraded);
      const exporter = createDeliveryExportApplication({
        ...s.ports,
        task: taskApp,
        store: upgraded.deliveryExports,
      });
      expect(good(await exporter.execute(original))).toEqual(acknowledged);
      expect(readFileSync(output)).toEqual(outputBytes);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
      upgraded.close();
    }
  }
});
