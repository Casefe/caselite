import { app, type BrowserWindow, session } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { CatalogResponse, TaskResponse, MaterialResponse } from '@caselite/contracts';
import { openToolchainProbe } from '@caselite/local-db';

// 沿用宿主校验过的合成目录和正式IPC；只测项目，不改全工作台演示的既有断言。
export async function runProjectDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase:
    | 'project-write'
    | 'project-read'
    | 'project-edit'
    | 'project-restore'
    | 'project-promote'
    | 'project-files'
    | 'project-files-read'
    | 'project-activity'
    | 'project-activity-read'
    | 'project-promote-read',
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
    if (phase === 'project-activity' || phase === 'project-activity-read') {
      const expected = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const scope = { type: 'project', id: expected.task.matter_id };
      const list = async () => {
        const r: CatalogResponse = await evaluate(
          `window.caselite.catalog(${JSON.stringify({ protocol_version: 1, operation: 'list_activity', scope, offset: 0 })})`,
        );
        if (!r.ok || !r.activity) throw new Error('Committed activity query unavailable');
        return r.activity;
      };
      await wait("document.querySelector('.project-title-link')");
      await button('独立任务转项目验收');
      await wait("document.querySelector('[aria-label=编辑项目名称]')");
      const before = await list();
      if (phase === 'project-activity') {
        const connection = openToolchainProbe(
          join(isolation.userData, 'caselite.sqlite'),
          join(process.resourcesPath, 'migrations'),
        );
        connection.sqlite.exec(
          "CREATE TRIGGER project_probe_reject BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic activity commit failure'); END",
        );
        try {
          await evaluate(
            "(()=>{const input=document.querySelector('[aria-label=项目状态]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,'active');input.dispatchEvent(new Event('change',{bubbles:true}));})()",
          );
          await button('保存项目概述');
          await wait(
            "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原提交')",
          );
          if (JSON.stringify(await list()) !== JSON.stringify(before))
            throw new Error('Failed save created success activity');
          await capture('project-activity-save-failed.png');
        } finally {
          connection.sqlite.exec('DROP TRIGGER project_probe_reject');
          connection.sqlite.close();
        }
        await button('核对原提交');
        await wait(
          "!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原提交') && document.querySelector('[aria-label=项目状态]')?.value==='active'",
        );
        const after = await list();
        if (
          after.length !== before.length + 1 ||
          after.filter((e) => e.operation === 'update_project').length !== 1
        )
          throw new Error('Recovery duplicated or lost committed activity');
        writeFileSync(join(root, 'activity-expected.json'), JSON.stringify(after, null, 2));
      } else {
        const prior = JSON.parse(readFileSync(join(root, 'activity-expected.json'), 'utf8'));
        if (JSON.stringify(before) !== JSON.stringify(prior))
          throw new Error('Restart changed committed history');
      }
      await button('活动');
      await wait("document.querySelectorAll('[data-activity-id]').length>=3");
      await capture(
        phase === 'project-activity'
          ? 'project-activity-saved.png'
          : 'project-activity-reopened.png',
      );
      const taskEvent = (await list()).find((e) => e.target_type === 'task')!;
      await evaluate(
        `document.querySelector('[data-activity-id="${taskEvent.id}"] button').click()`,
      );
      await wait(
        `document.querySelector('[data-active-task]')?.dataset.activeTask===${JSON.stringify(expected.task.id)}`,
      );
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.textContent.includes('原任务正文与引用保全样本。')",
      );
      await evaluate("document.querySelector('.task-inspector details').open=true");
      await wait("document.querySelector('.task-inspector [data-activity-id]')");
      await capture('project-activity-original-task.png');
    } else if (phase === 'project-files' || phase === 'project-files-read') {
      const expected = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const projectId = expected.task.matter_id;
      const request = { protocol_version: 1, operation: 'list_project', project_id: projectId };
      const listFiles = async () => {
        const result: MaterialResponse = await evaluate(
          `window.caselite.material(${JSON.stringify(request)})`,
        );
        if (!result.ok) throw new Error(result.message);
        return result.materials;
      };
      if (phase === 'project-files') {
        await evaluate("document.querySelector('[data-nav=tasks]').click()");
        await wait(`document.querySelector('[data-row-task="${expected.task.id}"]')`);
        await evaluate(`document.querySelector('[data-row-task="${expected.task.id}"]').click()`);
        await button('AI 助手');
        await wait("document.querySelector('.material-composer')");
        window.webContents.debugger.attach('1.3');
        for (let index = 0; index < 2; index++) {
          await evaluate(
            "(()=>{document.querySelector('#project-file-input')?.remove();const input=document.createElement('input');input.type='file';input.id='project-file-input';input.hidden=true;document.body.append(input);})()",
          );
          const doc = await window.webContents.debugger.sendCommand('DOM.getDocument');
          const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: '#project-file-input',
          });
          await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
            nodeId,
            files: [join(root, 'fixture.pdf')],
          });
          await evaluate(
            "(()=>{const data=new DataTransfer();data.items.add(document.querySelector('#project-file-input').files[0]);document.querySelector('.material-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()",
          );
          await wait(
            `document.querySelectorAll('.material-chips > *').length>=${index + 1} || document.body.textContent.includes('fixture.pdf')`,
          );
          for (let i = 0; i < 100; i++) {
            if (
              (await listFiles()).length === index + 1 &&
              !(await evaluate("Boolean(document.querySelector('.material-staged'))"))
            )
              break;
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        window.webContents.debugger.detach();
        const files = await listFiles();
        if (files.length !== 2 || files[0].id === files[1].id)
          throw new Error('Same-name sources not independently saved');
        writeFileSync(join(root, 'files-expected.json'), JSON.stringify(files, null, 2));
        await evaluate("document.querySelector('[data-nav=projects]').click()");
      }
      await wait("document.querySelector('.project-title-link')");
      await button('独立任务转项目验收');
      await wait("document.querySelector('[aria-label=编辑项目名称]')");
      await button('文件');
      await wait("document.querySelectorAll('[data-source-id]').length===2");
      const files = await listFiles();
      const prior = JSON.parse(readFileSync(join(root, 'files-expected.json'), 'utf8'));
      if (
        JSON.stringify(files.map((m) => [m.id, m.asset_version_id, m.sha256])) !==
        JSON.stringify(
          prior.map((m: { id: string; asset_version_id: string; sha256: string }) => [
            m.id,
            m.asset_version_id,
            m.sha256,
          ]),
        )
      )
        throw new Error('Restart changed fixed material identity');
      await capture('project-files-list.png');
      const file = files[1];
      if (phase === 'project-files') {
        const path = join(
          isolation.userData,
          'materials',
          'originals',
          file.asset_version_id + '.pdf',
        );
        renameSync(path, path + '.probe-hold');
        try {
          await evaluate(`document.querySelector('[data-source-id="${file.id}"] button').click()`);
          await wait("document.querySelector('.project-files [role=alert]')");
          await capture('project-files-missing.png');
          if ((await listFiles()).length !== 2)
            throw new Error('Read failure erased persisted source');
        } finally {
          renameSync(path + '.probe-hold', path);
        }
        await button('重试读取');
      } else
        await evaluate(`document.querySelector('[data-source-id="${file.id}"] button').click()`);
      await wait("document.querySelector('.material-paper canvas')?.width>0");
      await wait(
        "document.querySelector('.material-paper .react-pdf__Page__textContent')?.textContent.length>0",
      );
      await evaluate(
        "document.querySelector('.material-paper canvas').scrollIntoView({block:'center'})",
      );
      await capture(
        phase === 'project-files' ? 'project-files-recovered.png' : 'project-files-reopened.png',
      );
      writeFileSync(
        join(root, phase + '.json'),
        JSON.stringify(
          {
            status: 'PASS_REAL',
            files: files.map((m) => ({ id: m.id, asset: m.asset_version_id, sha256: m.sha256 })),
            missingReadRecovery: phase === 'project-files',
            isolation,
          },
          null,
          2,
        ),
      );
    } else if (phase === 'project-promote' || phase === 'project-promote-read') {
      if (phase === 'project-promote') {
        await evaluate("document.querySelector('[data-nav=tasks]').click()");
        await wait("document.querySelector('[data-testid=new-task]')");
        await evaluate("document.querySelector('[data-testid=new-task]').click()");
        await wait("document.querySelector('[data-testid=task-title]')");
        await evaluate(`(()=>{
          const input=document.querySelector('[data-testid=task-title]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'独立任务转项目验收');
          input.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
        await evaluate("document.querySelector('[data-testid=create-task]').click()");
        await wait("document.querySelector('[data-testid=body-editor]')");
        await evaluate(
          "(()=>{const body=document.querySelector('[data-testid=body-editor]');body.focus();document.execCommand('insertText',false,'原任务正文与引用保全样本。');})()",
        );
        await wait("!document.querySelector('[data-testid=save-body]').disabled");
        if (
          !(await evaluate(
            "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='从任务创建项目')?.disabled",
          ))
        )
          throw new Error('Unsaved Task can be promoted while editing');
        await evaluate("document.querySelector('[data-testid=save-body]').click()");
        await wait(
          "document.querySelector('[data-testid=save-status]')?.textContent.includes('已保存到此设备')",
        );
        const original: TaskResponse = await evaluate(
          "window.caselite.task({operation:'list',protocol_version:1})",
        );
        if (!original.ok || original.tasks.length !== 1)
          throw new Error('Original Task fixture missing');
        const before: TaskResponse = await evaluate(
          `window.caselite.task({operation:'read',protocol_version:1,task_id:${JSON.stringify(original.tasks[0].id)}})`,
        );
        if (!before.ok) throw new Error('Original Task read failed');
        await button('从任务创建项目');
        await wait("document.querySelector('dialog[open]')");
        await capture('project-from-task.png');
        await button('保存项目');
        await wait("!document.querySelector('dialog[open]')");
        await wait(
          "!Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='从任务创建项目')",
        );
        await wait(
          "Array.from(document.querySelectorAll('.task-inspector dd')).some(e=>e.textContent==='独立任务转项目验收')",
        );
        const after: TaskResponse = await evaluate(
          `window.caselite.task({operation:'read',protocol_version:1,task_id:${JSON.stringify(original.tasks[0].id)}})`,
        );
        if (
          !after.ok ||
          after.tasks[0].id !== before.tasks[0].id ||
          after.tasks[0].document_id !== before.tasks[0].document_id ||
          after.tasks[0].body_id !== before.tasks[0].body_id ||
          !after.tasks[0].matter_id ||
          JSON.stringify(after.state) !== JSON.stringify(before.state)
        )
          throw new Error('Promotion changed original Task identity or body');
        writeFileSync(
          join(root, 'promotion-expected.json'),
          JSON.stringify(
            {
              task: after.tasks[0],
              bodySha256: createHash('sha256').update(JSON.stringify(after.state)).digest('hex'),
            },
            null,
            2,
          ),
        );
        await capture('project-task-linked.png');
      } else {
        const expected = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
        const result: TaskResponse = await evaluate(
          `window.caselite.task({operation:'read',protocol_version:1,task_id:${JSON.stringify(expected.task.id)}})`,
        );
        if (
          !result.ok ||
          result.tasks[0].matter_id !== expected.task.matter_id ||
          result.tasks[0].document_id !== expected.task.document_id ||
          result.tasks[0].body_id !== expected.task.body_id ||
          createHash('sha256').update(JSON.stringify(result.state)).digest('hex') !==
            expected.bodySha256
        )
          throw new Error('Promotion restart lost original identity or body');
        await wait("document.querySelector('.project-title-link')");
        await button('独立任务转项目验收');
        await wait("document.querySelector('[aria-label=编辑项目名称]')");
        await wait(
          "Array.from(document.querySelectorAll('.project-summary-counts dd')).map(e=>e.textContent).join(',')==='1,1'",
        );
        await capture('project-overview-summary.png');
        for (const [label, id] of [
          ['任务', 'tasks'],
          ['文件', 'files'],
          ['交付物', 'deliverables'],
          ['活动', 'activity'],
        ]) {
          await button(label);
          await wait(`document.querySelector('#project-panel-${id}')?.hidden===false`);
          if (
            (await evaluate("document.querySelector('.catalog-actions').dataset.projectId")) !==
            expected.task.matter_id
          )
            throw new Error('Project section switch changed identity');
        }
        await capture('project-sections.png');
        await button('概述');
        await wait("document.querySelector('#project-panel-overview')?.hidden===false");
        await evaluate(
          "document.querySelector('.project-summary-records > section:nth-child(2) button').click()",
        );
        await wait(
          `document.querySelector('[data-active-task]')?.dataset.activeTask===${JSON.stringify(expected.task.id)}`,
        );
        await wait(
          "document.querySelector('[data-testid=body-editor]')?.textContent.includes('原任务正文与引用保全样本。')",
        );
        await capture('project-original-task-reopened.png');
      }
    } else if (phase === 'project-write') {
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
      const originalBounds = window.getBounds();
      const layouts = [];
      for (const width of [640, 1440]) {
        window.setContentSize(width, 900);
        await wait(`window.innerWidth===${width}`);
        await evaluate("document.querySelector('.project-display-menu').open=true");
        const layout = await evaluate(`(()=>{
          const menu=document.querySelector('.project-display-menu > div').getBoundingClientRect();
          const center=document.querySelector('.collection-main').getBoundingClientRect();
          return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,
            menu:{left:menu.left,right:menu.right,bottom:menu.bottom},
            center:{left:center.left,right:center.right}};
        })()`);
        layouts.push(layout);
        writeFileSync(join(root, 'project-list-layout.json'), JSON.stringify(layouts, null, 2));
        await capture(`project-list-${width}.png`);
        if (
          layout.pageWidth > width ||
          layout.menu.left < layout.center.left ||
          layout.menu.right > Math.min(width, layout.center.right) ||
          layout.menu.bottom > 900
        )
          throw new Error('Project list or display menu overflows its viewport');
        await evaluate("document.querySelector('.project-display-menu').open=false");
      }
      window.setBounds(originalBounds);
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
