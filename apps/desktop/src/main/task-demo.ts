import { BrowserWindow, session } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 仅在宿主校验过的临时合成目录运行；不触碰正常用户数据，也不开放调试端口。
export async function runTaskDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow();
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Task demo timed out: ' + predicate);
  };
  const capture = async (name: string) => {
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))',
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const frame = await window.webContents.capturePage();
    writeFileSync(join(root, name), frame.toPNG());
  };
  const click = async (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = async (selector: string, value: string) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await wait(
    "document.querySelector('[data-testid=new-task]') && !document.body.textContent.includes('正在读取')",
  );
  if (phase === 'write') {
    await click('[data-testid=new-task]');
    await input('[data-testid=task-title]', '服务合同事实梳理');
    await input('[data-testid=task-objective]', '核对两份材料的事实、矛盾及缺件，形成内部沟通初稿');
    await click('[data-testid=create-task]');
    await wait("document.querySelector('[data-testid=body-editor]')");
    const body =
      '合同记载服务费120,000元；补充记录称100,000元，差异待核验。现有材料未提供金额变更文件、发票及收悉凭证。请补充文件并解释金额差异。';
    await evaluate(
      `document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,${JSON.stringify(body)})`,
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('AI 助手')).click()",
    );
    await wait(
      "document.querySelector('.ai-inspector') && document.querySelector('[data-testid=body-editor]')",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('属性')).click()",
    );
    await wait(
      "document.querySelector('.inspector-content') && document.querySelector('[data-testid=save-body]')?.disabled===false",
    );
    await click('[data-nav=projects]');
    await wait(
      "document.querySelector('[data-testid=body-editor]') && document.querySelector('[role=alert]')?.textContent.includes('请先保存')",
    );
    await wait("document.querySelector('[data-testid=save-body]')?.disabled===false");
    await click('[data-testid=save-body]');
    await wait(
      "document.querySelector('[data-testid=revision]')?.textContent==='1' && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
    );
    await wait("document.querySelector('[data-task-id]')");
    const id = await evaluate(
      "document.querySelector('[data-task-id]').getAttribute('data-task-id')",
    );
    writeFileSync(join(root, 'expected.json'), JSON.stringify({ id, body }));
    await click('[data-testid=new-task]');
    await input('[data-testid=task-title]', '采购任务隔离样本B');
    await input('[data-testid=task-objective]', '独立任务B，不应显示A的正文');
    await click('[data-testid=create-task]');
    await wait(
      "document.querySelector('[data-testid=body-editor]') && document.body.textContent.includes('采购任务隔离样本B')",
    );
    await click(`[data-task-id="${id}"]`);
    await wait(
      `document.querySelector('[data-testid=body-editor]')?.textContent.includes(${JSON.stringify(body)})`,
    );
  } else {
    const expected = JSON.parse(readFileSync(join(root, 'expected.json'), 'utf8'));
    await click(`[data-task-id="${expected.id}"]`);
    await wait("document.querySelector('[data-testid=body-editor]')");
    await wait(
      `document.querySelector('[data-testid=body-editor]')?.textContent.includes(${JSON.stringify(expected.body)})`,
    );
    if (phase === 'crash') {
      await evaluate(
        "document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,'补充核验记录：尚不能确认实际付款。')",
      );
      await wait("document.querySelector('[data-testid=save-body]')?.disabled===false");
      await click('[data-testid=save-body]');
      await wait(
        "document.querySelector('[data-testid=revision]')?.textContent==='2' && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
      );
      expected.body = await evaluate(
        "document.querySelector('[data-testid=body-editor]').textContent",
      );
      writeFileSync(join(root, 'expected.json'), JSON.stringify(expected));
      process.kill(process.pid, 'SIGKILL');
    }
    await wait("document.querySelector('[data-testid=revision]')?.textContent==='2'");
    await evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='任务目标').click()",
    );
    await wait("document.querySelector('.goal-panel')");
    await evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.startsWith('成果正文')).click()",
    );
    await wait(
      `document.querySelector('[data-testid=body-editor]')?.textContent.includes(${JSON.stringify(expected.body)})`,
    );
    await wait("document.querySelector('[data-testid=revision]')?.textContent==='2'");
  }
  await wait("getComputedStyle(document.querySelector('.workbench')).display==='flex'");
  if (phase === 'read')
    await wait(
      "document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
    );
  await capture(`${phase}.png`);
  if (phase === 'read') {
    const assertColumns = async () => {
      const valid = await evaluate(`(()=>{
        const left=document.querySelector('.primary-sidebar').getBoundingClientRect();
        const center=document.querySelector('.task-work-area').getBoundingClientRect();
        const right=document.querySelector('.task-inspector').getBoundingClientRect();
        const footer=document.querySelector('.document footer').getBoundingClientRect();
        return left.right<=center.left && center.right<=right.left+1 && right.width>=240 && right.right<=innerWidth+1 && footer.bottom<=innerHeight+1;
      })()`);
      if (!valid) throw new Error('Three-column layout or visible save footer failed');
    };
    await assertColumns();
    await evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('AI 助手')).click()",
    );
    await wait(
      "document.querySelector('.ai-inspector') && document.querySelector('[data-testid=revision]')?.textContent==='2'",
    );
    await capture('three-column-ai.png');
    window.setSize(980, 740);
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    await assertColumns();
    await capture('three-column-compact.png');
    window.setSize(1280, 800);
    await evaluate(
      "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('属性')).click()",
    );
    await click('[data-nav=home]');
    await wait("document.querySelector('.home-view')");
    await capture('home.png');
    await click('[data-nav=projects]');
    await wait("document.querySelector('[data-testid=project-preview]')");
    await capture('projects-list.png');
    await evaluate('document.querySelector(\'[aria-label="项目看板视图"]\').click()');
    await wait("document.querySelector('.project-board')");
    await capture('projects-board.png');
    await click('[data-project-id=sample-contract]');
    await wait("document.querySelector('.project-properties')");
    await capture('project-overview.png');
    await click('[data-project-tab=任务]');
    await click('[data-sample-task="0"]');
    await wait("document.querySelector('.sample-detail')");
    await capture('project-task.png');
    await click('[data-nav=tasks]');
    await evaluate("document.querySelector('[data-testid=back-to-tasks]')?.click()");
    await wait("document.querySelector('.list-view')");
    await input('[aria-label="搜索本地任务"]', '采购');
    await wait("document.querySelectorAll('[data-row-task]').length===1");
    await input('[aria-label="搜索本地任务"]', '');
    await wait("document.querySelectorAll('[data-row-task]').length===2");
    await capture('task-list.png');
  }
  process.stdout.write(`Task UI ${phase} passed.\n`);
  window.destroy();
}
