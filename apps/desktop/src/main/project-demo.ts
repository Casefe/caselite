import { app, type BrowserWindow, session } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { CatalogResponse } from '@caselite/contracts';

// 沿用宿主校验过的合成目录和正式IPC；只测项目，不改全工作台演示的既有断言。
export async function runProjectDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: 'project-write' | 'project-read' | 'project-edit' | 'project-restore',
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
  const button = async (text: string) => {
    await wait(
      `Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`,
    );
    return evaluate(`(()=>{
    const button=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)});
    if(!button||button.disabled) throw new Error('Project button unavailable');
    button.click();
  })()`);
  };
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
      const restored = phase === 'project-restore';
      const title = restored ? '验收项目（已编辑）' : '项目创建与重启验收';
      if (restored) await button('已归档');
      await wait("document.querySelector('.project-title-link')");
      await button(title);
      await wait(
        `document.querySelector('[aria-label=编辑项目名称]')?.value===${JSON.stringify(title)}`,
      );
      if (
        (await evaluate("document.querySelector('.catalog-actions').dataset.projectId")) !==
        expected.id
      )
        throw new Error('Restart changed project identity');
      await capture('project-reopened.png');
      if (phase === 'project-edit') {
        await evaluate(`(()=>{
          const input=document.querySelector('[aria-label=编辑项目名称]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'验收项目（已编辑）');
          input.dispatchEvent(new Event('input',{bubbles:true}));
          const status=document.querySelector('[aria-label=项目状态]');
          status.value='active'; status.dispatchEvent(new Event('change',{bubbles:true}));
          const body=document.querySelector('[data-testid=project-overview-editor]');
          body.focus(); document.execCommand('insertText',false,'项目概述：保存与归档恢复验收。');
        })()`);
        await button('保存项目概述');
        await wait(
          "Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent.includes('已保存 · 说明修订 1'))",
        );
        const saved: CatalogResponse = await evaluate(
          `window.caselite.catalog({operation:'read_project',protocol_version:1,id:${JSON.stringify(expected.id)}})`,
        );
        if (!saved.ok || !saved.state) throw new Error('Saved project body is missing');
        expected.savedBody = {
          id: saved.projects[0].body_id,
          revision: saved.projects[0].body_revision,
          sha256: createHash('sha256').update(Uint8Array.from(saved.state)).digest('hex'),
        };
        writeFileSync(join(root, 'project-expected.json'), JSON.stringify(expected, null, 2));
        await capture('project-edited.png');
        await button('归档项目');
        await wait("!document.querySelector('[data-project-id]')");
        await button('已归档');
        await wait("document.querySelector('.project-title-link')");
        await button('验收项目（已编辑）');
        await wait("document.querySelector('[aria-label=编辑项目名称]')?.disabled");
        const archived: CatalogResponse = await evaluate(
          "window.caselite.catalog({operation:'list',protocol_version:1})",
        );
        if (!archived.ok || !archived.projects[0].archived_at)
          throw new Error('Archive was not persisted');
        if (
          !(await evaluate(
            "document.querySelector('[aria-label=项目状态]').disabled && !document.querySelector('[data-testid=project-overview-editor]').isContentEditable",
          ))
        )
          throw new Error('Archived project remains writable');
        await capture('project-archived.png');
      }
      if (restored) {
        await wait("document.querySelector('[aria-label=编辑项目名称]')?.disabled");
        await button('恢复项目');
        await wait("!document.querySelector('[data-project-id]')");
        await button('全部项目');
        await wait("document.querySelector('.project-title-link')");
        await button(title);
        await wait(
          "document.querySelector('[aria-label=编辑项目名称]') && !document.querySelector('[aria-label=编辑项目名称]').disabled",
        );
        const result: CatalogResponse = await evaluate(
          "window.caselite.catalog({operation:'list',protocol_version:1})",
        );
        if (
          !result.ok ||
          result.projects.length !== 1 ||
          result.projects[0].id !== expected.id ||
          result.projects[0].status !== 'active' ||
          result.projects[0].body_revision !== 1 ||
          result.projects[0].archived_at !== null
        )
          throw new Error('Project restore changed saved identity or properties');
        const body: CatalogResponse = await evaluate(
          `window.caselite.catalog({operation:'read_project',protocol_version:1,id:${JSON.stringify(expected.id)}})`,
        );
        if (
          !body.ok ||
          !body.state ||
          body.projects[0].body_id !== expected.savedBody.id ||
          body.projects[0].body_revision !== expected.savedBody.revision ||
          createHash('sha256').update(Uint8Array.from(body.state)).digest('hex') !==
            expected.savedBody.sha256
        )
          throw new Error('Project restore changed authoritative body bytes');
        if (
          !(await evaluate(
            "document.querySelector('[data-testid=project-overview-editor]').textContent.includes('项目概述：保存与归档恢复验收。')",
          ))
        )
          throw new Error('Project restore lost its saved overview');
        await capture('project-restored.png');
      }
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
