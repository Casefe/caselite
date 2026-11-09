import type { createTaskApplication } from '@caselite/application';
import type { AgentRun } from '@caselite/contracts';
import { app, session, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 仅沿已校验的临时演示入口运行；主进程已阻断 HTTP(S) 并注入合成 Pi/凭据。
export async function runEditorInteractionDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  tasks: ReturnType<typeof createTaskApplication>,
  runs: () => AgentRun[],
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + '/'),
    )
  )
    throw new Error('Editor demo isolation failed');
  const window = await createWindow();
  window.webContents.setBackgroundThrottling(false);
  const wc = window.webContents;
  const evaluate = (code: string) => wc.executeJavaScript(code);
  async function wait(condition: string) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    writeFileSync(join(root, phase + '-failure.txt'), await evaluate('document.body.innerText'));
    throw new Error('Editor interaction failed: ' + condition);
  }
  const click = async (name: string) => {
    const query = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)} && !b.disabled)`;
    await wait(query);
    await evaluate(`${query}.click()`);
  };
  const capture = async (name: string) =>
    writeFileSync(join(root, name), (await wc.capturePage()).toPNG());
  const list = tasks.execute({ protocol_version: 1, operation: 'list' });
  if (!list.ok || list.tasks.length !== 2) throw new Error('Missing synthetic documents');
  const task = list.tasks.find((t) => t.title.includes('合成文档甲'))!;
  const body = "document.querySelector('[data-testid=body-editor]')";
  const revision = "document.querySelector('[data-testid=revision]')?.textContent";
  await wait("document.querySelector('[data-nav=documents]')");
  await evaluate("document.querySelector('[data-nav=documents]').click()");
  await wait(`document.querySelector('[data-document-id="${task.document_id}"]')`);
  await evaluate(`document.querySelector('[data-document-id="${task.document_id}"]').click()`);
  await click('打开正文');
  await wait(`${body} && document.querySelector('.document-review textarea')`);
  const original = '乙方应于验收后支付剩余款项。';
  const candidate = '合成替换：乙方应在验收通过后十个工作日内支付剩余款项。';
  const untouched = '🙂合成保密条款：这段未选中的文字只留在本机。';
  if (phase === 'editor-interaction-read') {
    await wait(`${revision}==='3' && ${body}.textContent.includes(${JSON.stringify(untouched)})`);
    if ((await evaluate(`${body}.textContent.split(${JSON.stringify(candidate)}).length-1`)) !== 2)
      throw new Error('Inserted/append content did not survive reopening');
    const read = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
    if (!read.ok || read.tasks[0].body_revision !== 3)
      throw new Error('Unexpected reopened revision');
    await capture('reopened.png');
    writeFileSync(
      join(root, 'editor-read.json'),
      JSON.stringify({
        status: 'PASS_REAL',
        revision: 3,
        runCount: runs().length,
        provider: 'MOCK_ONLY',
      }),
    );
    return;
  }
  const select = async () => {
    await evaluate(
      `(()=>{const p=${body}.querySelector('p');${body}.focus();const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`,
    );
    await wait(
      `document.querySelector('[aria-label=本轮引用]')?.textContent.includes(${JSON.stringify(original)})`,
    );
  };
  const question = async () => {
    await evaluate(
      `(()=>{const e=document.querySelector('.document-review textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'合成问题：明确付款期限');e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'合成问题：明确付款期限'}));})()`,
    );
  };
  await select();
  if (runs().length !== 0) throw new Error('Selecting text dispatched a model');
  await question();
  await capture('selection-context.png');
  await click('发送本轮审阅');
  await wait("document.querySelector('[aria-label=流式候选]')");
  await click('停止');
  await wait(`${revision}==='1' && !document.querySelector('[aria-label=替换差异]')`);
  await new Promise((r) => setTimeout(r, 1700));
  if (runs()[0]?.status !== 'cancelled') throw new Error('Stop did not cancel');
  await select();
  await click('发送本轮审阅');
  await wait("document.querySelector('[aria-label=替换差异] ins')");
  if (await evaluate(`${body}.textContent.includes(${JSON.stringify(candidate)})`))
    throw new Error('Candidate changed body before acceptance');
  await capture('candidate-preview.png');
  await click('拒绝');
  await wait(`${revision}==='1'`);
  await select();
  await click('发送本轮审阅');
  await wait("document.querySelector('[aria-label=替换差异] ins')");
  await evaluate(
    "(()=>{const e=document.querySelector('[aria-label=接受方式]');e.value='insert_after';e.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await click('确认写回');
  await wait(
    `${revision}==='2' && ${body}.textContent.includes(${JSON.stringify(original + candidate)})`,
  );
  await wait(`${body}.textContent.includes(${JSON.stringify(untouched)})`);
  await capture('inserted.png');
  // 再从任务成果正文进入 assistant-ui 投影，核对同一正文和同一 Run Owner。
  await evaluate("document.querySelector('[data-nav=tasks]').click()");
  const taskButton = `[...document.querySelectorAll('.task-row-title')].find(b=>b.textContent.trim()===${JSON.stringify(task.title)})`;
  await wait(taskButton);
  await evaluate(`${taskButton}.click()`);
  await wait("document.querySelector('[data-testid=task-result-tab]')");
  await evaluate("document.querySelector('[data-testid=task-result-tab]').click()");
  await wait("document.querySelector('.editor-agent-thread textarea')");
  await select();
  await question();
  await click('发送本轮审阅');
  await wait("document.querySelector('[aria-label=替换差异] ins')");
  await evaluate(
    "(()=>{const e=document.querySelector('[aria-label=接受方式]');e.value='append';e.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await capture('assistant-ui-preview.png');
  await click('确认写回');
  await wait(`${revision}==='3'`);
  await capture('appended.png');
  writeFileSync(
    join(root, 'editor-write.json'),
    JSON.stringify({
      status: 'PASS_REAL',
      revision: 3,
      actions: ['insert_after', 'append'],
      automaticSelection: true,
      stop: true,
      reject: true,
      runCount: runs().length,
      provider: 'MOCK_ONLY',
      network: 'HTTP(S) blocked',
    }),
  );
}
