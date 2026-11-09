import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTaskStore } from '../../packages/local-db/src/index';
import type { TaskResponse } from '@caselite/contracts';

const roots: string[] = [];
const stores: ReturnType<typeof openTaskStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function good(result: TaskResponse) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}
const identity = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
it('persists different Yjs histories with equal visible content across restart and retains earlier receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-equal-text-history-'));
  roots.push(root);
  const file = join(root, 'test.sqlite');
  let store = openTaskStore(file, resolve('packages/local-db/migrations'));
  stores.push(store);
  const task = good(
    store.execute({ ...identity(), operation: 'create', title: '合成任务', objective: '' }),
  ).tasks[0];
  const d = new Y.Doc();
  try {
    const text = new Y.XmlText();
    text.insert(0, '相同正文');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [text]);
    d.getXmlFragment('default').insert(0, [paragraph]);
    const first = Array.from(Y.encodeStateAsUpdate(d));
    const projection = d.getXmlFragment('default').toString();
    d.transact(() => {
      text.delete(0, text.length);
      text.insert(0, '相同正文');
    });
    const second = Array.from(Y.encodeStateAsUpdate(d));
    expect(second).not.toEqual(first);
    expect(d.getXmlFragment('default').toString()).toBe(projection);
    const save = {
      ...identity(),
      operation: 'save' as const,
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      editor_schema: 1 as const,
      expected_revision: 0,
      state: first,
    };
    expect(good(store.execute(save)).tasks[0].body_revision).toBe(1);
    expect(
      good(store.execute({ ...save, ...identity(), expected_revision: 1, state: second })).tasks[0]
        .body_revision,
    ).toBe(2);
    store.close();
    stores.pop();
    store = openTaskStore(file, resolve('packages/local-db/migrations'));
    stores.push(store);
    const reread = good(
      store.execute({ protocol_version: 1, operation: 'read', task_id: task.id }),
    );
    expect(reread.tasks[0].body_revision).toBe(2);
    expect(reread.state).toEqual(second);
    expect(good(store.execute({ ...save, request_id: randomUUID() })).tasks[0].body_revision).toBe(
      1,
    );
    expect(store.execute({ ...save, ...identity() })).toMatchObject({
      ok: false,
      code: 'CONFLICT',
    });
    expect(
      good(store.execute({ protocol_version: 1, operation: 'read', task_id: task.id })).state,
    ).toEqual(second);
  } finally {
    d.destroy();
  }
});
