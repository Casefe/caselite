import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { bodyPlainText, validateBody } from '../../packages/local-db/src/body-schema';
import { createTaskApplication } from '../../packages/application/src/task-application';
import type { TaskResponse } from '../../packages/contracts/src/task';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const ok = (r: TaskResponse) => {
  if (!r.ok) throw new Error(r.message);
  return r;
};
function binary(
  attrs: Record<string, unknown>,
  extra?: Record<string, unknown>,
  block = 'paragraph',
) {
  const doc = new Y.Doc();
  const p = new Y.XmlElement(block),
    t = new Y.XmlText();
  t.insert(0, '合成正文', attrs);
  if (extra) t.insert(4, '片段', extra);
  p.insert(0, [t]);
  doc.getXmlFragment('default').push([p]);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}
it('validates schema2 annotations, rejects legacy/unknown/unsafe/inconsistent marks and code blocks', () => {
  const id = randomUUID(),
    attrs = { highlight: {}, comment: { id, text: '核对付款日期' } };
  const state = binary(attrs, { comment: attrs.comment, bold: {} });
  expect(() => validateBody(state, true, 2)).not.toThrow();
  expect(bodyPlainText(state, true, 2)).toBe('合成正文片段');
  expect(() => validateBody(state, true)).toThrow();
  for (const mark of [
    { highlight: { color: 'red' } },
    { comment: { id, text: ' ' } },
    { comment: { id: 'bad', text: 'x' } },
    { comment: { id, text: 'x'.repeat(4001) } },
    { comment: { id, text: 'x', html: '<script>' } },
    { unknown: {} },
  ])
    expect(() => validateBody(binary(mark), true, 2)).toThrow();
  expect(() => validateBody(binary(attrs, { comment: { id, text: '冲突' } }), true, 2)).toThrow();
  expect(() => validateBody(binary(attrs, undefined, 'codeBlock'), true, 2)).toThrow();
});
it('saves marks/schema atomically, reopens/replays exact bytes, rejects downgrade and preserves old snapshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-annotation-'));
  roots.push(root);
  const file = join(root, 'test.sqlite'),
    migrations = resolve('packages/local-db/migrations');
  let store = openTaskStore(file, migrations);
  const task = ok(
    store.execute({ ...identity(), operation: 'create', title: '合成标记验收', objective: '' }),
  ).tasks[0];
  const base = { task_id: task.id, document_id: task.document_id, body_id: task.body_id };
  const old = ok(
    store.execute({
      ...identity(),
      ...base,
      operation: 'save',
      expected_revision: 0,
      editor_schema: 1,
      state: Array.from(binary({})),
    }),
  ).tasks[0];
  const snapshotRequest = {
    ...identity(),
    ...base,
    operation: 'create_snapshot' as const,
    expected_revision: 1,
    expected_metadata_version: old.document_metadata_version,
    expected_task_version: old.version,
    note: '',
  };
  const snapshot = ok(store.execute(snapshotRequest)).snapshots![0];
  const state = Array.from(
    binary({ highlight: {}, comment: { id: randomUUID(), text: '<b>保留为文本</b>' } }),
  );
  const save = {
    ...identity(),
    ...base,
    operation: 'save' as const,
    expected_revision: 1,
    editor_schema: 2 as const,
    state,
  };
  const raw = openToolchainProbe(file, migrations);
  raw.sqlite.exec(
    "CREATE TRIGGER annotation_failure BEFORE UPDATE ON documents WHEN NEW.editor_schema=2 BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  expect(createTaskApplication(store).execute(save)).toMatchObject({
    ok: false,
    code: 'WRITE_FAILED',
  });
  expect(
    ok(store.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).tasks[0],
  ).toMatchObject({ editor_schema: 1, body_revision: 1 });
  expect(raw.sqlite.prepare('SELECT count(*) n FROM body_revisions').get()).toEqual({ n: 1 });
  expect(
    store.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: save.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  raw.sqlite.exec('DROP TRIGGER annotation_failure');
  raw.sqlite.close();
  expect(ok(store.execute(save)).tasks[0]).toMatchObject({ editor_schema: 2, body_revision: 2 });
  expect(store.agentPage.read(`document:${task.document_id}`)?.text).toContain('合成正文');
  expect(store.agentPage.read(`document:${task.document_id}`)?.text).not.toContain('保留为文本');
  store.close();
  store = openTaskStore(file, migrations);
  expect(
    ok(store.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).state,
  ).toEqual(state);
  expect(ok(store.execute({ ...save, request_id: randomUUID() })).tasks[0].body_revision).toBe(2);
  expect(
    store.execute({
      ...save,
      ...identity(),
      expected_revision: 2,
      editor_schema: 1,
      state: Array.from(binary({})),
    }),
  ).toMatchObject({ ok: false, code: 'CONFLICT' });
  const fixed = ok(
    store.execute({
      protocol_version: 1,
      operation: 'read_snapshot',
      task_id: task.id,
      document_id: task.document_id,
      snapshot_id: snapshot.id,
    }),
  );
  expect(fixed.snapshots![0].content_sha256).toBe(snapshot.content_sha256);
  expect(store.execute({ ...snapshotRequest, ...identity(), expected_revision: 2 })).toMatchObject({
    ok: false,
    code: 'CONFLICT',
    message: expect.stringContaining('高亮或批注'),
  });
  expect(
    ok(
      store.execute({
        ...save,
        ...identity(),
        expected_revision: 2,
        state: Array.from(binary({})),
      }),
    ).tasks[0].editor_schema,
  ).toBe(2);
  store.close();
});

it('bounds unique comments while permitting split fragments of the same annotation', () => {
  const doc = new Y.Doc(),
    p = new Y.XmlElement('paragraph'),
    t = new Y.XmlText();
  p.insert(0, [t]);
  doc.getXmlFragment('default').push([p]);
  for (let i = 0; i < 200; i++)
    t.insert(t.length, '片段', { comment: { id: randomUUID(), text: '合成批注' } });
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true, 2)).not.toThrow();
  t.insert(t.length, '超限', { comment: { id: randomUUID(), text: '第201条' } });
  expect(() => validateBody(Y.encodeStateAsUpdate(doc), true, 2)).toThrow('Too many comments');
  doc.destroy();
});
