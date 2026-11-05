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
    await wait("document.querySelector('[data-testid=save-body]')?.disabled===false");
    await click('[data-testid=save-body]');
    await wait(
      "document.querySelector('[data-testid=revision]')?.textContent==='1' && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
    );
    const id = await evaluate(
      "document.querySelector('[data-task-id]').getAttribute('data-task-id')",
    );
    writeFileSync(join(root, 'expected.json'), JSON.stringify({ id, body }));
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
  }
  await wait("getComputedStyle(document.querySelector('.workbench')).display==='flex'");
  if (phase === 'read')
    await wait(
      "document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
    );
  const image = await window.webContents.capturePage();
  writeFileSync(join(root, `${phase}.png`), image.toPNG());
  process.stdout.write(`Task UI ${phase} passed.\n`);
  window.destroy();
}
