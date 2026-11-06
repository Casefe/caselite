import { app, type BrowserWindow, session } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { CatalogResponse } from '@caselite/contracts';

// 沿用宿主校验过的合成目录和正式IPC；只测项目，不改全工作台演示的既有断言。
export async function runProjectDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: 'project-write' | 'project-read',
) {
  const isolation = {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    storage: session.defaultSession.storagePath,
  };
  if (Object.values(isolation).some((path) => !path?.startsWith(root + sep)))
    throw new Error('Project probe escaped its isolated directory');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow();
  window.webContents.setBackgroundThrottling(false);
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Project probe timed out: ' + predicate);
  };
  const capture = async (name: string) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(join(root, name), (await window.webContents.capturePage()).toPNG());
  };
  const button = (text: string) =>
    evaluate(`(()=>{
    const button=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)});
    if(!button||button.disabled) throw new Error('Project button unavailable');
    button.click();
  })()`);
  try {
    await wait("document.querySelector('[data-nav=projects]')");
    await evaluate("document.querySelector('[data-nav=projects]').click()");
    await wait("document.querySelector('[data-testid=project-catalog]')");
    if (phase === 'project-write') {
      await button('创建项目');
      await wait("document.querySelector('dialog[open] input')===document.activeElement");
      if (!(await evaluate("document.querySelector('dialog button[type=submit]').disabled")))
        throw new Error('Empty project can be submitted');
      await capture('project-create.png');
      // 模拟React输入事件；系统中文候选选择另记人工未测，不能用此断言替代。
      await evaluate(`(()=>{
        const input=document.querySelector('dialog input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'项目创建与重启验收');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await wait("!document.querySelector('dialog button[type=submit]').disabled");
      await evaluate(`(()=>{
        const form=document.querySelector('dialog form');
        form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      })()`);
      await wait(
        "document.querySelector('[aria-label=编辑项目名称]')?.value==='项目创建与重启验收'",
      );
      const result: CatalogResponse = await evaluate(
        "window.caselite.catalog({operation:'list',protocol_version:1})",
      );
      if (
        !result.ok ||
        result.projects.length !== 1 ||
        result.projects[0].title !== '项目创建与重启验收'
      )
        throw new Error('Project create receipt or duplicate submission failed');
      const id = result.projects[0].id;
      if ((await evaluate("document.querySelector('.catalog-actions').dataset.projectId")) !== id)
        throw new Error('Created project opened a different identity');
      writeFileSync(
        join(root, 'project-expected.json'),
        JSON.stringify({ id, isolation }, null, 2),
      );
      await capture('project-created.png');
      await button('返回项目列表');
      await wait("document.querySelector('.project-title-link')");
      await button('项目创建与重启验收');
      await wait("document.querySelector('[aria-label=编辑项目名称]')");
    } else {
      const expected = JSON.parse(readFileSync(join(root, 'project-expected.json'), 'utf8'));
      await wait("document.querySelector('.project-title-link')");
      await button('项目创建与重启验收');
      await wait(
        "document.querySelector('[aria-label=编辑项目名称]')?.value==='项目创建与重启验收'",
      );
      if (
        (await evaluate("document.querySelector('.catalog-actions').dataset.projectId")) !==
        expected.id
      )
        throw new Error('Restart changed project identity');
      await capture('project-reopened.png');
    }
    writeFileSync(
      join(root, phase + '.json'),
      JSON.stringify({ status: 'PASS_REAL', isolation }, null, 2),
    );
  } catch (error) {
    await capture('project-failure.png');
    throw error;
  }
}
