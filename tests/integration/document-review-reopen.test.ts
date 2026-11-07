import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createDocumentReviewApplication,
  createTaskApplication,
} from '../../packages/application/src';
import { openTaskStore } from '../../packages/local-db/src';
import { bodyPlainText } from '../../packages/local-db/src/body-schema';
import type { TaskResponse, ReviewRange } from '../../packages/contracts/src';

const mutation = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const ok = (response: TaskResponse) => {
  if (!response.ok) throw new Error(response.message);
  return response;
};

it('recovers the original review receipt after all connections close without writing another revision', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-review-reopen-'));
  const file = join(root, 'review.sqlite');
  const migrations = resolve('packages/local-db/migrations');
  let store = openTaskStore(file, migrations);
  try {
    let tasks = createTaskApplication(store);
    const task = ok(
      tasks.execute({ ...mutation(), operation: 'create', title: '合成审阅恢复', objective: '' }),
    ).tasks[0];
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, '原始条款');
    paragraph.push([text]);
    doc.getXmlFragment('default').push([paragraph]);
    const state = Array.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    ok(
      tasks.execute({
        ...mutation(),
        operation: 'save',
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: 0,
        editor_schema: 1,
        state,
      }),
    );
    const range: ReviewRange = {
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      revision: 1,
      paragraph: 0,
      from: 0,
      to: 4,
      text: '原始条款',
    };
    const receipt = randomUUID();
    let review = createDocumentReviewApplication(store, tasks);
    const saved = review.apply(range, '确认条款', receipt);
    expect(saved).toMatchObject({ task: { body_revision: 2 } });
    store.close();
    store = openTaskStore(file, migrations);
    tasks = createTaskApplication(store);
    review = createDocumentReviewApplication(store, tasks);
    expect(review.receipt(range, receipt)).toEqual(saved);
    expect(review.apply(range, '确认条款', receipt)).toEqual(saved);
    expect(review.apply(range, '另一个候选', randomUUID())).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    const read = ok(tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id }));
    expect(read.tasks[0].body_revision).toBe(2);
    expect(bodyPlainText(Uint8Array.from(read.state!))).toBe('确认条款');
    const otherWorkspace = openTaskStore(file, migrations, 'other-workspace');
    try {
      const other = createDocumentReviewApplication(
        otherWorkspace,
        createTaskApplication(otherWorkspace),
      );
      expect(other.exists(task.document_id)).toBe(false);
      expect(other.matches(range)).toBe(false);
      expect(other.receipt(range, receipt)).toBeUndefined();
      expect(other.apply(range, '越界候选', randomUUID())).toMatchObject({ code: 'STALE_PREVIEW' });
    } finally {
      otherWorkspace.close();
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
