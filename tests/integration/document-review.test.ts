import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createAgentApplication,
  createTaskApplication,
  type AgentRuntimePort,
} from '../../packages/application/src';
import { openTaskStore, openToolchainProbe } from '../../packages/local-db/src';
import { documentReviewStore } from '../../apps/desktop/src/main/document-review-store';
import type { AgentResponse, ReviewRange, TaskResponse } from '../../packages/contracts/src';
import { bodyPlainText } from '../../packages/local-db/src/body-schema';

const base = { protocol_version: 1 as const };
const mutation = () => ({ ...base, request_id: randomUUID(), idempotency_key: randomUUID() });
const ok = <T extends AgentResponse | TaskResponse>(result: T) => {
  if (!result.ok) throw new Error(result.message);
  return result as Extract<T, { ok: true }>;
};

it('revalidates saved text and ownership, isolates runs, and appends once after a lost receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-review-test-'));
  const migrations = resolve('packages/local-db/migrations');
  const file = join(root, 'review.sqlite');
  const store = openTaskStore(file, migrations);
  const inspect = openToolchainProbe(file, migrations);
  const tasks = createTaskApplication(store);
  const credentials = {
    get: () => 'synthetic-review-key',
    set() {},
    clear() {},
    getDefaultModel: () => 'gpt-4.1-mini' as const,
    setDefaultModel() {},
  };
  let dispatched: Parameters<AgentRuntimePort['start']>[0] | undefined;
  const cancel = vi.fn();
  const startRuntime = vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
    dispatched = input;
    return { cancel };
  });
  const review = documentReviewStore(store, tasks);
  let loseReceipt = false;
  let failBeforeCommit = false;
  const app = createAgentApplication({
    credentials,
    runtime: { start: startRuntime },
    history: store.agentHistory,
    review: {
      ...review,
      apply(range, replacement, key) {
        if (failBeforeCommit) {
          failBeforeCommit = false;
          throw new Error('Synthetic failure before commit');
        }
        const result = review.apply(range, replacement, key);
        if (loseReceipt && !('code' in result)) {
          loseReceipt = false;
          throw new Error('Synthetic lost receipt');
        }
        return result;
      },
    },
    taskExists: (task_id) => tasks.execute({ ...base, operation: 'read', task_id }).ok,
  });
  function create(title: string) {
    const {
      tasks: [task],
    } = ok(
      tasks.execute({ ...mutation(), operation: 'create', title, objective: '不能发送的说明' }),
    );
    const doc = new Y.Doc();
    for (const line of ['标题前缀：🙂所选条款；尾部保留。', '禁止发送未选段落']) {
      const paragraph = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, line);
      paragraph.insert(0, [text]);
      doc.getXmlFragment('default').push([paragraph]);
    }
    const state = Array.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const save = {
      ...mutation(),
      operation: 'save' as const,
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1 as const,
      state,
    };
    ok(tasks.execute(save));
    return { task, state, save };
  }

  try {
    const { task, state, save } = create('合成文档甲');
    const other = create('合成文档乙');
    const scope = `document:${task.document_id}`;
    const otherScope = `document:${other.task.document_id}`;
    const range: ReviewRange = {
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      revision: 1,
      paragraph: 0,
      from: '标题前缀：🙂'.length,
      to: '标题前缀：🙂所选条款'.length,
      text: '所选条款',
    };
    const preview = { ...base, operation: 'preview_review', scope, range } as const;
    expect(
      await app.execute({ ...preview, range: { ...range, text: '伪造条款' } }, 'a'),
    ).toMatchObject({ ok: false, code: 'STALE_PREVIEW' });
    expect(await app.execute({ ...preview, scope: otherScope }, 'a')).toMatchObject({
      ok: false,
      code: 'STALE_PREVIEW',
    });
    expect(
      await app.execute(
        { ...preview, range: { ...range, from: range.from - 1, text: '🙂'[1] + range.text } },
        'a',
      ),
    ).toMatchObject({ ok: false, code: 'STALE_PREVIEW' });
    expect(
      ok(
        await app.execute(
          { ...preview, range: { ...range, from: range.from - 2, text: '🙂' + range.text } },
          'a',
        ),
      ).review_preview?.range.text,
    ).toBe('🙂' + range.text);
    const previewId = async () => ok(await app.execute(preview, 'a')).review_preview!.id;
    const send = (id: string) =>
      ({
        ...base,
        scope,
        operation: 'start',
        run_id: id,
        context_id: id,
        confirmed: true,
        model: 'gpt-4.1-mini',
        prompt: '本轮问题',
      }) as const;
    const apply = (id: string) =>
      ({ ...base, scope, operation: 'apply_review', run_id: id, confirmed: true }) as const;
    const end = () => {
      dispatched?.onText('<strong>替换正文</strong>');
      dispatched?.onEnd({ status: 'succeeded', usage: null, message: '' });
    };
    const stopped = await previewId();
    expect(startRuntime).not.toHaveBeenCalled();
    expect(await app.execute(send(stopped), 'b')).toMatchObject({
      ok: false,
      code: 'STALE_PREVIEW',
    });
    ok(await app.execute(send(stopped), 'a'));
    expect(dispatched?.prompt).toContain(range.text);
    expect(dispatched?.prompt).toContain('本轮问题');
    expect(dispatched?.prompt).not.toMatch(/前缀|未选段落|任务说明|合成文档/);
    ok(await app.execute(send(stopped), 'a'));
    expect(startRuntime).toHaveBeenCalledTimes(1);
    ok(await app.execute({ ...base, scope, operation: 'cancel', run_id: stopped }, 'a'));
    end();
    expect(cancel).toHaveBeenCalledOnce();
    expect(await app.execute(apply(stopped), 'a')).toMatchObject({
      ok: false,
      code: 'INVALID_CANDIDATE',
    });

    const rejected = await previewId();
    ok(await app.execute(send(rejected), 'a'));
    end();
    ok(await app.execute({ ...base, scope, operation: 'discard_review', run_id: rejected }, 'a'));
    expect(await app.execute(apply(rejected), 'a')).toMatchObject({
      ok: false,
      code: 'STALE_PREVIEW',
    });

    const id = await previewId();
    ok(await app.execute(send(id), 'a'));
    end();
    expect(await app.execute(apply(id), 'b')).toMatchObject({ ok: false, code: 'STALE_PREVIEW' });
    expect(await app.execute({ ...apply(id), scope: otherScope }, 'a')).toMatchObject({
      ok: false,
      code: 'STALE_PREVIEW',
    });
    const status = { ...base, scope, operation: 'status_review', run_id: id } as const;
    failBeforeCommit = true;
    expect(await app.execute(apply(id), 'a')).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(await app.execute(status, 'a')).toMatchObject({ ok: false, code: 'NO_RECEIPT' });
    expect(
      ok(tasks.execute({ ...base, operation: 'read', task_id: task.id })).tasks[0].body_revision,
    ).toBe(1);
    loseReceipt = true;
    expect(await app.execute(apply(id), 'a')).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    const saved = ok(await app.execute(status, 'a')).review_saved!;
    expect(ok(await app.execute(apply(id), 'a')).review_saved).toEqual(saved);
    expect(saved.task.body_revision).toBe(2);
    expect(bodyPlainText(Uint8Array.from(saved.state))).toBe(
      '标题前缀：🙂<strong>替换正文</strong>；尾部保留。\n禁止发送未选段落',
    );
    const revisions = inspect.sqlite
      .prepare('SELECT revision,state FROM body_revisions WHERE body_id=? ORDER BY revision')
      .all(task.body_id) as { revision: number; state: Buffer }[];
    expect(revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(Array.from(revisions[0].state)).toEqual(state);
    expect(ok(await app.execute({ ...base, operation: 'read', scope: task.id }, 'a')).runs).toEqual(
      [],
    );
    expect(
      ok(await app.execute({ ...base, operation: 'read', scope: otherScope }, 'a')).runs,
    ).toEqual([]);
    expect(ok(await app.execute({ ...base, operation: 'history' }, 'a')).runs).toEqual([]);

    const updatedPreview = {
      ...preview,
      range: {
        ...range,
        revision: 2,
        to: range.from + '<strong>替换正文</strong>'.length,
        text: '<strong>替换正文</strong>',
      },
    };
    const stale = ok(await app.execute(updatedPreview, 'a')).review_preview!.id;
    ok(tasks.execute({ ...save, ...mutation(), state: saved.state, expected_revision: 2 }));
    expect(await app.execute(send(stale), 'a')).toMatchObject({ ok: false, code: 'STALE_PREVIEW' });
    expect(startRuntime).toHaveBeenCalledTimes(3);

    const invalid = ok(
      await app.execute(
        { ...updatedPreview, range: { ...updatedPreview.range, revision: 3 } },
        'a',
      ),
    ).review_preview!.id;
    ok(await app.execute(send(invalid), 'a'));
    dispatched?.onText('候选' + '🙂'[0]);
    dispatched?.onEnd({ status: 'succeeded', usage: null, message: '' });
    expect(await app.execute(apply(invalid), 'a')).toMatchObject({
      ok: false,
      code: 'INVALID_CANDIDATE',
    });

    const archive = ok(
      await app.execute(
        { ...updatedPreview, range: { ...updatedPreview.range, revision: 3 } },
        'a',
      ),
    ).review_preview!.id;
    ok(await app.execute(send(archive), 'a'));
    dispatched?.onText('归档前收到的候选');
    dispatched?.onEnd({ status: 'succeeded', usage: null, message: '' });
    inspect.sqlite
      .prepare("UPDATE documents SET archived_at='2026-11-07' WHERE id=?")
      .run(task.document_id);
    expect(await app.execute(apply(archive), 'a')).toMatchObject({
      ok: false,
      code: 'STALE_PREVIEW',
    });
    expect(
      ok(tasks.execute({ ...base, operation: 'read', task_id: task.id })).tasks[0].body_revision,
    ).toBe(3);
  } finally {
    app.release();
    inspect.sqlite.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
