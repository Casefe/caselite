import { app, type BrowserWindow, session } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
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
  const assertNoRuns = () => {
    const connection = openToolchainProbe(
      join(isolation.userData, 'caselite.sqlite'),
      join(process.resourcesPath, 'migrations'),
    );
    try {
      if (
        (
          connection.sqlite.prepare('SELECT count(*) AS count FROM agent_runs').get() as {
            count: number;
          }
        ).count !== 0 ||
        existsSync(join(root, 'unexpected-runtime.txt'))
      )
        throw new Error('Project viewing dispatched an Agent Run');
    } finally {
      connection.sqlite.close();
    }
  };
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
    const navigationMode = process.env.CASELITE_PROJECT_NAVIGATION;
    if (navigationMode) {
      if (!['write', 'read', 'preview'].includes(navigationMode))
        throw new Error('Invalid navigation mode');
      const original = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const taskId = original.task.id;
      const projectId = original.task.matter_id;
      const readTask = async (): Promise<Extract<TaskResponse, { ok: true }>> => {
        const r: TaskResponse = await evaluate(
          `window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(taskId)}})`,
        );
        if (!r.ok || r.tasks[0]?.id !== taskId || !r.state)
          throw new Error('Navigation task missing');
        return r;
      };
      const before = await readTask();
      if (
        before.tasks[0].document_id !== original.task.document_id ||
        before.tasks[0].body_id !== original.task.body_id ||
        before.tasks[0].matter_id !== projectId
      )
        throw new Error('Navigation changed object identity');
      const projectRead: CatalogResponse = await evaluate(
        `window.caselite.catalog({protocol_version:1,operation:'read_project',id:${JSON.stringify(projectId)}})`,
      );
      if (!projectRead.ok) throw new Error('Navigation project missing');
      const project = projectRead.projects.find((p) => p.id === projectId);
      if (!project) throw new Error('Navigation project substituted');
      if (project.archived_at) await button('已归档');
      await wait("document.querySelector('[aria-label=搜索项目]')");
      if (navigationMode === 'write') {
        await evaluate(
          `(()=>{const input=document.querySelector('[aria-label=搜索项目]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(project.title)});input.dispatchEvent(new Event('input',{bubbles:true}));const order=document.querySelector('[aria-label=项目排序]');order.value='title';order.dispatchEvent(new Event('change',{bubbles:true}));const box=Array.from(document.querySelectorAll('.project-display-menu label')).find(e=>e.textContent==='更新时间').querySelector('input');box.click();})()`,
        );
      }
      await button(project.title);
      await wait("document.querySelector('[aria-label=编辑项目名称]')");
      if (navigationMode === 'write' && project.archived_at)
        throw new Error('Cannot edit archived navigation fixture');
      await evaluate("document.querySelector('#project-tab-tasks').click()");
      await wait("document.querySelector('#project-tab-tasks[aria-selected=true]')");
      if (navigationMode === 'preview') {
        assertNoRuns();
        window.setTitle('CaseLite · DEV-1712 项目往返 · 同一合成工作区');
        await new Promise<void>((resolve) => window.once('closed', () => resolve()));
        assertNoRuns();
        return;
      }
      if (navigationMode === 'read') {
        const saved = JSON.parse(readFileSync(join(root, 'navigation-expected.json'), 'utf8'));
        if (
          JSON.stringify(before.tasks[0]) !== JSON.stringify(saved.task) ||
          createHash('sha256').update(JSON.stringify(before.state)).digest('hex') !==
            saved.bodySha256 ||
          project.id !== saved.project.id ||
          project.body_id !== saved.project.body_id ||
          project.body_revision !== saved.project.body_revision ||
          project.title !== saved.project.title
        )
          throw new Error('Navigation restart lost identity or saved revision');
        await capture('navigation-restarted.png');
        writeFileSync(
          join(root, 'navigation-read.json'),
          JSON.stringify({
            status: 'PASS_REAL',
            task: before.tasks[0],
            project,
            isolation,
            providerDispatches: 0,
          }),
        );
        assertNoRuns();
        return;
      }
      const layouts = [];
      for (const width of [1440, 640]) {
        window.setSize(width, 900);
        await wait(`innerWidth===${width}`);
        for (const theme of ['light', 'dark']) {
          await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
          await new Promise((resolve) => setTimeout(resolve, 300));
          const style = await evaluate(
            `(()=>{const toolbar=document.querySelector('.project-catalog .view-toolbar');const tabs=Array.from(toolbar.querySelectorAll('.view-tabs button'));return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,background:getComputedStyle(toolbar).backgroundColor,tabs:tabs.map(b=>({label:b.textContent,current:b.classList.contains('current'),color:getComputedStyle(b).color,background:getComputedStyle(b).backgroundColor}))};})()`,
          );
          if (style.scrollWidth > style.clientWidth + 1)
            throw new Error('Navigation viewport overflow');
          if (theme === 'dark' && style.background === 'rgb(255, 255, 255)')
            throw new Error('Project toolbar white in dark mode');
          layouts.push({ theme, ...style });
          await capture(`navigation-${width}-${theme}.png`);
        }
      }
      window.setSize(640, 900);
      await wait('innerWidth===640');
      await evaluate("document.documentElement.dataset.theme='light'");
      const sourceScroll = await evaluate(
        "(()=>{const view=document.querySelector('.project-catalog');view.scrollTop=80;return view.scrollTop;})()",
      );
      if (sourceScroll <= 0) throw new Error('Navigation scroll fixture is not scrollable');
      await evaluate(
        `document.querySelector('#project-panel-tasks [data-project-task="${taskId}"]').focus()`,
      );
      window.focus();
      window.webContents.focus();
      const keyboardFocus = {
        window: window.isFocused(),
        renderer: await evaluate(
          '({focused:document.hasFocus(),task:document.activeElement?.dataset.projectTask,disabled:document.activeElement?.disabled})',
        ),
      };
      if (
        !keyboardFocus.window ||
        !keyboardFocus.renderer.focused ||
        keyboardFocus.renderer.task !== taskId ||
        keyboardFocus.renderer.disabled
      )
        throw new Error('Native Enter has no focused enabled Task');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await wait(`document.querySelector('[data-active-task="${taskId}"]')`);
      await wait("document.querySelector('[aria-label=返回来源项目]')");
      await evaluate(
        "(()=>{const body=document.querySelector('[data-testid=body-editor]');body.focus();document.execCommand('insertText',false,' 本次导航保存内容。');})()",
      );
      await wait("!document.querySelector('[data-testid=save-body]').disabled");
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait("document.querySelector('[role=alert]')?.textContent.includes('请先保存')");
      if (!(await evaluate(`Boolean(document.querySelector('[data-active-task="${taskId}"]'))`)))
        throw new Error('Dirty return unmounted task');
      await capture('navigation-dirty-blocked.png');
      await evaluate("document.querySelector('[data-testid=save-body]').click()");
      await wait(
        "document.querySelector('[data-testid=save-status]')?.textContent.includes('已保存到此设备')",
      );
      const saved = await readTask();
      if (saved.tasks[0].body_revision <= before.tasks[0].body_revision)
        throw new Error('Navigation body did not save');
      // 用同一受控入口模拟另一个消费者更新项目，返回必须读回当前版本而不是旧会话副本。
      const updated: CatalogResponse = await evaluate(
        `window.caselite.catalog({protocol_version:1,operation:'update_project',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),id:${JSON.stringify(project.id)},expected_version:${project.version},expected_body_revision:${project.body_revision},title:${JSON.stringify(project.title + ' · 导航已保存')},status:${JSON.stringify(project.status)}})`,
      );
      if (!updated.ok) throw new Error('Navigation project update failed');
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait(
        "document.querySelector('#project-tab-tasks[aria-selected=true]') && document.querySelector('[aria-label=编辑项目名称]')?.value.endsWith('导航已保存')",
      );
      await wait(`document.activeElement?.dataset.projectTask===${JSON.stringify(taskId)}`);
      const returnedScroll = await evaluate("document.querySelector('.project-catalog').scrollTop");
      if (returnedScroll !== sourceScroll)
        throw new Error('Navigation lost native scroll position');
      await capture('navigation-returned-current.png');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      await wait(
        `document.activeElement!==document.body && document.activeElement?.dataset.projectTask!==${JSON.stringify(taskId)}`,
      );
      const tabFocus = await evaluate(
        '({tag:document.activeElement.tagName,label:document.activeElement.textContent,focused:document.hasFocus()})',
      );
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] });
      await wait(`document.activeElement?.dataset.projectTask===${JSON.stringify(taskId)}`);
      window.setSize(1440, 900);
      await wait('innerWidth===1440');
      await button('返回项目列表');
      const preferences = await evaluate(
        "({query:document.querySelector('[aria-label=搜索项目]').value,order:document.querySelector('[aria-label=项目排序]').value,updated:Array.from(document.querySelectorAll('.project-display-menu label')).find(e=>e.textContent==='更新时间').querySelector('input').checked})",
      );
      if (
        preferences.query !== project.title ||
        preferences.order !== 'title' ||
        preferences.updated
      )
        throw new Error('Navigation lost list preferences');
      await evaluate(
        `document.querySelector('.project-properties [data-project-task="${taskId}"]').click()`,
      );
      await wait("document.querySelector('[aria-label=返回来源项目]')");
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait(
        "document.querySelector('[aria-label=项目列表]') && !document.querySelector('[aria-label=编辑项目名称]')",
      );
      await wait(`document.activeElement?.dataset.projectTask===${JSON.stringify(taskId)}`);
      await capture('navigation-returned-list.png');
      // 改名后旧筛选可能隐藏原项目，清除筛选后再打开同一对象。
      await evaluate(
        "(()=>{const input=document.querySelector('[aria-label=搜索项目]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
      );
      const current: CatalogResponse = await evaluate(
        `window.caselite.catalog({protocol_version:1,operation:'read_project',id:${JSON.stringify(projectId)}})`,
      );
      if (!current.ok) throw new Error('Current project unavailable');
      const currentProject = current.projects.find((p) => p.id === projectId)!;
      await button(currentProject.title);
      await wait("document.querySelector('.project-summary')");
      await evaluate(
        `document.querySelector('.project-properties [data-project-task="${taskId}"]').click()`,
      );
      await wait("document.querySelector('[aria-label=返回来源项目]')");
      await evaluate("document.querySelector('[data-nav=settings]').click()");
      await button('返回工作区');
      await wait("document.querySelector('[aria-label=返回来源项目]')");
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait("document.querySelector('#project-tab-overview[aria-selected=true]')");
      await evaluate("document.querySelector('[data-nav=tasks]').click()");
      await wait("document.querySelector('[data-row-task]')");
      await evaluate(
        "document.querySelector('[data-row-task]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
      );
      await wait("document.querySelector('[aria-label=返回任务列表]')");
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait("document.querySelector('[data-row-task]')");
      writeFileSync(
        join(root, 'navigation-expected.json'),
        JSON.stringify(
          {
            task: (await readTask()).tasks[0],
            project: currentProject,
            bodySha256: createHash('sha256').update(JSON.stringify(saved.state)).digest('hex'),
            preferences,
            keyboardFocus,
            tabFocus,
            sourceScroll,
            returnedScroll,
            layouts,
            isolation,
          },
          null,
          2,
        ),
      );
      assertNoRuns();
      writeFileSync(
        join(root, 'navigation-write.json'),
        JSON.stringify({ status: 'PASS_REAL', providerDispatches: 0, isolation }),
      );
      return;
    }
    if (process.env.CASELITE_PROJECT_PROPERTIES) {
      const read = async (id?: string) => {
        const r: CatalogResponse = await evaluate(
          `window.caselite.catalog(${JSON.stringify(id ? { operation: 'read_project', protocol_version: 1, id } : { operation: 'list', protocol_version: 1 })})`,
        );
        if (!r.ok) throw new Error('Cannot read project properties');
        return r;
      };
      const input = async (label: string, value: string, select = false) => {
        await evaluate(
          `(()=>{const e=document.querySelector('[aria-label="${label}"]');if(!e || e.disabled) throw new Error('Field unavailable');Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));})()`,
        );
      };
      const expectedPath = join(root, 'properties-expected.json');
      if (phase === 'project-write' && process.env.CASELITE_PROJECT_PROPERTIES !== 'preview') {
        await button('创建项目');
        await wait("document.querySelector('dialog[open] [aria-label=项目名称]')");
        await input('项目名称', '合成项目属性验收');
        await input('项目负责人', '合成负责人');
        await input('项目优先级', '2', true);
        await input('项目开始日', '2024-02-29');
        await input('项目目标日', '2024-03-01');
        await input('项目标签', '验收,合成');
        await input('项目类型', 'litigation', true);
        await input('项目状态', 'active', true);
        if (
          (await evaluate("document.querySelector('[aria-label=项目负责人]').value")) !==
          '合成负责人'
        )
          throw new Error('Type selection replaced manual values');
        await input('项目目标日', '2024-02-28');
        if (
          !(await evaluate(
            "Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='保存项目').disabled",
          ))
        )
          throw new Error('Reversed dates remained savable');
        await input('项目目标日', '2024-03-01');
        const layouts = [];
        for (const width of [1440, 640]) {
          window.setSize(width, 900);
          await wait(`innerWidth===${width}`);
          for (const theme of ['light', 'dark']) {
            await evaluate(`document.documentElement.dataset.theme='${theme}'`);
            const geometry = await evaluate(
              '({width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})',
            );
            if (geometry.scroll > geometry.client + 1) throw new Error('Creation overflow');
            await capture(`properties-create-${width}-${theme}.png`);
            layouts.push({ theme, ...geometry });
          }
        }
        window.setSize(1440, 1000);
        await evaluate("document.documentElement.dataset.theme='light'");
        await button('保存项目');
        await wait(
          "document.querySelector('[aria-label=编辑项目名称]') && !document.querySelector('dialog[open]')",
        );
        let current = (await read()).projects[0];
        if (
          current.attributes?.project_type !== 'litigation' ||
          current.attributes.priority !== 2 ||
          current.status !== 'active'
        )
          throw new Error('Creation dropped selected attributes');
        await evaluate(
          "(()=>{const e=document.querySelector('[data-testid=project-overview-editor]');e.focus();document.execCommand('insertText',false,'合成项目说明，属性编辑后必须保持原修订。');})()",
        );
        await button('保存项目概述');
        await wait(
          "Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent.includes('说明修订 1'))",
        );
        current = (await read(current.id)).projects[0];
        const original = await read(current.id);
        if (!original.state || current.body_revision !== 1)
          throw new Error('Description not saved');
        await button('任务');
        await input('项目负责人', '合成右栏负责人');
        await input('项目优先级', '4', true);
        window.show();
        window.focus();
        await evaluate(
          "(()=>{const e=document.querySelector('[aria-label=项目开始日]');e.scrollIntoView({block:'center'});e.addEventListener('input',()=>{if(e.validity.badInput)e.dataset.observedBadInput='true';},true);e.focus();})()",
        );
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
        await wait(
          "document.querySelector('[aria-label=项目开始日]').dataset.observedBadInput==='true'",
        );
        if (
          !(await evaluate(
            "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存项目属性').disabled",
          ))
        )
          throw new Error('Native incomplete date remained savable');
        await input('项目开始日', '2024-02-29');
        await wait(
          "!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存项目属性').disabled",
        );
        writeFileSync(
          join(root, 'properties-native-date.json'),
          JSON.stringify({
            status: 'PASS_REAL',
            badInputBlocked: true,
            sameCanonicalInputRecovered: true,
          }),
        );
        await input('项目开始日', '');
        await input('项目目标日', '');
        const connection = openToolchainProbe(
          join(isolation.userData, 'caselite.sqlite'),
          join(process.resourcesPath, 'migrations'),
        );
        connection.sqlite.exec(
          "CREATE TRIGGER reject_properties BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic properties failure'); END",
        );
        try {
          await button('保存项目属性');
          await wait(
            "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原提交')",
          );
          const failed = await read(current.id);
          if (JSON.stringify(failed.projects[0]) !== JSON.stringify(current))
            throw new Error('Failed attribute save partially committed');
          await capture('properties-save-failed.png');
        } finally {
          connection.sqlite.exec('DROP TRIGGER reject_properties');
          connection.sqlite.close();
        }
        await button('核对原提交');
        await wait(
          "!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原提交') && !document.querySelector('[aria-label=项目负责人]').disabled",
        );
        const saved = await read(current.id);
        if (
          saved.projects[0].body_revision !== 1 ||
          JSON.stringify(saved.state) !== JSON.stringify(original.state) ||
          saved.projects[0].attributes?.assignee !== '合成右栏负责人'
        )
          throw new Error('Attribute save changed original body');
        await button('返回项目列表');
        await wait("document.querySelector('[aria-label=侧栏项目名称]')");
        await input('项目标签', '列表侧栏,合成');
        if (!(await evaluate("document.querySelector('[aria-label=搜索项目]').disabled")))
          throw new Error('Filtering can discard property draft');
        await button('保存项目属性');
        await wait("!document.querySelector('[aria-label=搜索项目]').disabled");
        if (await evaluate("Boolean(document.querySelector('.project-detail-heading'))"))
          throw new Error('List property save opened detail');
        await button('打开项目');
        await wait("document.querySelector('[aria-label=编辑项目名称]')");
        for (const width of [1440, 640]) {
          window.setSize(width, 1000);
          await wait(`innerWidth===${width}`);
          for (const theme of ['light', 'dark']) {
            await evaluate(`document.documentElement.dataset.theme='${theme}'`);
            if (
              await evaluate(
                'document.documentElement.scrollWidth>document.documentElement.clientWidth+1',
              )
            )
              throw new Error('Properties overflow');
            await evaluate(
              "(()=>{const panel=document.querySelector('.project-properties');panel.scrollIntoView({block:'start'});panel.scrollTop=0;})()",
            );
            await capture(`properties-sidebar-${width}-${theme}.png`);
            await evaluate(
              "Array.from(document.querySelectorAll('.project-properties button')).find(e=>e.textContent.trim()==='保存项目属性').scrollIntoView({block:'center'})",
            );
            const layout = await evaluate(
              "(()=>{const label=document.querySelector('.project-properties .project-fields label');const style=getComputedStyle(label);return {display:style.display,columns:style.gridTemplateColumns};})()",
            );
            if (layout.display !== 'grid' || !layout.columns.startsWith('72px'))
              throw new Error('Sidebar is not a compact attribute grid: ' + JSON.stringify(layout));
            const reachable = await evaluate(
              "(()=>{const e=document.querySelector('[aria-label=项目标签]');const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,viewportHeight:innerHeight};})()",
            );
            if (
              reachable.height <= 0 ||
              reachable.top < 0 ||
              reachable.bottom > reachable.viewportHeight ||
              reachable.left < 0 ||
              reachable.right > width + 1
            )
              throw new Error('Sidebar field cannot be reached: ' + JSON.stringify(reachable));
            await capture(`properties-save-${width}-${theme}.png`);
          }
        }
        const final = await read(current.id);
        writeFileSync(
          expectedPath,
          JSON.stringify(
            {
              project: final.projects[0],
              state: final.state,
              layouts,
              isolation,
              providerDispatches: 0,
            },
            null,
            2,
          ),
        );
        writeFileSync(
          join(root, 'properties-write.json'),
          JSON.stringify({ status: 'PASS_REAL', providerDispatches: 0, isolation }),
        );
      } else {
        const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
        const current = await read(expected.project.id);
        const project = current.projects.find((p) => p.id === expected.project.id);
        if (!project) throw new Error('Saved project missing');
        if (
          process.env.CASELITE_PROJECT_PROPERTIES !== 'preview' &&
          (JSON.stringify(project) !== JSON.stringify(expected.project) ||
            JSON.stringify(current.state) !== JSON.stringify(expected.state))
        )
          throw new Error('Restart lost attributes or body');
        if (project.archived_at) await button('已归档');
        await button(project.title);
        await wait("document.querySelector('[aria-label=编辑项目名称]')");
        await capture('properties-reopened.png');
        if (process.env.CASELITE_PROJECT_PROPERTIES === 'preview') {
          window.setTitle('CaseLite · 项目属性 · 同一合成工作区');
          await new Promise<void>((resolve) => window.once('closed', () => resolve()));
        } else
          writeFileSync(
            join(root, 'properties-read.json'),
            JSON.stringify({
              status: 'PASS_REAL',
              projectId: project.id,
              providerDispatches: 0,
              isolation,
            }),
          );
      }
      assertNoRuns();
      return;
    }
    const previewMode = process.env.CASELITE_PROJECT_SUMMARY_PREVIEW;
    if (previewMode) {
      // 人工验收复开只读取同一隔离工作区，不能重造样本或按旧快照覆写用户修改。
      const expected = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const catalog: CatalogResponse = await evaluate(
        "window.caselite.catalog({protocol_version:1,operation:'list'})",
      );
      if (!catalog.ok) throw new Error('Cannot reopen isolated project');
      const project = catalog.projects.find((p) => p.id === expected.task.matter_id);
      if (!project) throw new Error('Original isolated project missing');
      if (project.archived_at) await button('已归档');
      await button(project.title);
      await wait(
        "document.querySelector('.project-summary') && document.querySelector('[aria-label=编辑项目名称]')",
      );
      if (previewMode === 'write') {
        if (project.archived_at) throw new Error('Cannot edit archived preview project');
        const title = project.title + ' · 已保存复开验收';
        await evaluate(
          `(()=>{const input=document.querySelector('[aria-label=编辑项目名称]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(title)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await button('保存项目概述');
        await wait(
          `document.querySelector('[aria-label=编辑项目名称]')?.value===${JSON.stringify(title)} && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='保存项目概述'&&b.disabled) && !document.querySelector('[aria-label=编辑项目名称]').disabled`,
        );
        writeFileSync(
          join(root, 'summary-preview-saved.json'),
          JSON.stringify({ id: project.id, title }),
        );
        await capture('project-summary-preview-saved.png');
        assertNoRuns();
        return;
      }
      if (previewMode === 'read') {
        const saved = JSON.parse(readFileSync(join(root, 'summary-preview-saved.json'), 'utf8'));
        if (saved.id !== project.id || saved.title !== project.title)
          throw new Error('Reopen changed saved project');
        await wait(
          `document.querySelector('[aria-label=编辑项目名称]')?.value===${JSON.stringify(saved.title)}`,
        );
        await capture('project-summary-preview-reopened.png');
        assertNoRuns();
        writeFileSync(
          join(root, 'summary-preview-result.json'),
          JSON.stringify({
            status: 'PASS_REAL',
            projectId: project.id,
            title: project.title,
            isolation,
            providerDispatches: 0,
          }),
        );
        return;
      }
      assertNoRuns();
      window.setTitle('CaseLite · 同一合成工作区 · 零模型派发');
      await new Promise<void>((resolve) => window.once('closed', () => resolve()));
      assertNoRuns();
      return;
    }
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
        await wait(
          "Array.from(document.querySelectorAll('.project-summary [data-activity-id] strong')).some(e=>e.textContent==='保存项目概述')",
        );
        writeFileSync(join(root, 'activity-expected.json'), JSON.stringify(after, null, 2));
      } else {
        const prior = JSON.parse(readFileSync(join(root, 'activity-expected.json'), 'utf8'));
        if (JSON.stringify(before) !== JSON.stringify(prior))
          throw new Error('Restart changed committed history');
      }
      if (phase === 'project-activity-read') {
        const expectedFiles = JSON.parse(
          readFileSync(join(root, 'files-expected.json'), 'utf8'),
        ) as { id: string; asset_version_id: string }[];
        await wait(
          "document.querySelectorAll('.project-summary [data-source-id]').length===2 && document.querySelectorAll('.project-summary [data-activity-id]').length===3",
        );
        const visibleIds = await evaluate(
          "Array.from(document.querySelectorAll('.project-summary [data-source-id]')).map(e=>e.dataset.sourceId)",
        );
        if (
          JSON.stringify(visibleIds) !==
          JSON.stringify(
            expectedFiles
              .slice(-3)
              .reverse()
              .map((m) => m.id),
          )
        )
          throw new Error('Summary changed registration order or source scope');
        if (
          (await evaluate(
            "Array.from(document.querySelectorAll('.project-summary-counts dd')).map(e=>e.textContent.trim()).join(',')",
          )) !== '1,0,1'
        )
          throw new Error('Summary invented task or delivery counts');
        const layouts = [];
        for (const width of [1440, 1024, 768, 640]) {
          window.setSize(width, 900);
          await wait(`innerWidth===${width}`);
          for (const theme of ['light', 'dark']) {
            await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
            const geometry = await evaluate(
              `(()=>{const scroller=document.querySelector('.collection-scroll');scroller.scrollTop=0;return {width:innerWidth, scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth, scrollHeight:scroller.scrollHeight, clientHeight:scroller.clientHeight};})()`,
            );
            if (geometry.scrollWidth > geometry.clientWidth + 1)
              throw new Error('Summary causes horizontal viewport overflow');
            await capture(`project-summary-${width}-${theme}.png`);
            layouts.push({ theme, ...geometry });
          }
        }
        window.setSize(1440, 1000);
        await evaluate("document.documentElement.dataset.theme='light'");
        const file = expectedFiles.at(-1)!;
        const original = join(
          isolation.userData,
          'materials',
          'originals',
          file.asset_version_id + '.pdf',
        );
        renameSync(original, original + '.summary-hold');
        try {
          await evaluate(
            `document.querySelector('.project-summary [data-source-id="${file.id}"] button').click()`,
          );
          await wait("document.querySelector('.project-summary .project-files [role=alert]')");
          if (await evaluate("Boolean(document.querySelector('.material-paper canvas'))"))
            throw new Error('Missing summary source opened another PDF');
          await capture('project-summary-source-missing.png');
        } finally {
          renameSync(original + '.summary-hold', original);
        }
        await button('重试读取');
        await wait("document.querySelector('.material-paper canvas')?.width>0");
        for (const width of [640, 1440]) {
          window.setSize(width, 1000);
          await wait(`innerWidth===${width}`);
          await evaluate(
            "document.querySelector('.material-reader').scrollIntoView({block:'center'})",
          );
          const reachable = await evaluate(
            `(()=>{const reader=document.querySelector('.material-reader').getBoundingClientRect();return Array.from(document.querySelectorAll('.material-reader header button')).every(b=>{const r=b.getBoundingClientRect();return r.left>=reader.left && r.right<=reader.right+1 && r.right<=innerWidth+1;});})()`,
          );
          if (!reachable) throw new Error('Summary PDF toolbar clipped at ' + width);
          await capture(`project-summary-source-opened-${width}.png`);
        }
        // 阅读器关闭后仍留在原概述，随后只用受控activity_target返回任务。
        await button('收起阅读');
        const taskEvent = before.find((e) => e.target_type === 'task')!;
        if (!taskEvent) throw new Error('No real task event');
        const visibleTaskEvent = await evaluate(
          "Array.from(document.querySelectorAll('.project-summary [data-activity-id]')).find(e=>e.querySelector('button').textContent.includes('任务'))?.dataset.activityId",
        );
        if (!visibleTaskEvent) throw new Error('Summary task event unavailable');
        await evaluate(
          `document.querySelector('.project-summary [data-activity-id="${visibleTaskEvent}"] button').click()`,
        );
        await wait(
          `document.querySelector('[data-active-task]')?.dataset.activeTask===${JSON.stringify(expected.task.id)}`,
        );
        await capture('project-summary-activity-task.png');
        await evaluate("document.querySelector('[data-nav=projects]').click()");
        await button('独立任务转项目验收');
        await wait("document.querySelector('.project-summary [data-activity-id]')");
        await button('移出项目');
        await wait(
          "document.querySelector('.project-summary-counts dd')?.textContent==='0' && document.querySelector('.project-summary .project-files')?.textContent.includes('项目还没有已登记材料')",
        );
        await evaluate(
          `(()=>{const select=document.querySelector('[aria-label=归入已有任务]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(expected.task.id)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await button('归入项目');
        await wait(
          "document.querySelector('.project-summary-counts dd')?.textContent==='1' && document.querySelectorAll('.project-summary [data-source-id]').length===2",
        );
        writeFileSync(join(root, 'activity-expected.json'), JSON.stringify(await list(), null, 2));
        await capture('project-summary-membership-refreshed.png');
        const projectEvent = await evaluate(
          "Array.from(document.querySelectorAll('.project-summary [data-activity-id]')).find(e=>e.querySelector('button').textContent.includes('项目'))?.dataset.activityId",
        );
        if (!projectEvent) throw new Error('Summary project event unavailable');
        await evaluate(
          `document.querySelector('.project-summary [data-activity-id="${projectEvent}"] button').click()`,
        );
        await wait(
          "document.querySelector('.project-summary [data-activity-id]') && !document.querySelector('[aria-label=编辑项目名称]').disabled",
        );
        if (
          (await evaluate("document.querySelector('.catalog-actions').dataset.projectId")) !==
          expected.task.matter_id
        )
          throw new Error('Activity changed original project');
        await evaluate(
          "document.querySelector('.project-summary-records > section button').focus()",
        );
        await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        await window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        if (
          !(await evaluate(
            "Boolean(document.querySelector('.project-summary').contains(document.activeElement))",
          ))
        )
          throw new Error('Summary keyboard focus escaped');
        await evaluate("document.querySelector('.collection-scroll').scrollTop=100000");
        await capture('project-summary-description-scroll.png');
        writeFileSync(
          join(root, 'summary-expected.json'),
          JSON.stringify(
            {
              projectId: expected.task.matter_id,
              taskId: expected.task.id,
              files: expectedFiles,
              activities: before,
              layouts,
            },
            null,
            2,
          ),
        );
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
          "Array.from(document.querySelectorAll('.project-summary-counts dd')).map(e=>e.textContent).join(',')==='1,0,1'",
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
    assertNoRuns();
    writeFileSync(
      join(root, phase + '.json'),
      JSON.stringify({ status: 'PASS_REAL', isolation }, null, 2),
    );
  } catch (error) {
    await capture('project-failure.png');
    throw error;
  }
}
