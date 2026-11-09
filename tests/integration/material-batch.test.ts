import { afterEach, expect, it, vi } from 'vitest';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  symlinkSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openTaskStore } from '../../packages/local-db/src/task-store';
import {
  createMaterialApplication,
  type PdfProcessorPort,
} from '../../packages/application/src/material-application';
import { createMaterialBatchApplication } from '../../packages/application/src/material-batch-application';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import {
  scanMaterialBatch,
  validateMaterialBatchPath,
} from '../../apps/desktop/src/main/adapters/material-batch-files';
import type { MaterialBatchResponse, MaterialScope } from '../../packages/contracts/src';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function success(result: MaterialBatchResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.batch;
}
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'caselite-batch-test-')));
  roots.push(root);
  const input = join(root, '客户材料');
  mkdirSync(input);
  const one = join(input, '合同.pdf');
  const two = join(input, '补充.pdf');
  writeFileSync(one, '%PDF-1.4\nfirst synthetic original');
  writeFileSync(two, '%PDF-1.4\nsecond synthetic original');
  let rejectSecond = false;
  let wait: Promise<void> | undefined;
  const processor: PdfProcessorPort = {
    configuration: 'batch-synthetic-v1',
    async inspect(bytes) {
      await wait;
      if (rejectSecond && Buffer.from(bytes).includes(Buffer.from('second')))
        throw new Error('synthetic-inspection-failure');
      return 1;
    },
    async process(_bytes, input) {
      input.onPage({
        page: 1,
        text: '合成文本',
        origin: 'pdf_text',
        blocks: [],
        width: 1,
        height: 1,
        rotation: 0,
      });
    },
  };
  const db = join(root, 'db.sqlite');
  function open() {
    const store = openTaskStore(db, resolve('packages/local-db/migrations'));
    const files = createMaterialFiles(join(root, 'managed'));
    const taskExists = (id: string) =>
      store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok;
    const materials = createMaterialApplication({
      store: store.materials,
      files,
      processor,
      id: randomUUID,
      hash: (text) => createHash('sha256').update(text).digest('hex'),
      taskExists,
      createTask(token, name) {
        const result = store.execute({
          protocol_version: 1,
          operation: 'create',
          request_id: randomUUID(),
          idempotency_key: token,
          title: name,
          objective: '',
        });
        if (!result.ok) throw new Error(result.message);
        return result.tasks[0].id;
      },
    });
    const batch = createMaterialBatchApplication({
      store: store.materials,
      materials,
      id: randomUUID,
      taskExists,
      validatePath: validateMaterialBatchPath,
    });
    return { store, files, materials, batch };
  }
  return {
    root,
    input,
    one,
    two,
    open,
    rejectSecond(value: boolean) {
      rejectSecond = value;
    },
    hold(value?: Promise<void>) {
      wait = value;
    },
  };
}
function request(
  scope: MaterialScope,
  operation: 'run' | 'pause' | 'discard' | 'dismiss',
  id: string,
) {
  return { protocol_version: 1, scope, operation, batch_id: id };
}
it('saves nested same-name files as distinct immutable sources, skips unsupported entries and keeps paths private', async () => {
  const s = setup(),
    app = s.open();
  mkdirSync(join(s.input, '补件'));
  writeFileSync(join(s.input, '补件', '合同.pdf'), '%PDF-1.4\nnew separate original');
  writeFileSync(join(s.input, '说明.txt'), '不支持的合成格式');
  symlinkSync(s.one, join(s.input, '链接.pdf'));
  try {
    const preview = success(
      await app.batch.create('home', '合成批次', await scanMaterialBatch([s.input], true)),
    )!;
    expect(preview.items).toHaveLength(5);
    expect(preview.items.filter((item) => item.state === 'skipped')).toHaveLength(2);
    expect(JSON.stringify(preview)).not.toContain(s.root);
    expect(app.store.materials.stage(preview.id)).toBeUndefined();
    const saved = success(await app.batch.execute(request('home', 'run', preview.id)))!;
    expect(saved.items.filter((item) => item.state === 'saved')).toHaveLength(3);
    const first = app.store.materials.list('home');
    expect(new Set(first.map((item) => item.task_id)).size).toBe(1);
    expect(first.filter((item) => item.name === '合同.pdf')).toHaveLength(2);
    success(await app.batch.execute(request('home', 'run', preview.id)));
    expect(app.store.materials.list('home').map((item) => item.id)).toEqual(
      first.map((item) => item.id),
    );
    for (const item of first)
      expect(
        createHash('sha256')
          .update(await app.files.read(item.asset_version_id, item.sha256))
          .digest('hex'),
      ).toBe(item.sha256);
    await app.materials.close();
  } finally {
    app.store.close();
  }
});
it('keeps partial success and replays only the failed staged token after a real database restart', async () => {
  const s = setup();
  let app = s.open();
  s.rejectSecond(true);
  const preview = success(
    await app.batch.create('home', '合成失败批次', await scanMaterialBatch([s.one, s.two], false)),
  )!;
  const partial = success(await app.batch.execute(request('home', 'run', preview.id)))!;
  expect(partial.items.map((item) => item.state)).toEqual(['saved', 'failed']);
  expect(app.store.materials.pending('home')).toBeUndefined();
  const first = app.store.materials.list('home')[0];
  await app.materials.close();
  app.store.close();
  s.rejectSecond(false);
  app = s.open();
  try {
    const saved = success(await app.batch.execute(request('home', 'run', preview.id)))!;
    expect(saved.items.map((item) => item.state)).toEqual(['saved', 'saved']);
    expect(app.store.materials.list('home').map((item) => item.id)).toEqual([
      first.id,
      preview.items[1].token,
    ]);
    expect(app.store.materials.get(first.id)?.sha256).toBe(first.sha256);
    success(await app.batch.execute(request('home', 'dismiss', preview.id)));
    expect(
      success(await app.batch.execute({ protocol_version: 1, operation: 'list', scope: 'home' })),
    ).toBeNull();
    await app.materials.close();
  } finally {
    app.store.close();
  }
});
it('pauses after the in-flight item, preserves pending identities and rejects cross-scope requests', async () => {
  const s = setup(),
    app = s.open();
  let resume!: () => void;
  s.hold(
    new Promise<void>((done) => {
      resume = done;
    }),
  );
  try {
    const preview = success(
      await app.batch.create('home', '可暂停批次', await scanMaterialBatch([s.one, s.two], false)),
    )!;
    const work = app.batch.execute(request('home', 'run', preview.id));
    await new Promise((done) => setTimeout(done, 25));
    expect(await app.batch.execute(request('home', 'run', preview.id))).toMatchObject({
      ok: false,
      code: 'BUSY',
    });
    success(await app.batch.execute(request('home', 'pause', preview.id)));
    resume();
    const paused = success(await work)!;
    expect(paused.items.map((item) => item.state)).toEqual(['saved', 'pending']);
    expect(
      await app.materials.execute({ protocol_version: 1, scope: 'home', operation: 'new_home' }),
    ).toMatchObject({ ok: false, code: 'BUSY' });
    expect(await app.batch.execute(request(randomUUID(), 'run', preview.id))).toMatchObject({
      ok: false,
      code: 'SCOPE',
    });
    success(await app.batch.execute(request('home', 'discard', preview.id)));
    expect(app.store.materials.list('home').map((item) => item.id)).toEqual([
      preview.items[0].token,
    ]);
    await app.materials.close();
  } finally {
    resume();
    app.store.close();
  }
});
it('does not follow a directory swapped to a symlink between validation and reading', async () => {
  const s = setup(),
    app = s.open();
  const entries = await scanMaterialBatch([s.one], false);
  const outside = join(s.root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, '合同.pdf'), '%PDF-1.4\noutside private synthetic bytes');
  try {
    await validateMaterialBatchPath(s.one);
    renameSync(s.input, join(s.root, 'original-directory'));
    symlinkSync(outside, s.input);
    await expect(app.files.stage(s.one, 'home', randomUUID(), entries[0].expected)).rejects.toThrow(
      'Selected file changed',
    );
    expect(app.store.materials.list('home')).toEqual([]);
  } finally {
    app.store.close();
  }
});
it('rejects an over-limit selection without importing a hidden subset', async () => {
  const s = setup();
  const files = Array.from({ length: 17 }, (_, index) => {
    const file = join(s.input, `材料${index}.pdf`);
    writeFileSync(file, '%PDF-1.4\nsynthetic');
    return file;
  });
  await expect(scanMaterialBatch(files, false)).rejects.toThrow('最多16项');
});
it('lets ordinary attachment uploads proceed while retaining an old batch manifest', async () => {
  const s = setup(),
    app = s.open();
  try {
    const preview = success(
      await app.batch.create('home', '旧批次', await scanMaterialBatch([s.one], false)),
    )!;
    const batchRead = vi.spyOn(app.store.materials, 'activeBatch');
    const staged = await app.materials.stage(s.two, 'home');
    expect(staged.ok).toBe(true);
    if (!staged.ok || !staged.staged) throw new Error('Ordinary staging failed');
    const saved = await app.materials.execute({
      protocol_version: 1,
      scope: 'home',
      operation: 'commit',
      token: staged.staged.token,
    });
    expect(saved.ok).toBe(true);
    expect(batchRead).not.toHaveBeenCalled();
    batchRead.mockRestore();
    expect(app.store.materials.activeBatch('home')?.id).toBe(preview.id);
    expect(app.store.materials.list('home')).toHaveLength(1);
    app.materials.close();
  } finally {
    app.store.close();
  }
});
it('does not persist or return absolute source paths when a selected file disappears', async () => {
  const s = setup(),
    app = s.open();
  try {
    const preview = success(
      await app.batch.create('home', '移走文件', await scanMaterialBatch([s.one], false)),
    )!;
    await rm(s.one);
    const failed = success(await app.batch.execute(request('home', 'run', preview.id)))!;
    expect(failed.items[0].state).toBe('failed');
    expect(JSON.stringify(failed)).not.toContain(s.root);
    expect(JSON.stringify(app.store.materials.activeBatch('home'))).not.toContain(s.root);
    success(await app.batch.execute(request('home', 'discard', preview.id)));
  } finally {
    app.store.close();
  }
});
it('cleans a known batch token left on disk before stage registration without touching saved originals', async () => {
  const s = setup(),
    app = s.open();
  try {
    const entries = await scanMaterialBatch([s.one], false);
    const preview = success(await app.batch.create('home', '落盘中断', entries))!;
    const staged = await app.files.stage(
      s.one,
      'home',
      preview.items[0].token,
      entries[0].expected,
    );
    expect(app.store.materials.stage(staged.token)).toBeUndefined();
    success(await app.batch.execute(request('home', 'discard', preview.id)));
    await expect(app.files.placedOrStaged(staged.token, staged.sha256)).rejects.toThrow();
    expect(app.store.materials.list('home')).toHaveLength(0);
  } finally {
    app.store.close();
  }
});
