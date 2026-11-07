import type { createTaskApplication } from '@caselite/application';
import type { AgentRun } from '@caselite/contracts';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, type BrowserWindow, session } from 'electron';
import * as Y from 'yjs';

type Tasks = ReturnType<typeof createTaskApplication>;
const titles = ['合成文档甲｜付款条款', '合成文档乙｜交付条款'];
const lines = ['乙方应于验收后支付剩余款项。', '甲方应在确认后交付样品。'];
const untouched = '🙂合成保密条款：这段未选中的文字只留在本机。';
const replacement = '合成替换：乙方应在验收通过后十个工作日内支付剩余款项。';
const base = { protocol_version: 1 as const };
const mutation = () => ({ ...base, request_id: randomUUID(), idempotency_key: randomUUID() });

export function seedDocumentReview(tasks: Tasks) {
  const list = tasks.execute({ ...base, operation: 'list' });
  if (!list.ok) throw new Error('Cannot read synthetic workspace');
  if (list.tasks.length) return;
  for (const [index, title] of titles.entries()) {
    const result = tasks.execute({ ...mutation(), operation: 'create', title, objective: '' });
    if (!result.ok) throw new Error('Cannot create synthetic document');
    const task = result.tasks[0];
    const doc = new Y.Doc();
    const paragraphs = [lines[index], untouched].map((line) => {
      const block = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, line);
      block.insert(0, [text]);
      return block;
    });
    doc.getXmlFragment('default').insert(0, paragraphs);
    const saved = tasks.execute({
      ...mutation(),
      operation: 'save',
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state: Array.from(Y.encodeStateAsUpdate(doc)),
    });
    doc.destroy();
    if (!saved.ok) throw new Error('Cannot save synthetic document');
  }
}

export async function runDocumentReviewDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  tasks: Tasks,
  runs: () => AgentRun[],
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + '/'),
    )
  )
    throw new Error('Document review demo isolation failed');
  const window = await createWindow();
  window.webContents.setBackgroundThrottling(false);
  const wc = window.webContents;
  const evaluate = (code: string) => wc.executeJavaScript(code);
  async function wait(condition: string) {
    for (let index = 0; index < 100; index++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    writeFileSync(join(root, `${phase}-failure-ui.txt`), await evaluate('document.body.innerText'));
    throw new Error('Document review condition failed: ' + condition);
  }
  const capture = async (name: string) =>
    writeFileSync(join(root, name), (await wc.capturePage()).toPNG());
  const button = (label: string) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const click = async (label: string) => {
    const target = button(label);
    await wait(`${target} && !${target}.disabled`);
    await evaluate(`${target}.click()`);
  };
  const body = "document.querySelector('[data-testid=body-editor]')";
  const revision = "document.querySelector('[data-testid=revision]')?.textContent";
  const list = tasks.execute({ ...base, operation: 'list' });
  if (!list.ok || list.tasks.length !== 2) throw new Error('Expected two seeded documents');
  const [a, b] = titles.map((title) => list.tasks.find((item) => item.title === title)!);
  const open = async (id: string) => {
    await wait("document.querySelector('[data-nav=documents]')");
    await evaluate("document.querySelector('[data-nav=documents]').click()");
    const row = `document.querySelector('[data-document-id="${id}"]')`;
    await wait(row);
    await evaluate(`${row}.click()`);
    await click('打开正文');
    await wait(`${body} && document.querySelector('.document-review textarea')`);
  };
  const select = async () => {
    await evaluate(`(() => {
      const p = ${body}.querySelector('p');
      ${body}.focus();
      const range = document.createRange();
      range.selectNodeContents(p);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 160));
    await click('引用所选文字');
    await wait("document.querySelector('[aria-label=本轮引用]')");
  };
  const question = async (text: string) => {
    await evaluate(`(() => {
      const input = document.querySelector('.document-review textarea');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});
      input.dispatchEvent(new InputEvent('input',{bubbles:true,data:${JSON.stringify(text)}}));
    })()`);
  };
  const assertRunCount = (count: number) => {
    if (runs().length !== count) throw new Error('Unexpected local Run count');
  };
  await open(a.document_id);
  if (phase === 'document-review-read') {
    await wait(
      `${body}.textContent.includes(${JSON.stringify(replacement)}) && ${revision} === '2'`,
    );
    await wait("document.querySelector('.document-review summary')");
    if (
      !runs()
        .filter((run) => run.scope === 'document:' + a.document_id)
        .some((run) => run.status === 'succeeded')
    )
      throw new Error('Saved document history is unavailable');
    await open(b.document_id);
    await wait(`${body}.textContent.includes(${JSON.stringify(lines[1])}) && ${revision} === '1'`);
    writeFileSync(
      join(root, 'reopen.json'),
      JSON.stringify(
        {
          documents: [a.document_id, b.document_id],
          revisions: [a.body_revision, b.body_revision],
          runs: runs().length,
        },
        null,
        2,
      ),
    );
    return;
  }

  const emojiProbe = await evaluate(`(async () => {
    const identity = ${JSON.stringify({ task_id: a.id, document_id: a.document_id, body_id: a.body_id, revision: 1, paragraph: 1 })};
    const request = { protocol_version: 1, operation: 'preview_review', scope: 'document:' + identity.document_id };
    const full = await window.caselite.agent({ ...request, range: { ...identity, from: 0, to: 2, text: '🙂' } });
    const split = await window.caselite.agent({ ...request, range: { ...identity, from: 0, to: 1, text: '🙂'[0] } });
    return full.ok && full.review_preview?.range.text === '🙂' && !split.ok && split.code === 'STALE_PREVIEW';
  })()`);
  if (!emojiProbe) throw new Error('Native IPC accepted a split emoji or rejected an intact one');

  await select();
  await question('合成问题：明确付款期限');
  assertRunCount(0);
  await evaluate(`(() => {
    const input=document.querySelector('.document-review textarea');
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'付'}));
    input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter',isComposing:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Enter'}));
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'付款'}));
  })()`);
  assertRunCount(0);
  await click('发送本轮审阅');
  await wait("document.querySelector('[aria-label=流式候选]')?.textContent.includes('合成替换')");
  await click('停止');
  await wait("!document.querySelector('[aria-label=流式候选]')");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await wait(`${revision}==='1' && !document.querySelector('[aria-label=替换差异]')`);
  if (runs()[0]?.status !== 'cancelled') throw new Error('Stop did not cancel the original Run');

  await select();
  await click('发送本轮审阅');
  await wait("document.querySelector('[aria-label=流式候选]')");
  await open(b.document_id);
  await wait(
    `${body}.textContent.includes(${JSON.stringify(lines[1])}) && !document.querySelector('.document-review textarea').value`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await wait("!document.querySelector('[aria-label=替换差异]')");
  if (runs()[1]?.status !== 'cancelled')
    throw new Error('Document switch did not cancel the original Run');

  await open(a.document_id);
  await select();
  await question('合成问题：核对替换文本');
  await click('发送本轮审阅');
  await wait(
    "document.querySelector('[aria-label=替换差异] ins')?.textContent.includes('十个工作日')",
  );
  await capture('diff.png');
  await click('拒绝');
  await wait(`${body}.textContent.includes(${JSON.stringify(lines[0])}) && ${revision}==='1'`);
  await select();
  await click('发送本轮审阅');
  await click('确认写回');
  await wait(`${body}.textContent.includes(${JSON.stringify(replacement)}) && ${revision}==='2'`);
  await wait(`${body}.textContent.includes(${JSON.stringify(untouched)})`);
  assertRunCount(4);
  await capture('saved.png');

  wc.debugger.attach('1.3');
  try {
    await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 690,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await wait(
      "innerWidth===640 && document.documentElement.scrollWidth<=640 && document.querySelector('.document-review').scrollWidth<=document.querySelector('.document-review').clientWidth",
    );
    await evaluate(
      "document.querySelector('.document-review textarea').scrollIntoView({block:'center'})",
    );
    await wait(
      "document.querySelector('.document-review textarea').getBoundingClientRect().bottom<=innerHeight",
    );
    await capture('narrow.png');
  } finally {
    wc.debugger.detach();
  }
  writeFileSync(
    join(root, 'write.json'),
    JSON.stringify(
      {
        documents: [a.document_id, b.document_id],
        expectedRevisions: [2, 1],
        runs: runs().map(({ id, status, scope }) => ({ id, status, scope })),
        requestsBeforeSend: 0,
        intactEmojiPreview: true,
        splitEmojiRejected: true,
        compositionEvent: 'synthetic',
        network: 'HTTP(S) blocked; synthetic Pi provider',
      },
      null,
      2,
    ),
  );
}
