import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createAgentApplication,
  createDocumentReviewApplication,
  createTaskApplication,
  type AgentRuntimePort,
} from '../../packages/application/src';
import { openTaskStore } from '../../packages/local-db/src';
import { bodyPlainText } from '../../packages/local-db/src/body-schema';
import type { ReviewRange, TaskResponse, AgentResponse } from '../../packages/contracts/src';
const base = { protocol_version: 1 as const };
const mutation = () => ({ ...base, request_id: randomUUID(), idempotency_key: randomUUID() });
const ok = <T extends TaskResponse | AgentResponse>(r: T) => {
  if (!r.ok) throw new Error(r.message);
  return r as Extract<T, { ok: true }>;
};

it.each([
  ['replace', '前新一\n新二后\n禁止外发'],
  ['insert_after', '前原文新一\n新二后\n禁止外发'],
  ['append', '前原文后\n禁止外发\n新一\n新二'],
] as const)(
  'persists %s as bounded Yjs paragraphs and recovers exactly one receipt',
  async (action, expected) => {
    const directory = mkdtempSync(join(tmpdir(), 'caselite-review-actions-'));
    const file = join(directory, 'test.sqlite');
    const migrations = resolve('packages/local-db/migrations');
    let store = openTaskStore(file, migrations);
    try {
      let tasks = createTaskApplication(store);
      const task = ok(
        tasks.execute({ ...mutation(), operation: 'create', title: '合成编辑交互', objective: '' }),
      ).tasks[0];
      const doc = new Y.Doc();
      for (const line of ['前原文后', '禁止外发']) {
        const block = new Y.XmlElement('paragraph');
        const text = new Y.XmlText();
        text.insert(0, line, { bold: {} });
        block.push([text]);
        doc.getXmlFragment('default').push([block]);
      }
      const original = Array.from(Y.encodeStateAsUpdate(doc));
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
          state: original,
        }),
      );
      const range: ReviewRange = {
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        revision: 1,
        paragraph: 0,
        from: 1,
        to: 3,
        text: '原文',
      };
      let input: Parameters<AgentRuntimePort['start']>[0] | undefined;
      const review = createDocumentReviewApplication(store, tasks);
      const app = createAgentApplication({
        taskExists: () => true,
        review,
        history: store.agentHistory,
        credentials: {
          get: () => 'synthetic',
          set() {},
          clear() {},
          getDefaultModel: () => 'gpt-4.1-mini',
          setDefaultModel() {},
        },
        runtime: {
          start: (args) => {
            input = args;
            return { cancel() {} };
          },
        },
      });
      const scope = `document:${task.document_id}`;
      const id = ok(
        await app.execute({ ...base, operation: 'preview_review', scope, range }, 'window'),
      ).review_preview!.id;
      ok(
        await app.execute(
          {
            ...base,
            operation: 'start',
            scope,
            run_id: id,
            context_id: id,
            confirmed: true,
            prompt: '生成正文',
            model: 'gpt-4.1-mini',
          },
          'window',
        ),
      );
      expect(input!.prompt).toContain('原文');
      expect(input!.prompt).not.toContain('禁止外发');
      input!.onText('新一\n新二');
      input!.onEnd({ status: 'succeeded', message: '', usage: null });
      const apply = {
        ...base,
        operation: 'apply_review' as const,
        scope,
        run_id: id,
        confirmed: true,
        action,
      };
      const saved = ok(await app.execute(apply, 'window')).review_saved!;
      expect(saved.task.body_revision).toBe(2);
      expect(bodyPlainText(Uint8Array.from(saved.state))).toBe(expected);
      expect(ok(await app.execute(apply, 'window')).review_saved).toEqual(saved);
      expect(
        await app.execute(
          { ...apply, action: action === 'append' ? 'replace' : 'append' },
          'window',
        ),
      ).toMatchObject({ ok: false, code: 'CONFLICT' });
      const changed = new Y.Doc();
      Y.applyUpdate(changed, Uint8Array.from(saved.state));
      const first = changed.getXmlFragment('default').get(0) as Y.XmlElement;
      expect((first.get(0) as Y.XmlText).toDelta()[0].attributes).toEqual({ bold: {} });
      changed.destroy();
      app.release();
      store.close();
      store = openTaskStore(file, migrations);
      tasks = createTaskApplication(store);
      const reopened = ok(tasks.execute({ ...base, operation: 'read', task_id: task.id }));
      expect(reopened.tasks[0].body_revision).toBe(2);
      expect(reopened.state).toEqual(saved.state);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it('allows an empty paragraph caret for generation but refuses replacement and split Unicode positions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'caselite-review-caret-'));
  const store = openTaskStore(
    join(directory, 'db.sqlite'),
    resolve('packages/local-db/migrations'),
  );
  try {
    const tasks = createTaskApplication(store);
    const task = ok(
      tasks.execute({ ...mutation(), operation: 'create', title: '空段落', objective: '' }),
    ).tasks[0];
    const doc = new Y.Doc();
    doc.getXmlFragment('default').push([new Y.XmlElement('paragraph')]);
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
      to: 0,
      text: '',
    };
    const review = createDocumentReviewApplication(store, tasks);
    expect(review.matches(range)).toBe(true);
    expect(review.apply(range, '新正文', randomUUID(), 'replace')).toMatchObject({
      code: 'STALE_PREVIEW',
    });
    const result = review.apply(range, '第一段\n第二段', randomUUID(), 'insert_after');
    expect('task' in result && result.task.body_revision).toBe(2);
    const read = ok(tasks.execute({ ...base, operation: 'read', task_id: task.id }));
    expect(bodyPlainText(Uint8Array.from(read.state!))).toBe('第一段\n第二段');
    expect(review.matches({ ...range, revision: 2, from: 1, to: 1, text: '' })).toBe(true);
    expect(review.matches({ ...range, revision: 2, to: 9, text: '' })).toBe(false);
    expect(
      review.apply(
        { ...range, revision: 2 },
        '坏' + String.fromCharCode(0xd800),
        randomUUID(),
        'append',
      ),
    ).toMatchObject({ code: 'STALE_PREVIEW' });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
