import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as Y from 'yjs';
import Database from 'better-sqlite3';
import { openTaskStore } from '../../packages/local-db/src';
import {
  createTaskApplication,
  createDeliveryExportApplication,
} from '../../packages/application/src';
import type {
  TaskResponse,
  Task,
  TaskRequest,
  DeliverySnapshot,
} from '../../packages/contracts/src';
import { createDeliveryExportFiles } from '../../apps/desktop/src/main/adapters/delivery-export-files';
import { taskRequestSchema } from '../../packages/contracts/src';

it('keeps legacy PDF intents, files and receipts readable when a new converter is introduced', async () => {
  const s = setup();
  const { t, snapshot } = seed(s);
  const request = taskRequestSchema.parse({
    ...identity(),
    operation: 'export_snapshot' as const,
    format: 'pdf' as const,
    task_id: t.id,
    document_id: t.document_id,
    snapshot_id: snapshot.id,
  }) as Extract<TaskRequest, { operation: 'export_snapshot' }>;
  const pending = s.store.deliveryExports.reserve(request);
  // 模拟升级前已预留但尚未ACK的v1身份，不能把同一键重新绑定为v2。
  const db = new Database(join(s.root, 'db.sqlite'));
  try {
    db.prepare('UPDATE delivery_exports SET converter=? WHERE id=?').run(
      'electron-45.1.0-pdf-v1',
      pending.id,
    );
  } finally {
    db.close();
  }
  expect(s.store.deliveryExports.reserve(request).converter).toBe('electron-45.1.0-pdf-v1');
  const old = good(await s.app.execute(request)).exports![0];
  expect(old.converter).toBe('electron-45.1.0-pdf-v1');
  expect(s.render.mock.calls[0]?.[4]).toBe('electron-45.1.0-pdf-v1');
  const upgradeRequest = { ...request, ...identity() };
  s.render.mockRejectedValueOnce(new Error('Synthetic print failure'));
  expect((await s.app.execute(upgradeRequest)).ok).toBe(false);
  expect(
    good(
      await s.app.execute({
        protocol_version: 1,
        operation: 'read_export',
        task_id: t.id,
        document_id: t.document_id,
        snapshot_id: snapshot.id,
        format: 'pdf',
      }),
    ).exports![0].id,
  ).toBe(old.id);
  const upgraded = good(await s.app.execute(upgradeRequest)).exports![0];
  expect(upgraded.converter).toBe('electron-45.1.0-pdf-v2');
  expect(upgraded.id).not.toBe(old.id);
  expect(s.render).toHaveBeenCalledTimes(3);
  expect(good(await s.app.execute({ ...request, ...identity() })).exports![0].id).toBe(upgraded.id);
  expect(good(await s.app.execute(request)).exports![0]).toEqual(old);
  expect(s.render).toHaveBeenCalledTimes(3);
  expect(await s.files.verify(old)).toBe(true);
  expect(
    good(
      await s.app.execute({
        protocol_version: 1,
        operation: 'open_export',
        task_id: t.id,
        document_id: t.document_id,
        snapshot_id: snapshot.id,
        format: 'pdf',
        export_id: old.id,
      }),
    ).export_opened,
  ).toBe(true);
  expect(
    good(
      await s.app.execute({
        protocol_version: 1,
        operation: 'read_export',
        task_id: t.id,
        document_id: t.document_id,
        snapshot_id: snapshot.id,
        format: 'pdf',
      }),
    ).exports![0].id,
  ).toBe(upgraded.id);
});

const closes: Array<() => void> = [],
  roots: string[] = [];
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
function good(response: TaskResponse) {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.message);
  return response;
}
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function binary(value: string) {
  const doc = new Y.Doc(),
    p = new Y.XmlElement('paragraph'),
    t = new Y.XmlText();
  t.insert(0, value);
  p.insert(0, [t]);
  doc.getXmlFragment('default').insert(0, [p]);
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-pdf-export-'));
  roots.push(root);
  const store = openTaskStore(
    join(root, 'db.sqlite'),
    resolve('packages/local-db/migrations'),
    'local',
  );
  closes.push(() => store.close());
  const task = createTaskApplication(store),
    opened = vi.fn(async () => ''),
    files = createDeliveryExportFiles(join(root, 'exports'), opened);
  // 此测试只验证真实SQLite/文件提交；字节生成是模拟端口，不能作为PDF阅读器或Electron打印通过证据。
  const render = vi.fn(
    async (
      _snapshot: DeliverySnapshot,
      state: number[],
      format: string,
      signal?: AbortSignal,
      converter?: string,
    ) => {
      void signal;
      void converter;
      return new Uint8Array(Buffer.from(format + ':' + digest(new Uint8Array(state))));
    },
  );
  const ports = { task, store: store.deliveryExports, files, render, hash: digest };
  return { root, store, task, files, render, ports, app: createDeliveryExportApplication(ports) };
}
function seed(s: ReturnType<typeof setup>, title = '合成付款合同') {
  const created = good(s.task.execute({ ...identity(), operation: 'create', title, objective: '' }))
    .tasks[0];
  const t = save(s, created, '付款期限为十日。');
  const snapshot = good(
    s.task.execute({
      ...identity(),
      operation: 'create_snapshot',
      task_id: t.id,
      document_id: t.document_id,
      body_id: t.body_id,
      expected_revision: t.body_revision,
      expected_metadata_version: t.document_metadata_version!,
      expected_task_version: t.version,
      note: '固定十日',
    }),
  ).snapshots![0];
  return { t, snapshot };
}
function save(s: ReturnType<typeof setup>, t: Task, value: string) {
  return good(
    s.task.execute({
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
const request = (
  t: Task,
  snapshot: DeliverySnapshot,
): Extract<TaskRequest, { operation: 'export_snapshot' }> => ({
  ...identity(),
  operation: 'export_snapshot',
  task_id: t.id,
  document_id: t.document_id,
  snapshot_id: snapshot.id,
  format: 'pdf',
});
const cancel = (r: ReturnType<typeof request>) => ({
  protocol_version: 1 as const,
  operation: 'cancel_export' as const,
  task_id: r.task_id,
  document_id: r.document_id,
  snapshot_id: r.snapshot_id,
  idempotency_key: r.idempotency_key,
});

it('keeps PDF and Word separate at one old snapshot and reuses one PDF identity with new keys', async () => {
  const s = setup(),
    { t, snapshot } = seed(s),
    r = request(t, snapshot);
  save(s, t, '付款期限为三十日。');
  const pdf = good(await s.app.execute(r)).exports![0],
    word = good(await s.app.execute({ ...r, ...identity(), format: 'docx' })).exports![0];
  expect(pdf.snapshot_id).toBe(word.snapshot_id);
  expect(pdf.id).not.toBe(word.id);
  expect(pdf.sha256).not.toBe(word.sha256);
  expect(good(await s.app.execute({ ...r, ...identity() })).exports![0]).toEqual(pdf);
  expect(good(await s.app.execute(r)).exports![0]).toEqual(pdf);
  expect(s.render).toHaveBeenCalledTimes(2);
  expect(
    s.render.mock.calls.every(([, state]) => !Buffer.from(state).toString().includes('三十日')),
  ).toBe(true);
  expect(readdirSync(join(s.root, 'exports/fixed')).sort()).toEqual(
    [pdf.id + '.pdf', word.id + '.docx'].sort(),
  );
  expect(
    good(
      await s.app.execute({
        protocol_version: 1,
        operation: 'read_export',
        task_id: t.id,
        document_id: t.document_id,
        snapshot_id: snapshot.id,
      }),
    ).exports![0],
  ).toEqual(word);
  const original = readFileSync(join(s.root, 'exports/fixed', pdf.id + '.pdf'));
  const next = createDeliveryExportApplication(s.ports);
  expect(good(await next.execute(r)).exports![0]).toEqual(pdf);
  expect(readFileSync(join(s.root, 'exports/fixed', pdf.id + '.pdf'))).toEqual(original);
});
it('cancels a live job, rejects another snapshot key and retains the original successful ACK during replay', async () => {
  const s = setup(),
    a = seed(s),
    b = seed(s, '合成乙'),
    r = request(a.t, a.snapshot);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  s.render.mockImplementationOnce(async (_snapshot, _state, _format, signal) => {
    entered();
    return new Promise((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true }),
    );
  });
  const running = s.app.execute(r);
  await started;
  expect(
    await s.app.execute({
      ...cancel(request(b.t, b.snapshot)),
      idempotency_key: r.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(await s.app.execute(cancel(r))).toMatchObject({ ok: false, code: 'CANCELLED' });
  expect(await running).toMatchObject({ ok: false, code: 'CANCELLED' });
  const complete = good(await s.app.execute(r));
  const replay = s.app.execute(r);
  expect(await s.app.execute(cancel(r))).toEqual(complete);
  expect(await replay).toEqual(complete);
  expect(
    await s.app.execute({
      ...cancel(request(b.t, b.snapshot)),
      idempotency_key: r.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  const create = { ...identity(), operation: 'create', title: '非导出回执', objective: '' };
  good(s.task.execute(create));
  expect(
    await s.app.execute({ ...cancel(r), idempotency_key: create.idempotency_key }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
});
it('keeps failed render and final file placement pending, then resumes without overwriting an existing output', async () => {
  const s = setup(),
    { t, snapshot } = seed(s),
    r = request(t, snapshot);
  s.render.mockRejectedValueOnce(new Error('PDF_FONT_UNAVAILABLE'));
  expect(await s.app.execute(r)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(s.store.deliveryExports.read(snapshot.id, 'pdf')?.status).toBe('pending');
  const failed = createDeliveryExportApplication({
    ...s.ports,
    files: {
      ...s.files,
      put: async () => {
        throw new Error('disk failure');
      },
    },
  });
  expect(await failed.execute(r)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
  expect(
    s.task.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: r.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  const saved = good(await s.app.execute(r)).exports![0];
  const path = join(s.root, 'exports/fixed', saved.id + '.pdf');
  writeFileSync(path, 'external corruption');
  expect(await s.app.execute({ ...r, ...identity() })).toMatchObject({
    ok: false,
    code: 'WRITE_FAILED',
  });
  expect(readFileSync(path, 'utf8')).toBe('external corruption');
});
it('separates save-dialog cancel, successful exclusive copy and existing-target failure from generation', async () => {
  const s = setup(),
    { t, snapshot } = seed(s),
    r = request(t, snapshot),
    row = good(await s.app.execute(r)).exports![0];
  const outputRoot = realpathSync(mkdtempSync(join(tmpdir(), 'caselite-pdf-save-')));
  roots.push(outputRoot);
  const dest = join(outputRoot, 'copy.pdf');
  let selected: string | null = null;
  const app = createDeliveryExportApplication({
    ...s.ports,
    files: createDeliveryExportFiles(
      join(s.root, 'exports'),
      async () => '',
      async () => selected,
    ),
  });
  const command = {
    protocol_version: 1,
    operation: 'save_export',
    task_id: t.id,
    document_id: t.document_id,
    snapshot_id: snapshot.id,
    export_id: row.id,
    format: 'pdf',
  };
  expect(good(await app.execute(command)).export_saved).toBe(false);
  selected = dest;
  expect(good(await app.execute(command)).export_saved).toBe(true);
  expect(await app.execute(command)).toMatchObject({ ok: false, code: 'READ_FAILED' });
  expect(digest(readFileSync(dest))).toBe(row.sha256);
  expect(s.render).toHaveBeenCalledTimes(1);
  selected = join(s.root, 'exports', 'unsafe.pdf');
  expect(await app.execute(command)).toMatchObject({ ok: false, code: 'READ_FAILED' });
});

it('previews only checked ready PDF bytes at the same scoped identity without rendering again', async () => {
  const s = setup(),
    { t, snapshot } = seed(s);
  const bytes = new Uint8Array(Buffer.from('%PDF-synthetic-preview-port'));
  s.render.mockResolvedValueOnce(bytes);
  const created = good(
    await s.app.execute({
      ...identity(),
      operation: 'export_snapshot',
      format: 'pdf',
      task_id: t.id,
      document_id: t.document_id,
      snapshot_id: snapshot.id,
    }),
  );
  const row = created.exports![0];
  const query = {
    protocol_version: 1 as const,
    operation: 'preview_export' as const,
    format: 'pdf' as const,
    task_id: t.id,
    document_id: t.document_id,
    snapshot_id: snapshot.id,
    export_id: row.id,
  };
  expect(good(await s.app.execute(query)).export_data).toEqual(bytes);
  expect(s.render).toHaveBeenCalledTimes(1);
  expect(await s.app.execute({ ...query, task_id: randomUUID() })).toMatchObject({ ok: false });
  expect(await s.app.execute({ ...query, export_id: randomUUID() })).toMatchObject({
    ok: false,
    code: 'READ_FAILED',
  });
  writeFileSync(join(s.root, 'exports', 'fixed', row.id + '.pdf'), '%PDF-corrupted');
  expect(await s.app.execute(query)).toMatchObject({ ok: false, code: 'READ_FAILED' });
  expect(s.render).toHaveBeenCalledTimes(1);
});
