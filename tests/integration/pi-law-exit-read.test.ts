import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { openTaskStore } from '../../packages/local-db/src/index';
import { bodyPlainText } from '../../packages/local-db/src/body-schema';
import type { TaskResponse } from '../../packages/contracts/src/task';
import { loadReuseDifferenceIndex } from '../fixtures/pi-law/reuse-difference-index';

// 退出条件：不加载Pi适配，关闭连接后仍能读回原任务、Run、Yjs正文和材料来源。
// 读失败或临时库丢修订时本测试失败；afterEach只删除临时目录，不碰正式工作区。
const require = createRequire(new URL('../../packages/local-db/package.json', import.meta.url));
const Y = require('yjs') as typeof import('yjs');
const migrations = resolve('packages/local-db/migrations');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function value(response: TaskResponse) {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.message);
  return response;
}
function identity() {
  return {
    protocol_version: 1 as const,
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
  };
}
function body(text: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  doc.getXmlFragment('default').insert(0, [paragraph]);
  const bytes = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}

it('reads the task, run, Yjs body and material source after restart without a Pi adapter', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-pi-exit-'));
  roots.push(root);
  const file = join(root, 'exit.sqlite');
  const store = openTaskStore(file, migrations);
  const task = value(
    store.execute({ ...identity(), operation: 'create', title: '合成退出任务', objective: '' }),
  ).tasks[0];
  const state = body('合成退出正文');
  const saved = value(
    store.execute({
      ...identity(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state,
    }),
  );
  expect(saved.tasks[0].body_revision).toBe(1);
  const runId = randomUUID();
  store.agentHistory.register({
    id: runId,
    scope: task.id,
    prompt: '合成退出输入',
    output: '合成退出回答',
    status: 'succeeded',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    sequence: 1,
    message: '',
    usage: null,
  });
  const sourceId = randomUUID();
  const sha256 = createHash('sha256').update('synthetic-exit-source').digest('hex');
  const stage = {
    token: sourceId,
    scope: task.id,
    name: '合成退出来源.pdf',
    bytes: 32,
    sha256,
    state: 'staged' as const,
  };
  store.materials.putStage(stage);
  store.materials.commit(stage, task.id, 1);
  store.close();

  const reopened = openTaskStore(file, migrations);
  const read = value(
    reopened.execute({ operation: 'read', protocol_version: 1, task_id: task.id }),
  );
  expect(read.tasks[0]).toMatchObject({
    id: task.id,
    title: '合成退出任务',
    body_id: task.body_id,
    body_revision: 1,
  });
  expect(read.state).toEqual(state);
  expect(bodyPlainText(Uint8Array.from(read.state ?? []))).toBe('合成退出正文');
  expect(reopened.agentHistory.load()).toEqual([
    expect.objectContaining({
      id: runId,
      scope: task.id,
      prompt: '合成退出输入',
      output: '合成退出回答',
      status: 'succeeded',
    }),
  ]);
  expect(reopened.materials.list(task.id)).toEqual([
    expect.objectContaining({
      id: sourceId,
      task_id: task.id,
      name: '合成退出来源.pdf',
      sha256,
    }),
  ]);
  expect(
    reopened.execute({ operation: 'read', protocol_version: 1, task_id: randomUUID() }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  reopened.close();

  const index = loadReuseDifferenceIndex();
  expect(index.entries.find((item) => item.id === 'exit-host-read')).toMatchObject({
    status: 'PASS_REAL',
    evidence: 'tests/integration/pi-law-exit-read.test.ts',
  });
  expect(index.entries.find((item) => item.id === 'product-acceptance')?.status).toBe('NOT_RUN');
  expect(index.entries.find((item) => item.id === 'candidate-acceptance')?.status).toBe('NOT_RUN');
});
