import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { openTaskStore } from '../../packages/local-db/src';
import {
  createMaterialApplication,
  type PdfProcessorPort,
} from '../../packages/application/src/material-application';
import { createTaskApplication, createCatalogApplication } from '../../packages/application/src';
import { createMaterialScopeWritable } from '../../apps/desktop/src/main/adapters/material-scope';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import type { MaterialResponse } from '../../packages/contracts/src';
const roots: string[] = [],
  handles: { close(): void }[] = [];
afterEach(() => {
  handles
    .splice(0)
    .reverse()
    .forEach((row) => row.close());
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const ok = (result: MaterialResponse) => {
  if (!result.ok) throw Error(result.message);
  return result;
};
// 这里只验证真实SQLite/文件身份，图像解码和OCR使用显式合成处理器；原生Vision另验。
const photo = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...new Array<number>(24).fill(0)]);
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'caselite-material-photo-'));
  roots.push(root);
  const store = openTaskStore(join(root, 'db.sqlite'), resolve('packages/local-db/migrations'));
  handles.push(store);
  const files = createMaterialFiles(join(root, 'materials'));
  let writable = true;
  let afterStage: (() => void) | undefined;
  let afterRead: (() => void) | undefined;
  let afterPlace: (() => void) | undefined;
  const processor: PdfProcessorPort = {
    configuration: 'synthetic-photo-identity-only',
    inspect: async () => 1,
    process: async (_bytes, input) =>
      input.onPage({
        page: 1,
        text: '合成照片候选 金额100元',
        origin: 'ocr_candidate',
        blocks: [],
        width: 100,
        height: 100,
        rotation: 0,
      }),
  };
  function make() {
    return createMaterialApplication({
      store: store.materials,
      files: {
        ...files,
        placedOrStaged: async (...args) => {
          const bytes = await files.placedOrStaged(...args);
          afterRead?.();
          return bytes;
        },
        place: async (...args) => {
          await files.place(...args);
          afterPlace?.();
        },
        stagePhoto: async (...args) => {
          const staged = await files.stagePhoto!(...args);
          afterStage?.();
          return staged;
        },
      },
      processor,
      imageProcessor: processor,
      id: randomUUID,
      hash: (text) => createHash('sha256').update(text).digest('hex'),
      taskExists: (id) => store.execute({ protocol_version: 1, operation: 'read', task_id: id }).ok,
      scopeWritable: () => writable,
      createTask(token, name) {
        const result = store.execute({
          protocol_version: 1,
          operation: 'create',
          request_id: randomUUID(),
          idempotency_key: token,
          title: name,
          objective: '',
        });
        if (!result.ok) throw Error(result.message);
        return result.tasks[0].id;
      },
    });
  }
  const result = store.execute({
    protocol_version: 1,
    operation: 'create',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    title: '合成照片任务',
    objective: '',
  });
  if (!result.ok) throw Error('No task');
  const scope = result.tasks[0].id;
  return {
    root,
    store,
    files,
    app: make(),
    make,
    scope,
    setWritable: (value: boolean) => {
      writable = value;
    },
    setAfterRead: (action: () => void) => {
      afterRead = action;
    },
    setAfterPlace: (action: () => void) => {
      afterPlace = action;
    },
    setAfterStage: (action: () => void) => {
      afterStage = action;
    },
  };
}
it('uses only host-issued photo identities, replays the same bytes without duplication, and preserves originals after restart', async () => {
  const s = setup();
  const request = {
    protocol_version: 1,
    operation: 'capture_photo',
    scope: s.scope,
    token: randomUUID(),
    bytes: photo,
  };
  expect(await s.app.execute(request)).toMatchObject({ ok: false, code: 'SCOPE' });
  const token = ok(
    await s.app.execute({ protocol_version: 1, operation: 'photo_ticket', scope: s.scope }),
  ).capture_token!;
  const capture = { ...request, token };
  const staged = ok(await s.app.execute(capture)).staged!;
  expect(staged.token).toBe(token);
  const original = s.store.materials.stage(token)!;
  ok(await s.app.execute(capture));
  expect(s.store.materials.stage(token)).toEqual(original);
  const changed = photo.slice();
  changed[20] = 1;
  expect(await s.app.execute({ ...capture, bytes: changed })).toMatchObject({ ok: false });
  expect(s.store.materials.stage(token)?.sha256).toBe(original.sha256);
  const saved = ok(
    await s.app.execute({ protocol_version: 1, operation: 'commit', scope: s.scope, token }),
  ).materials.find((row) => row.id === token)!;
  expect(Buffer.from(await s.files.read(saved.asset_version_id, saved.sha256))).toEqual(
    Buffer.from(photo),
  );
  const resumed = s.make();
  ok(await resumed.execute(capture));
  expect(s.store.materials.list(s.scope)).toHaveLength(1);
  expect(existsSync(join(s.root, 'materials/staging', token + '.asset'))).toBe(false);
});
it('cannot reuse a PDF staging token for a photo, including direct adapter identity checks', async () => {
  const s = setup();
  const fixture = resolve('tests/fixtures/case-materials/development/contract-v1-text.pdf');
  const bytes = readFileSync(fixture);
  const staged = ok(await s.app.stage(fixture, s.scope)).staged!;
  const original = s.store.materials.stage(staged.token)!;
  expect(
    await s.app.execute({
      protocol_version: 1,
      operation: 'capture_photo',
      scope: s.scope,
      token: staged.token,
      bytes: photo,
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(s.store.materials.stage(staged.token)).toEqual(original);
  await expect(s.files.stagePhoto!(photo, s.scope, staged.token)).rejects.toThrow();
  expect(existsSync(join(s.root, 'materials/staging', staged.token + '.asset'))).toBe(false);
  expect(Buffer.from(await s.files.placedOrStaged(staged.token, original.sha256))).toEqual(bytes);
  expect(readFileSync(fixture)).toEqual(bytes);
});
it('keeps read access but rejects writes into a read-only scope and rechecks scope after the photo file is staged', async () => {
  const s = setup();
  const token = ok(
    await s.app.execute({ protocol_version: 1, operation: 'photo_ticket', scope: s.scope }),
  ).capture_token!;
  s.setWritable(false);
  expect(s.app.canCapture(s.scope)).toBe(false);
  expect(
    await s.app.execute({ protocol_version: 1, operation: 'photo_ticket', scope: s.scope }),
  ).toMatchObject({ ok: false, code: 'SCOPE' });
  expect(
    await s.app.execute({
      protocol_version: 1,
      operation: 'capture_photo',
      scope: s.scope,
      token,
      bytes: photo,
    }),
  ).toMatchObject({ ok: false, code: 'SCOPE' });
  ok(await s.app.execute({ protocol_version: 1, operation: 'list', scope: s.scope }));
  s.setWritable(true);
  s.setAfterStage(() => s.setWritable(false));
  expect(
    await s.app.execute({
      protocol_version: 1,
      operation: 'capture_photo',
      scope: s.scope,
      token,
      bytes: photo,
    }),
  ).toMatchObject({ ok: false, code: 'SCOPE' });
  expect(s.store.materials.stage(token)).toBeUndefined();
  expect(existsSync(join(s.root, 'materials/staging', token + '.asset'))).toBe(false);
});

it('uses the same Main scope policy with real project/task applications and rejects archived projects', () => {
  const s = setup();
  const catalog = createCatalogApplication(s.store.catalog);
  const tasks = createTaskApplication(s.store);
  const project = catalog.execute({
    protocol_version: 1,
    operation: 'create_project',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    title: '合成财务材料项目',
  });
  if (!project.ok || !project.target_id) throw Error('No project');
  const created = tasks.execute({
    protocol_version: 1,
    operation: 'create',
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
    title: '财务材料',
    objective: '',
    matter_id: project.target_id,
  });
  if (!created.ok) throw Error('No task');
  const writable = createMaterialScopeWritable({
    task: (scope) => s.store.materials.task(scope),
    tasks,
    catalog,
  });
  const scope = created.tasks[0].id;
  expect(writable(scope)).toBe(true);
  expect(writable('home')).toBe(true);
  expect(writable(randomUUID())).toBe(false);
  const current = catalog.execute({ protocol_version: 1, operation: 'list' });
  if (!current.ok) throw Error('No catalog');
  expect(
    catalog.execute({
      protocol_version: 1,
      operation: 'archive_project',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      id: project.target_id,
      archived: true,
      expected_version: current.projects.find((row) => row.id === project.target_id)!.version,
    }),
  ).toMatchObject({ ok: true });
  expect(writable(scope)).toBe(false);
});

it('preserves an existing photo stage when a replay becomes read-only after the file check', async () => {
  const s = setup();
  const token = ok(
    await s.app.execute({ protocol_version: 1, operation: 'photo_ticket', scope: s.scope }),
  ).capture_token!;
  const request = {
    protocol_version: 1,
    operation: 'capture_photo',
    scope: s.scope,
    token,
    bytes: photo,
  };
  ok(await s.app.execute(request));
  const staged = s.store.materials.stage(token)!;
  s.setAfterStage(() => s.setWritable(false));
  expect(await s.app.execute(request)).toMatchObject({ ok: false, code: 'SCOPE' });
  expect(s.store.materials.stage(token)).toEqual(staged);
  expect(Buffer.from(await s.files.placedOrStaged(token, staged.sha256))).toEqual(
    Buffer.from(photo),
  );
  s.setWritable(true);
  ok(await s.app.execute({ protocol_version: 1, operation: 'commit', scope: s.scope, token }));
  expect(Buffer.from(await s.files.read(token, staged.sha256))).toEqual(Buffer.from(photo));
});

it('preserves recoverable bytes and stage without posting a material if scope changes during read or placement', async () => {
  for (const phase of ['read', 'place'] as const) {
    const s = setup();
    const token = ok(
      await s.app.execute({ protocol_version: 1, operation: 'photo_ticket', scope: s.scope }),
    ).capture_token!;
    ok(
      await s.app.execute({
        protocol_version: 1,
        operation: 'capture_photo',
        scope: s.scope,
        token,
        bytes: photo,
      }),
    );
    const stage = s.store.materials.stage(token)!;
    if (phase === 'read') s.setAfterRead(() => s.setWritable(false));
    else s.setAfterPlace(() => s.setWritable(false));
    const request = { protocol_version: 1, operation: 'commit', scope: s.scope, token };
    expect(await s.app.execute(request)).toMatchObject({ ok: false, code: 'SCOPE' });
    expect(s.store.materials.list(s.scope)).toEqual([]);
    expect(s.store.materials.stage(token)?.state).toBe('staged');
    expect(Buffer.from(await s.files.placedOrStaged(token, stage.sha256))).toEqual(
      Buffer.from(photo),
    );
    s.setAfterRead(() => {});
    s.setAfterPlace(() => {});
    s.setWritable(true);
    ok(await s.app.execute(request));
    expect(s.store.materials.list(s.scope)).toHaveLength(1);
  }
});
