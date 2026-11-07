import { app, type BrowserWindow, session } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { CatalogResponse, TaskResponse, MaterialResponse } from '@caselite/contracts';
import { openToolchainProbe } from '@caselite/local-db';

// 沿用宿主校验过的合成目录和正式IPC；只测项目，不改全工作台演示的既有断言。
export async function runProjectDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase:
    | 'project-write'
    | 'project-agent-write'
    | 'project-agent-read'
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
  const showTaskResult = async () => {
    await wait("document.querySelector('[data-testid=task-result-tab]')");
    await evaluate("document.querySelector('[data-testid=task-result-tab]').click()");
  };

  const capture = async (name: string) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(join(root, name), (await window.webContents.capturePage()).toPNG());
  };
  const captureRenderer = async (name: string) => {
    // 隐藏窗口缩放或关闭设置后等待合成器绘制，再从 Chromium surface 取图。
    await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const debuggerSession = window.webContents.debugger;
    debuggerSession.attach('1.3');
    try {
      const { data } = await debuggerSession.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      writeFileSync(join(root, name), Buffer.from(data, 'base64'));
    } finally {
      debuggerSession.detach();
    }
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
  const projectTab = async (tab: 'tasks' | 'overview') => {
    const target = `document.querySelector('#project-tab-${tab}')`;
    await wait(`${target} && !${target}.disabled`);
    await evaluate(`${target}.click()`);
    await wait(`${target}?.getAttribute('aria-selected')==='true'`);
  };
  const select = async (label: string, value: string) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')});if(!e||e.disabled)throw new Error('Project select unavailable');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  const input = async (label: string, value: string, select = false) => {
    await evaluate(
      `(()=>{const e=document.querySelector('[aria-label="${label}"]');if(!e || e.disabled) throw new Error('Field unavailable: ${label}');Object.getOwnPropertyDescriptor(${select ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${select ? 'change' : 'input'}',{bubbles:true}));})()`,
    );
  };
  const projectComposer = '.project-ai-content .agent-prompt';
  const projectInput = `${projectComposer} [data-testid=assistant-input]`;
  const projectComposerReady = `(() => {
    const form = document.querySelector('${projectComposer}');
    return form instanceof HTMLFormElement &&
      form.querySelector('[data-testid=assistant-input]:enabled') &&
      form.querySelector('[aria-label="选择大模型"]') &&
      form.querySelector('[aria-label="发送"]') &&
      !form.querySelector('[aria-label="添加文件与材料"]') &&
      !document.querySelector('.project-ai-content > select');
  })()`;
  const focusProjectComposer = async () => {
    await wait(
      `${projectComposerReady} && !document.querySelector('${projectInput}').closest('[inert]')`,
    );
    window.webContents.focus();
    await evaluate(`(() => {
      const input = document.querySelector('${projectInput}');
      input.focus();
      input.click();
    })()`);
    await wait("document.querySelector('[aria-label=项目上下文] dl')");
  };
  const typeProjectDraft = async (draft: string) => {
    await wait(`document.querySelector('${projectInput}:enabled')`);
    await evaluate(`(() => {
      const input = document.querySelector('${projectInput}');
      input.focus();
      document.execCommand('insertText', false, ${JSON.stringify(draft)});
    })()`);
    await wait(`document.querySelector('${projectInput}')?.value === ${JSON.stringify(draft)}`);
  };
  const assertRemovedControls = () =>
    wait(`(()=>{const aside=document.querySelector('.project-properties');return aside.querySelector('form') &&
      !aside.querySelector('[data-project-task],[aria-label="归入已有任务"]') &&
      !Array.from(aside.querySelectorAll('button')).some(b=>['保存项目属性','打开项目','归档项目','归入项目'].includes(b.textContent.trim())) &&
      !aside.textContent.includes('项目属性已保存') && !document.querySelector('.view-toolbar .view-tabs');})()`);
  try {
    await wait("document.querySelector('[data-nav=projects]')");
    await evaluate("document.querySelector('[data-nav=projects]').click()");
    await wait("document.querySelector('[data-testid=project-catalog]')");
    if (phase === 'project-agent-write' || phase === 'project-agent-read') {
      const title = '合成项目 · 独立 AI';
      const second = '合成项目 · 隔离检查';
      const question = '合成问题：项目目标日是哪一天？';
      const context = '[aria-label="项目上下文"]';
      const send = `${projectComposer} [aria-label=发送]`;
      const create = (title: string) =>
        evaluate(
          `window.caselite.catalog(${JSON.stringify({
            protocol_version: 1,
            operation: 'create_project',
            request_id: randomUUID(),
            idempotency_key: randomUUID(),
            title,
            status: 'active',
            attributes: {
              project_type: 'litigation',
              professional_type: 'civil_litigation',
              professional_fields: { civil_litigation: { case_number: '不进入预览的合成案号' } },
              assignee: '不进入预览的合成人员',
              priority: 2,
              start_date: null,
              target_date: '2027-02-03',
              tags: ['不进入预览的合成标签'],
            },
          })})`,
        );
      if (phase === 'project-agent-write') {
        if (!(await create(title)).ok || !(await create(second)).ok)
          throw new Error('Project Agent setup failed');
        await evaluate("document.querySelector('[data-nav=home]').click()");
        await wait("document.querySelector('[data-testid=agent-input]')");
        await evaluate("document.querySelector('[data-nav=projects]').click()");
      }
      await button(title);
      await wait(`document.querySelector('${projectInput}:enabled')`);
      if (phase === 'project-agent-read') {
        await wait(`document.querySelector('.project-ai-content .assistant-message--user')?.textContent.includes(${JSON.stringify(question)}) &&
          document.querySelector('.project-ai-content .assistant-message--assistant')?.textContent.includes('固定 UI 测试内容')`);
        await evaluate(
          `document.querySelector('${projectComposer}').scrollIntoView({block:'end'})`,
        );
        await captureRenderer('project-agent-reopened.png');
      } else {
        await wait(
          `!document.querySelector('${context} dl') && document.querySelector('${send}:disabled')`,
        );
        assertNoRuns();
        await wait(`!document.querySelector('${projectInput}')?.closest('[inert]')`);
        window.webContents.focus();
        const focused = await evaluate(`(() => {
          const input = document.querySelector('${projectInput}');
          input.focus();
          return document.activeElement === input;
        })()`);
        if (!focused) throw new Error('Project composer could not be focused');
        await wait(
          `document.querySelector('${context} dl') || document.querySelector('${context} [role=alert]')`,
        );
        const previewText = await evaluate(`document.querySelector('${context}').innerText`);
        if (
          !['合成项目 · 独立 AI', '进行中', '民事诉讼', '高', '2027-02-03'].every((value) =>
            previewText.includes(value),
          )
        )
          throw new Error(`Unexpected project preview: ${previewText}`);
        await wait(`(() => {
          const preview = document.querySelector('${context} dl');
          return preview?.querySelectorAll('dd').length === 5 &&
            ['合成项目 · 独立 AI', '进行中', '民事诉讼', '高', '2027-02-03'].every(value => preview.textContent.includes(value)) &&
            !preview.textContent.includes('不进入预览') &&
            !document.querySelector('${projectComposer} [aria-label="添加文件与材料"]');
        })()`);
        assertNoRuns();
        await typeProjectDraft(question);
        await evaluate(
          `document.querySelector('${projectComposer}').scrollIntoView({block:'end'})`,
        );
        await captureRenderer('project-agent-context.png');
        await wait(`document.querySelector('${send}:enabled')`);
        await evaluate(`document.querySelector('${send}').click()`);
        await wait("document.querySelector('.project-ai-content .assistant-run-status.succeeded')");
        await wait(
          "document.querySelector('.project-ai-content .assistant-message--assistant')?.textContent.includes('固定 UI 测试内容')",
        );
        await evaluate(
          `document.querySelector('${projectComposer}').scrollIntoView({block:'end'})`,
        );
        await captureRenderer('project-agent-reply.png');
        await evaluate("document.querySelector('[data-nav=home]').click()");
        await wait(
          "document.querySelector('[data-testid=agent-input]') && !document.querySelector('.assistant-message--assistant')",
        );
        await evaluate("document.querySelector('[data-nav=projects]').click()");
        await button(second);
        await wait(
          `document.querySelector('${projectInput}:enabled')?.value === '' && !document.querySelector('.project-ai-content .assistant-message--assistant')`,
        );
      }
      const connection = openToolchainProbe(
        join(isolation.userData, 'caselite.sqlite'),
        join(process.resourcesPath, 'migrations'),
      );
      try {
        const rows = connection.sqlite.prepare('SELECT scope,payload FROM agent_runs').all() as {
          scope: string;
          payload: string;
        }[];
        if (
          rows.length !== 1 ||
          !rows[0].scope.startsWith('project:') ||
          JSON.parse(rows[0].payload).status !== 'succeeded' ||
          existsSync(join(root, 'unexpected-runtime.txt'))
        )
          throw new Error('Expected one completed project Run and no unexpected dispatch');
        writeFileSync(
          join(root, `${phase}.json`),
          JSON.stringify(
            {
              status: 'PASS_REAL',
              provider: 'MOCK_ONLY',
              realProviderDispatches: 0,
              isolation,
              runId: JSON.parse(rows[0].payload).id,
            },
            null,
            2,
          ),
        );
      } finally {
        connection.sqlite.close();
      }
      return;
    }
    if (process.env.CASELITE_WORKSPACE_NAVIGATION_TEST === '1') {
      const click = async (selector: string) => {
        const target = `document.querySelector(${JSON.stringify(selector)})`;
        await wait(`${target} && !${target}.disabled`);
        await evaluate(`${target}.click()`);
      };
      const title = '合成工作区导航项目';
      for (const [id, label] of [
        ['finance', '财务'],
        ['tools', '工具'],
        ['whiteboard', '白板'],
      ]) {
        await click(`[data-nav=${id}]`);
        await wait(
          `document.querySelector('.workspace-placeholder h1')?.textContent===${JSON.stringify(label)}`,
        );
        await capture(`workspace-${id}.png`);
      }
      await click('[data-nav=projects]');
      await button('创建项目');
      await wait("document.querySelector('dialog[open] input')===document.activeElement");
      await evaluate(`(()=>{
        const input=document.activeElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(title)});
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await click('dialog[open] button[type=submit]');
      await wait(
        `document.querySelector('.project-catalog-heading h1')?.textContent===${JSON.stringify(title)}`,
      );
      await select('项目优先级', '2');
      await wait(
        `document.querySelector('[aria-label=项目优先级]')?.value==='2' && !document.querySelector('.workspace-project-back-button')?.disabled`,
      );
      const list: CatalogResponse = await evaluate(
        "window.caselite.catalog({protocol_version:1,operation:'list',project_properties:true})",
      );
      if (!list.ok || !list.projects.some((p) => p.title === title && p.attributes?.priority === 2))
        throw new Error('Project property receipt missing');
      await evaluate(
        "(()=>{const editor=document.querySelector('[data-testid=project-overview-editor]');editor.focus();document.execCommand('insertText',false,'合成项目草稿，切换前须保存。');})()",
      );
      await wait(
        "document.querySelector('.workspace-project-back-button').disabled && document.querySelector('#project-tab-visualization').disabled && document.querySelector('.project-catalog-heading .primary').disabled",
      );
      await click('[data-nav=home]');
      await wait(
        "document.querySelector('.workspace-main > [role=alert]') && document.querySelector('[data-testid=project-overview-editor]').textContent.includes('合成项目草稿')",
      );
      await button('保存项目概述');
      await wait(
        "Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent.includes('说明修订 1'))",
      );
      await click('button[aria-label=关闭提示]');
      await click('#project-tab-visualization');
      await wait("document.querySelector('#project-panel-visualization:not([hidden])')");
      const bounds = window.getBounds();
      for (const [theme, width] of [
        ['light', 1440],
        ['dark', 1440],
        ['dark', 640],
        ['light', 640],
      ] as const) {
        window.setContentSize(width, 900);
        await wait(`innerWidth===${width}`);
        await click('[data-nav=settings]');
        await button('常规');
        await click(`.theme-option:has(.theme-swatch--${theme})`);
        await wait(`document.documentElement.dataset.theme==='${theme}'`);
        await button('返回工作区');
        await button(title);
        await click('#project-tab-visualization');
        await wait(`(() => {
          const labels=(selector)=>[...document.querySelectorAll(selector)].map(e=>e.textContent.trim()).join(',');
          const rect=(selector)=>document.querySelector(selector).getBoundingClientRect();
          const fold=rect('.workspace-navigation-toggle'), back=rect('.workspace-project-back-button');
          const title=rect('.project-catalog-heading h1'), create=rect('.project-catalog-heading > .primary');
          return [...document.querySelectorAll('#primary-navigation button')].map(b=>b.ariaLabel).join(',')==='首页,提醒,任务,知识库,项目,财务,工具,白板,文档'
            && labels('.project-section-tabs button')==='概述,任务,文件,可视化,交付物,活动'
            && labels('.project-properties .project-fields > label > .project-property-label').startsWith('状态,优先级,负责人,日期,标签,名称,项目类型')
            && document.querySelector('[data-nav=settings]').textContent.replace(/\\s/g,'')==='谭律师Pro'
            && document.querySelector('[data-nav=settings] img.profile-avatar')?.naturalWidth>0
            && Math.abs((fold.top+fold.bottom)-(back.top+back.bottom))<=2 && back.left>=fold.right && back.left-fold.right<=32
            && title.right<=create.left && create.right<=innerWidth;
        })()`);
        await capture(`workspace-${theme}-${width}.png`);
        await click('.workspace-navigation-toggle');
        await wait(
          "document.querySelector('.workspace-navigation-toggle[aria-expanded=false]') && document.querySelector('.workspace-project-back-button')",
        );
        await capture(`workspace-${theme}-${width}-collapsed.png`);
        await click('.workspace-navigation-toggle');
        await click('.workspace-project-back-button');
        await wait(
          `document.activeElement?.matches('.project-title-link') && document.activeElement.textContent.trim()===${JSON.stringify(title)}`,
        );
      }
      window.setBounds(bounds);
      assertNoRuns();
      writeFileSync(
        join(root, 'workspace-navigation-result.json'),
        JSON.stringify(
          { status: 'PASS_REAL', isolation, projectTitle: title, providerDispatches: 0 },
          null,
          2,
        ),
      );
      return;
    }
    // 仅隔离演练：向当前 WebContents 发送固定按键，无远程调试端口或桌面焦点切换。
    const propertyKey = async (key: string, code: string, virtualKey: number) => {
      const debuggerSession = window.webContents.debugger;
      debuggerSession.attach('1.3');
      try {
        await debuggerSession.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        for (const type of ['keyDown', 'keyUp'])
          await debuggerSession.sendCommand('Input.dispatchKeyEvent', {
            type,
            key,
            code,
            windowsVirtualKeyCode: virtualKey,
            ...(key.length === 1 && type === 'keyDown' ? { text: key } : {}),
          });
      } finally {
        debuggerSession.detach();
      }
    };
    const taskPropertiesMode = process.env.CASELITE_TASK_PROPERTIES_TEST;
    if (taskPropertiesMode === 'write' || taskPropertiesMode === 'read') {
      const fixture = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const projectId = fixture.task.matter_id;
      const projectTitle = '独立任务转项目验收';
      const click = async (selector: string) => {
        const element = `document.querySelector(${JSON.stringify(selector)})`;
        await wait(`${element} && !${element}.disabled`);
        await evaluate(`${element}.click()`);
      };
      const setInput = async (selector: string, value: string) =>
        evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});
          e.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
      const checkFields = async (status: string, priority: number, date: string) =>
        wait(`document.querySelector('[aria-label=任务状态]')?.value===${JSON.stringify(status)} &&
          document.querySelector('[aria-label=任务优先级]')?.value==='${priority}' &&
          document.querySelector('[aria-label=普通截止日期]')?.value===${JSON.stringify(date)}`);
      await button(projectTitle);
      await projectTab('tasks');
      if (taskPropertiesMode === 'read') {
        const { ids } = JSON.parse(
          readFileSync(join(root, 'task-properties-written.json'), 'utf8'),
        );
        await click(`[data-project-task="${ids.project}"]`);
        await wait(
          `document.querySelector('.task-detail')?.dataset.activeTask===${JSON.stringify(ids.project)}`,
        );
        await checkFields('in_progress', 4, '2027-02-03');
        await capture('task-properties-reopened.png');
        const result: TaskResponse = await evaluate(
          "window.caselite.task({operation:'list',protocol_version:1})",
        );
        if (
          !result.ok ||
          result.tasks.length !== 4 ||
          result.tasks.find((task) => task.id === ids.global)?.matter_id !== projectId ||
          result.tasks.find((task) => task.id === ids.global)?.tags?.[0] !== '合成项目标签' ||
          result.tasks.find((task) => task.id === ids.project)?.tags?.[0] !== '合成项目标签' ||
          result.tasks.find((task) => task.id === ids.independent)?.matter_id !== null
        )
          throw new Error('Task identities or grouping changed after restart');
        assertNoRuns();
        writeFileSync(
          join(root, 'task-properties-reopened.json'),
          JSON.stringify({ status: 'PASS_REAL', isolation, ids, providerDispatches: 0 }),
        );
        return;
      }

      await select('项目优先级', '1');
      await wait("!document.querySelector('.workspace-project-back-button')?.disabled");
      await button('新建任务');
      await wait(
        `document.querySelector('[aria-label=所属项目]:not(:disabled)')?.value===${JSON.stringify(projectId)}`,
      );
      await checkFields('todo', 0, '');
      await click('[aria-label=取消新建任务]');
      await wait("document.querySelector('#project-tab-tasks[aria-selected=true]')");
      await button('新建任务');
      await checkFields('todo', 0, '');
      await select('任务状态', 'in_progress');
      await select('任务优先级', '2');
      await setInput('[aria-label=普通截止日期]', '2027-02-03');
      await setInput('[data-testid=task-title]', '合成任务 · 项目内新建');
      await setInput('[aria-label=新标签]', '合成项目标签');
      await button('添加');
      await capture('task-create-project.png');
      await click('[data-testid=create-task]');
      await wait("document.querySelector('.task-detail')?.dataset.activeTask");
      const projectTask = await evaluate(
        "document.querySelector('.task-detail').dataset.activeTask",
      );
      await checkFields('in_progress', 2, '2027-02-03');
      await wait(
        `Array.from(document.querySelectorAll('.task-work-area .page-topline span')).some(e=>e.textContent===${JSON.stringify(projectTitle)})`,
      );
      await wait(
        "document.querySelector('.task-inspector [aria-label=\"移除标签 合成项目标签\"]') && !document.querySelector('.task-inspector .inspector-open')",
      );
      await capture('task-properties-detail.png');
      await select('任务优先级', '4');
      await wait("!document.querySelector('.task-properties-editor [role=status]')");
      await checkFields('in_progress', 4, '2027-02-03');
      await button('本机提醒');
      await button('设置提醒');
      await click('[data-testid=back-to-tasks]');
      await wait(
        "document.querySelector('.task-detail') && document.querySelector('[role=alert]')?.textContent.includes('请先保存')",
      );
      await button('取消编辑');
      await button('本机提醒');
      await click('[aria-label=关闭提示]');
      const composer = '.task-inspector [data-testid=assistant-input]';
      await wait(`document.querySelector('${composer}')`);
      await evaluate(
        `(()=>{const e=document.querySelector('${composer}');e.focus();document.execCommand('insertText',false,'合成草稿，不发送');})()`,
      );
      await wait(`document.querySelector('${composer}').value.includes('合成草稿')`);
      const inspectComposer = async (owner: string) => {
        const selector = `${owner} .agent-prompt`;
        await wait(
          `document.querySelector('${selector}') && !document.querySelector('.settings-center')`,
        );
        await evaluate(`document.querySelector('${selector}').scrollIntoView({block:'center'})`);
        await wait(`(()=>{const e=document.querySelector('${selector}');if(!e) return false;
          const controls=['[data-testid=assistant-input]','[aria-label="选择大模型"]','[aria-label=发送]'];
          if(!e.closest('.project-ai-content')) controls.push('[aria-label="添加文件与材料"]');
          return controls.every(selector=>{const control=e.querySelector(selector),r=control?.getBoundingClientRect();
            return r&&r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth+1&&
              control.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));});})()`);
      };
      await inspectComposer('.task-inspector');
      await captureRenderer('task-compact-ai-light.png');
      await click('[data-nav=settings]');
      await button('常规');
      await click('.theme-option:has(.theme-swatch--dark)');
      await wait("document.documentElement.dataset.theme==='dark'");
      await button('返回工作区');
      await wait(`document.querySelector('${composer}')?.value.includes('合成草稿')`);
      window.setContentSize(640, 500);
      await wait('innerWidth===640');
      await evaluate(`document.querySelector('${composer}').scrollIntoView({block:'center'})`);
      await wait(
        `(()=>{const r=document.querySelector('${composer}').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;})()`,
      );
      await inspectComposer('.task-inspector');
      await captureRenderer('task-compact-ai-dark-640.png');
      await click('[data-testid=back-to-tasks]');
      await wait(`document.querySelector('#project-tab-tasks[aria-selected=true]') &&
        document.activeElement?.dataset.projectTask===${JSON.stringify(projectTask)}`);
      await capture('task-project-return.png');
      await wait(
        `${projectComposerReady} && document.querySelector('${projectInput}')?.value === ''`,
      );
      await captureRenderer('project-ai-unselected-dark-640.png');
      await focusProjectComposer();
      await typeProjectDraft('合成项目草稿，不发送');
      await inspectComposer('.project-ai-content');
      await captureRenderer('project-compact-ai-dark-640.png');

      window.setContentSize(1440, 900);
      await click('[data-nav=settings]');
      await button('常规');
      await click('.theme-option:has(.theme-swatch--light)');
      await wait("document.documentElement.dataset.theme==='light'");
      await button('返回工作区');
      await focusProjectComposer();
      await wait(`document.querySelector('${projectInput}')?.value === '合成项目草稿，不发送'`);
      await inspectComposer('.project-ai-content');
      await captureRenderer('project-compact-ai-light-1440.png');

      const globalCreate = async (title: string, group: boolean) => {
        await click('[data-nav=tasks]');
        await click('[data-testid=new-task]');
        await checkFields('todo', 0, '');
        await wait("document.querySelector('[aria-label=所属项目]:not(:disabled)')?.value===''");
        if (group) {
          await select('所属项目', projectId);
          await select('选择已使用的任务标签', '合成项目标签');
        }
        await setInput('[data-testid=task-title]', title);
        await click('[data-testid=create-task]');
        await wait(
          `document.querySelector('.task-detail h1')?.textContent===${JSON.stringify(title)}`,
        );
        await checkFields('todo', 0, '');
        return evaluate("document.querySelector('.task-detail').dataset.activeTask");
      };
      const ids = {
        project: projectTask,
        global: await globalCreate('合成任务 · 全局归组', true),
        independent: await globalCreate('合成任务 · 全局独立', false),
      };
      assertNoRuns();
      writeFileSync(
        join(root, 'task-properties-written.json'),
        JSON.stringify({ status: 'PASS_REAL', isolation, ids, providerDispatches: 0 }),
      );
      return;
    }
    const densityMode = process.env.CASELITE_PROJECT_DENSITY_TEST;
    if (densityMode === '1' || densityMode === 'read') {
      const seed = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const taskId = seed.task.id;
      const click = async (selector: string) => {
        const el = `document.querySelector(${JSON.stringify(selector)})`;
        await wait(`${el} && !${el}.disabled`);
        await evaluate(`${el}.click()`);
      };
      const projectLink = `tr[data-project-id="${seed.task.matter_id}"] .project-title-link`;
      const openFixture = () => click(projectLink);
      const sidebar = '.project-properties';
      const activity = '#project-panel-activity .activity-list';
      const composer = '[data-testid=assistant-input]';
      const scrollAndCheck = async (selector: string) => {
        const el = `document.querySelector(${JSON.stringify(selector)})`;
        await wait(el);
        await evaluate(`${el}.scrollIntoView({block:'center',inline:'nearest'})`);
        await wait(`(()=>{const e=${el};const r=e.getBoundingClientRect();
          return r.width>0 && r.height>0 && r.left>=0 && r.right<=innerWidth &&
            e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()`);
      };
      const documentId = seed.task.document_id;
      const projectId = seed.task.matter_id;
      const documentRow = `[data-document-id="${documentId}"]`;
      const taskRow = `[data-row-task="${taskId}"]`;
      const tag = '[aria-label="移除标签 合成文档标签"]';
      const projectField = `document.querySelector('[aria-label="所属项目"]:enabled')`;
      const assigneeButton = '.task-assignee-value';
      const assigneeInput = '[aria-label="本地负责人称呼"]';
      const checkAssignee = async (value: string | null) => {
        await wait(`document.querySelector('${assigneeButton}')?.textContent===${JSON.stringify(value ?? '未分配')} &&
          !document.querySelector('.task-properties-editor [role=status], .task-property-recovery')`);
        const result: TaskResponse = await evaluate(
          `window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(taskId)}})`,
        );
        if (!result.ok || result.tasks[0]?.assignee !== value)
          throw new Error('Task assignee did not persist');
      };
      const enterAssignee = async (name: string) => {
        await evaluate(`(()=>{
          const field=document.querySelector('${assigneeInput}');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(name)});
          field.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
      };
      const readDocumentProperties = () =>
        wait(`(()=>{const e=document.querySelector('.document-property-values');
          const row=document.querySelector('${documentRow}');
          return row && e &&
            Array.from(e.querySelectorAll('dt')).map(x=>x.textContent).join('/')==='文档版本/关联项目/关联任务/文档 ID' &&
            e.querySelectorAll('dd')[0].textContent===row.cells[3].textContent &&
            e.querySelectorAll('dd')[1].textContent===${JSON.stringify(seed.task.matter_title)} &&
            e.querySelectorAll('dd')[2].textContent===${JSON.stringify(seed.task.title)} &&
            e.querySelectorAll('dd')[3].textContent===${JSON.stringify(documentId)} &&
            getComputedStyle(e.querySelector('dd')).borderTopWidth==='0px';})()`);
      const checkPropertyGrid = (scope: string, count: number) =>
        wait(`(() => {
          const section = document.querySelector(${JSON.stringify(scope)});
          const rows = Array.from(section?.querySelectorAll('.inspector-property-row') ?? []);
          return rows.length >= ${count} && rows.every(row => {
            const value = row.lastElementChild;
            const style = getComputedStyle(value);
            const bounds = value.getBoundingClientRect();
            return Math.abs(bounds.left - row.getBoundingClientRect().left - 102) < 1 &&
              bounds.width > 0 && bounds.right <= innerWidth + 1 &&
              style.borderTopWidth === '0px';
          });
        })()`);
      const projectProperties = '.project-properties .inspector-disclosure';
      const taskProperties = '.task-inspector-content .inspector-disclosure';
      const projectAssignee = '合成项目负责人';
      const taskAssignee = '合成本地负责人';
      const taskTag = '合成任务标签';
      const checkTaskTag = () =>
        wait(`document.querySelector('[aria-label="移除标签 ${taskTag}"]') &&
          !document.querySelector('[aria-label="移除标签 合成文档标签"]')`);
      const propertyLabels = ['项目状态', '项目优先级', '项目类型'];
      const checkProperties = async () => {
        await wait(`(()=>{const aside=document.querySelector('${sidebar}');return aside &&
          !aside.querySelector('.activity-list') &&
          getComputedStyle(aside.querySelector('.project-professional-card')).borderTopWidth==='1px' &&
          !aside.textContent.includes('负责人仅作记录') &&
          ${JSON.stringify(propertyLabels)}.every(label=>{
            const e=aside.querySelector('[aria-label="'+label+'"]');
            if (!(e instanceof HTMLSelectElement)) return false;
            const style=getComputedStyle(e);
            return style.appearance==='none' && style.borderTopWidth==='0px' &&
              style.backgroundColor==='rgba(0, 0, 0, 0)' && style.cursor==='pointer';
          });})()`);
      };
      const inspectComposer = async (owner: string, input = composer) => {
        if (owner.includes('.sidebar-agent')) {
          const el = `document.querySelector(${JSON.stringify(owner)})`;
          await wait(`${el} && !${el}.querySelector('.assistant-footnote')`);
        }
        for (const control of [
          input,
          ...(owner.includes('.project-ai-content') ? [] : ['[aria-label="添加文件与材料"]']),
          '[aria-label="选择大模型"]',
          '[aria-label=发送]',
        ])
          await scrollAndCheck(`${owner} ${control}`);
      };
      await openFixture();
      await checkProperties();
      await click('#project-tab-activity');
      await wait(`document.querySelector('${activity} [data-activity-id]')`);
      if (densityMode === 'read') {
        const saved = JSON.parse(readFileSync(join(root, 'inspector-density-result.json'), 'utf8'));
        const id = JSON.stringify(saved.lastActivityId);
        await wait(
          `Array.from(document.querySelectorAll('${activity} [data-activity-id]')).some(e=>e.dataset.activityId===${id})`,
        );
        await wait(`document.querySelector('#project-panel-activity .project-discussion') &&
          Object.entries(${JSON.stringify(saved.properties)}).every(([label,value])=>
            document.querySelector('[aria-label="'+label+'"]')?.value===value)`);
        await captureRenderer('inspector-activity-reopened.png');
        await click('[data-nav=knowledge]');
        await click(documentRow);
        await readDocumentProperties();
        await wait(`document.querySelector('${tag}')`);
        await captureRenderer('document-knowledge-reopened.png');
        await click('[data-nav=tasks]');
        await click(taskRow);
        await wait(`${projectField}?.value===${JSON.stringify(projectId)}`);
        await checkAssignee(taskAssignee);
        await checkTaskTag();
        await scrollAndCheck(assigneeButton);
        await captureRenderer('task-assignee-reopened.png');

        assertNoRuns();
        return;
      }
      const oldEvent = await evaluate(
        `document.querySelector('${activity} [data-activity-id]').dataset.activityId`,
      );
      const properties = {
        项目状态: 'done',
        项目优先级: '4',
        项目类型: 'civil_litigation',
      };
      const priority = '[aria-label="项目优先级"]';
      await scrollAndCheck(priority);
      await evaluate(
        `document.querySelector('${priority}').closest('label').querySelector('span').scrollIntoView({block:'center'})`,
      );
      window.focus();
      window.webContents.focus();
      await evaluate("document.querySelector('[aria-label=项目状态]').focus()");
      await propertyKey('Tab', 'Tab', 9);
      await wait(`document.activeElement===document.querySelector('${priority}') &&
        document.activeElement.matches(':focus-visible') &&
        getComputedStyle(document.activeElement).outlineWidth==='2px'`);
      await captureRenderer('inspector-property-keyboard-focus.png');
      await propertyKey('低', 'Unidentified', 0);
      await wait(`document.querySelector('${priority}')?.value===${JSON.stringify(properties.项目优先级)} &&
        !document.querySelector('.workspace-project-back-button')?.disabled`);
      await evaluate('document.activeElement.blur()');
      for (const label of ['项目状态', '项目类型'] as const) {
        const field = `document.querySelector('[aria-label="${label}"]')`;
        await wait(`${field} && !${field}.disabled`);
        await select(label, properties[label]);
        await wait(`${field}?.value===${JSON.stringify(properties[label])} &&
          !document.querySelector('.workspace-project-back-button')?.disabled`);
      }
      await wait("document.querySelector('[aria-label=案号]')");
      await wait(`document.querySelector('${activity} [data-activity-id]')?.dataset.activityId!==${JSON.stringify(oldEvent)} &&
        document.querySelector('${activity} [data-activity-id] strong')?.textContent==='更新项目'`);
      await input('项目负责人', projectAssignee);
      await input('项目目标日', '2027-02-03');
      await wait("!document.querySelector('.workspace-project-back-button')?.disabled");
      for (const [theme, width, height] of [
        ['light', 1440, 900],
        ['dark', 1440, 900],
        ['dark', 640, 480],
        ['light', 640, 480],
      ] as const) {
        window.setContentSize(width, height);
        await wait(`innerWidth===${width} && innerHeight===${height}`);
        await click('[data-nav=settings]');
        await button('常规');
        await click(`.theme-option:has(.theme-swatch--${theme})`);
        await wait(`document.documentElement.dataset.theme==='${theme}'`);
        await button('返回工作区');
        await openFixture();
        await wait(`${projectComposerReady} && document.querySelector('.profile-avatar').naturalWidth>0 &&
          document.querySelector('.profile-pro').textContent==='Pro' &&
          document.querySelector('.primary-navigation button').getBoundingClientRect().height===30`);
        await checkProperties();
        await scrollAndCheck('[aria-label=项目状态]');
        await captureRenderer(`inspector-properties-${theme}-${width}.png`);
        await focusProjectComposer();
        await inspectComposer('.project-ai-content .sidebar-agent .assistant-panel--compact');
        await scrollAndCheck(composer);
        await captureRenderer(`inspector-ai-${theme}-${width}.png`);
        await click('.workspace-navigation-toggle');
        await wait(
          "document.querySelector('.workspace-navigation-toggle[aria-expanded=false]') && !document.querySelector('.profile-pro')",
        );
        await scrollAndCheck(composer);
        await captureRenderer(`inspector-collapsed-${theme}-${width}.png`);
        await click('.workspace-navigation-toggle');
        await checkPropertyGrid(projectProperties, 7);
        await click('[data-nav=tasks]');
        await click(taskRow);
        await checkPropertyGrid(taskProperties, 5);
        await scrollAndCheck(`${taskProperties} [aria-label=普通截止日期]`);
        await captureRenderer(`task-properties-${theme}-${width}.png`);
        await click('[data-nav=documents]');
        await click(documentRow);
        await scrollAndCheck('.document-property-values');
        await checkPropertyGrid(taskProperties, 4);
        await captureRenderer(`document-properties-${theme}-${width}.png`);
        await click('[data-nav=projects]');
        await openFixture();
      }
      await focusProjectComposer();
      const editComposer = async () => {
        await scrollAndCheck(composer);
        await evaluate(
          `(()=>{const e=document.querySelector('${composer}');e.focus();document.execCommand('insertText',false,'合成草稿，不发送');})()`,
        );
        await wait(`document.querySelector('${composer}').value.includes('合成草稿，不发送')`);
      };
      await editComposer();
      await projectTab('tasks');
      await button('移出项目');
      await wait(projectComposerReady);
      await scrollAndCheck(projectInput);
      await captureRenderer('project-ai-no-available-task.png');
      await select('归入已有任务', taskId);
      await button('归入项目');
      await wait(projectComposerReady);
      await focusProjectComposer();
      await wait(`document.querySelector('${composer}')?.value.includes('合成草稿，不发送')`);
      await click('#project-tab-activity');
      await wait(
        `document.querySelector('#project-panel-activity .project-discussion') &&
          Array.from(document.querySelectorAll('${activity} li button')).some(e=>e.textContent.includes('任务'))`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('${activity} li button')).find(e=>e.textContent.includes('任务')).click()`,
      );
      await showTaskResult();
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.textContent.includes('原任务正文与引用保全样本')",
      );
      const taskFields = ['任务状态', '任务优先级', '普通截止日期', '所属项目'];
      await wait(`(()=> {
        const e=document.querySelector('.task-inspector-content .inspector-disclosure[open]');
        const rows=Array.from(e?.querySelectorAll('.task-properties-editor > .inspector-property-row')??[]);
        return rows.map(row=>row.firstElementChild.textContent).join('/')==='状态/优先级/日期/负责人/项目' &&
          rows[3].lastElementChild.textContent==='本人' &&
          ${JSON.stringify(taskFields)}.every(label=>{
            const control=e.querySelector('[aria-label="'+label+'"]');
            return control && getComputedStyle(control).borderTopWidth==='0px' &&
              getComputedStyle(control).backgroundColor==='rgba(0, 0, 0, 0)';
          });
      })()`);
      await evaluate("document.querySelector('[aria-label=任务状态]').focus()");
      await propertyKey('Tab', 'Tab', 9);
      await wait(`document.activeElement?.matches('[aria-label=任务优先级]:focus-visible') &&
        getComputedStyle(document.activeElement).outlineWidth==='2px'`);
      await captureRenderer('task-attribute-keyboard-focus.png');
      await evaluate('document.activeElement.blur()');
      for (const control of taskFields)
        await scrollAndCheck(`.task-inspector [aria-label="${control}"]`);
      await click('.task-inspector .inspector-disclosure > summary');
      await wait("!document.querySelector('.task-inspector .inspector-disclosure[open]')");
      await click('.task-inspector .inspector-disclosure > summary');
      await wait("document.querySelector('.task-inspector .inspector-disclosure[open]')");
      await scrollAndCheck('.task-inspector .task-tag-toggle');
      await inspectComposer('.task-inspector .sidebar-agent .assistant-panel--compact');
      await wait(
        `document.querySelector('.task-inspector ${composer}')?.value.includes('合成草稿，不发送')`,
      );
      await captureRenderer('inspector-return-original-task.png');
      await click('button[aria-label=返回来源项目]');
      await wait("document.querySelector('#project-panel-activity:not([hidden])')");
      await click('.workspace-project-back-button');
      await click('[data-nav=documents]');
      await click(`[data-document-id="${seed.task.document_id}"]`);
      await inspectComposer('[data-collection=documents] .sidebar-agent .assistant-panel--compact');
      await wait(
        `document.querySelector('[data-collection=documents] ${composer}')?.value.includes('合成草稿，不发送')`,
      );
      await captureRenderer('inspector-document-ai.png');
      await click('[data-nav=home]');
      await inspectComposer(
        '.agent-home .assistant-panel:not(.assistant-panel--compact)',
        '[data-testid=agent-input]',
      );
      await wait("!document.querySelector('.agent-home .sidebar-agent')");
      await captureRenderer('inspector-home-ai.png');
      await click('[data-nav=projects]');
      await button('创建项目');
      await wait("document.querySelector('dialog[open] input')===document.activeElement");
      await evaluate(`(()=>{
        const input=document.activeElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'合成无任务项目');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await click('dialog[open] button[type=submit]');
      await wait(`document.querySelector('.project-catalog-heading h1')?.textContent==='合成无任务项目' &&
        (${projectComposerReady})`);
      await scrollAndCheck('.project-ai-content textarea');
      await captureRenderer('project-ai-without-task.png');
      await click('.workspace-project-back-button');
      await openFixture();
      await focusProjectComposer();
      await wait(`document.querySelector('${composer}')?.value.includes('合成草稿，不发送')`);
      await select('项目状态', 'archived');
      await wait(
        `document.querySelector('.project-ai-content')?.textContent.includes('已归档') &&
          document.querySelector('${projectInput}:disabled') && document.querySelector('${projectComposer} [aria-label=发送]:disabled') &&
          document.querySelector('[aria-label=项目优先级]')?.disabled &&
          document.querySelector('[aria-label=项目状态]:enabled')?.value==='archived'`,
      );
      await scrollAndCheck(projectInput);
      await captureRenderer('project-ai-archived.png');
      await select('项目状态', 'restore');
      await wait(projectComposerReady);
      await click('#project-tab-activity');
      await wait(
        `document.querySelector('${activity} [data-activity-id] strong')?.textContent==='切换项目归档状态'`,
      );
      const lastActivityId = await evaluate(
        `document.querySelector('${activity} [data-activity-id]').dataset.activityId`,
      );
      await click('[data-nav=tasks]');
      await click(taskRow);
      await input('普通截止日期', '2027-02-04');
      await evaluate("document.querySelector('[aria-label=普通截止日期]').focus()");
      await propertyKey('Enter', 'Enter', 13);
      await wait(
        "document.querySelector('[aria-label=普通截止日期]')?.value==='2027-02-04' && !document.querySelector('.task-properties-editor [role=status]')",
      );
      await button('清空截止日期');
      await wait(
        "document.querySelector('[aria-label=普通截止日期]')?.value==='' && !document.querySelector('.task-properties-editor [role=status]')",
      );
      await button('添加标签');
      await input('新标签', taskTag);
      await button('添加');
      await checkTaskTag();
      await click('[data-nav=documents]');
      await click(documentRow);
      await readDocumentProperties();
      const documentSummary = `${taskProperties} > summary`;
      await evaluate(`document.querySelector('${documentSummary}').focus()`);
      await propertyKey(' ', 'Space', 32);
      await wait(`document.activeElement.matches('${documentSummary}:focus-visible') &&
        !document.querySelector('${taskProperties}[open]')`);
      await captureRenderer('document-property-keyboard-focus.png');
      await propertyKey(' ', 'Space', 32);
      await wait(`document.querySelector('${taskProperties}[open]')`);
      await wait("!document.querySelector('[aria-label=新标签]')");
      await button('添加标签');
      await input('新标签', '合成文档标签');
      await wait(`document.querySelector('[aria-label=新标签]')?.value==='合成文档标签' &&
        document.querySelector('[data-collection=documents] .view-toolbar > button:disabled')`);
      await click('[data-nav=knowledge]');
      await wait(
        "document.querySelector('[data-collection=documents]') && document.querySelector('[aria-label=新标签]')?.value==='合成文档标签'",
      );
      await button('添加');
      await wait(
        `document.querySelector('${tag}') && !document.querySelector('[aria-label=新标签]')`,
      );
      await button('收藏文档');
      await button('取消收藏');
      await button('加入知识库');
      await wait(
        "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='移出知识库' && !e.disabled)",
      );
      await captureRenderer('document-properties.png');
      await button('归档文档');
      await button('已归档');
      await click(documentRow);
      await wait(
        "document.querySelector('[aria-label=文档标签]')?.textContent.includes('合成文档标签') && !document.querySelector('.task-tag-toggle')",
      );
      await button('恢复文档');
      await wait(
        `!document.querySelector('${documentRow}') && !document.querySelector('.catalog-actions')`,
      );
      await click('[data-nav=knowledge]');
      await click(documentRow);
      await readDocumentProperties();
      await wait(`document.querySelector('${tag}')`);
      window.setContentSize(640, 480);
      await wait('innerWidth===640 && innerHeight===480');
      await scrollAndCheck('.document-property-values');
      await captureRenderer('document-knowledge-narrow.png');

      await click('[data-nav=tasks]');
      await wait("document.querySelector('[aria-label=任务项目范围]')?.options.length>=2");
      await select('任务项目范围', projectId);
      await click(taskRow);
      await wait(`${projectField}?.value===${JSON.stringify(projectId)}`);
      await select('所属项目', '');
      await wait(
        `!document.querySelector('${taskRow}') && !document.querySelector('[aria-label=所属项目]')`,
      );
      await select('任务项目范围', 'workspace');
      await click(taskRow);
      await wait(`${projectField}?.value===''`);
      await select('所属项目', projectId);
      await wait(`${projectField}?.value===${JSON.stringify(projectId)}`);
      await checkAssignee('本人');
      await scrollAndCheck(assigneeButton);
      window.setContentSize(1440, 900);
      await wait('innerWidth===1440 && innerHeight===900');
      await click(assigneeButton);
      await enterAssignee(`  ${taskAssignee}  `);
      const checkAssigneeGuard = async () => {
        await click('[data-nav=projects]');
        await wait(`document.querySelector('[data-nav=tasks][aria-current=page]') &&
          document.body.textContent.includes('请先保存当前内容或核对提交结果，再离开当前页面。')`);
      };
      await checkAssigneeGuard();
      await scrollAndCheck(assigneeInput);
      await captureRenderer('task-assignee-list-draft.png');
      const fault = openToolchainProbe(
        join(isolation.userData, 'caselite.sqlite'),
        join(process.resourcesPath, 'migrations'),
      ).sqlite;
      try {
        fault.exec(
          "CREATE TRIGGER fail_demo_assignee BEFORE INSERT ON task_receipts BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
        );
        await button('保存称呼');
        await wait("document.querySelector('.task-property-recovery')");
        await checkAssigneeGuard();
        const stored = fault.prepare('SELECT assignee FROM task_items WHERE id=?').get(taskId);
        if (JSON.stringify(stored) !== JSON.stringify({ assignee: '本人' }))
          throw new Error('Unconfirmed assignee escaped transaction rollback');
        await scrollAndCheck('.task-property-recovery button');
        await captureRenderer('task-assignee-write-failed.png');
      } finally {
        fault.exec('DROP TRIGGER IF EXISTS fail_demo_assignee');
        fault.close();
      }
      await button('重试保存');
      await checkAssignee(taskAssignee);
      await captureRenderer('task-list-project-reassigned.png');
      await click(`${taskRow} .task-row-title`);
      await wait(
        `document.querySelector('.task-detail') && ${projectField}?.value===${JSON.stringify(projectId)}`,
      );
      await select('所属项目', '');
      await wait(`${projectField}?.value===''`);
      await select('所属项目', projectId);
      await wait(`${projectField}?.value===${JSON.stringify(projectId)}`);
      await showTaskResult();
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.textContent.includes('原任务正文与引用保全样本')",
      );
      await captureRenderer('task-detail-project-reassigned.png');
      await checkAssignee(taskAssignee);
      window.setContentSize(640, 480);
      await wait('innerWidth===640 && innerHeight===480');
      await scrollAndCheck(assigneeButton);
      await wait(
        `getComputedStyle(document.querySelector('${assigneeButton}')).borderTopWidth==='0px'`,
      );
      await click(assigneeButton);
      await select('选择本地负责人', '本人');
      await checkAssignee('本人');
      await click(assigneeButton);
      await button('清空负责人');
      await checkAssignee(null);
      await evaluate('document.activeElement.blur()');
      await scrollAndCheck(assigneeButton);
      await captureRenderer('task-assignee-detail-cleared.png');
      await click(assigneeButton);
      await enterAssignee(taskAssignee);
      await button('保存称呼');
      await checkAssignee(taskAssignee);
      await checkTaskTag();
      await click('[data-nav=projects]');
      const projectHeading = `document.querySelector('.project-catalog-heading h1')?.textContent===${JSON.stringify(seed.task.matter_title)}`;
      const projectListed = `document.querySelector(${JSON.stringify(projectLink)})`;
      await wait(`${projectHeading} || ${projectListed}`);
      if (!(await evaluate(projectHeading))) await openFixture();
      await wait(`document.querySelector('[aria-label=项目负责人]')?.value===${JSON.stringify(projectAssignee)} &&
        document.querySelector('[aria-label=项目目标日]')?.value==='2027-02-03'`);
      assertNoRuns();
      writeFileSync(
        join(root, 'inspector-density-result.json'),
        JSON.stringify(
          {
            status: 'PASS_REAL',
            isolation,
            taskId,
            lastActivityId,
            properties: { ...properties, 项目负责人: projectAssignee, 项目目标日: '2027-02-03' },
            providerDispatches: 0,
            checks: [
              'shared-grid-three-inspectors-four-viewports',
              'independent-project-assignee-and-document-task-tags',
              'borderless-keyboard-focus-and-typeahead',
              'commit-refresh-and-restart',
              'shared-project-task-document-composer-and-home',
              'wide-and-short-hit-test',
              'theme-and-profile',
              'membership-and-draft',
              'activity-return',
              'project-switch-and-archive',
              'document-catalog-values-tag-draft-archive-and-knowledge',
              'task-list-project-filter-and-detail-assignment',
              'task-local-assignee-input-selection-clear-write-failure',
            ],
          },
          null,
          2,
        ),
      );
      return;
    }
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
      if (project.archived_at) await select('筛选项目状态', 'archived');
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
      await showTaskResult();
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
    const professional = process.env.CASELITE_PROJECT_PROFESSIONAL === '1';
    const assertPropertyRows = async (scope: string) => {
      const layout = await evaluate(
        `(()=>{const panel=document.querySelector(${JSON.stringify(scope)});const rows=[...panel.querySelectorAll('.inspector-property-row')].filter(e=>e.getClientRects().length);const flat=e=>getComputedStyle(e).borderTopWidth==='0px';return {rows:rows.length,brokenRows:rows.flatMap(e=>{const v=e.querySelector('input,select');const display=getComputedStyle(e).display;return e.querySelector('svg')&&display==='grid'&&flat(v)&&v.offsetHeight<=32&&v.getBoundingClientRect().right<=innerWidth+1?[]:[{label:v.ariaLabel,display,height:v.offsetHeight,right:v.getBoundingClientRect().right,border:getComputedStyle(v).borderTopWidth}];}),flatCard:(()=>{const s=getComputedStyle(panel.querySelector('.project-professional-card'));return s.borderTopWidth==='1px'&&s.borderRightWidth==='0px'&&s.borderBottomWidth==='0px'&&s.borderLeftWidth==='0px'&&s.boxShadow==='none';})(),noLegacyField:!panel.textContent.includes('开始日')&&!panel.querySelector('[aria-label=项目开始日]'),date:!!panel.querySelector('[aria-label=项目目标日]')};})()`,
      );
      if (
        layout.rows < 7 ||
        layout.brokenRows.length ||
        !layout.flatCard ||
        !layout.noLegacyField ||
        !layout.date
      )
        throw new Error('Invalid project property layout: ' + JSON.stringify(layout));
    };
    if (process.env.CASELITE_PROJECT_PROPERTIES) {
      const read = async (id?: string) => {
        const r: CatalogResponse = await evaluate(
          `window.caselite.catalog(${JSON.stringify(id ? { operation: 'read_project', protocol_version: 1, id } : { operation: 'list', protocol_version: 1 })})`,
        );
        if (!r.ok) throw new Error('Cannot read project properties');
        return r;
      };
      const expectedPath = join(root, 'properties-expected.json');
      if (phase === 'project-write' && process.env.CASELITE_PROJECT_PROPERTIES !== 'preview') {
        await button('创建项目');
        await wait("document.querySelector('dialog[open] [aria-label=项目名称]')");
        await input('项目名称', '合成项目属性验收');
        await propertyKey('Tab', 'Tab', 9);
        await wait("document.activeElement?.getAttribute('aria-label')==='项目类型'");
        await input('项目负责人', '合成负责人');
        await input('项目优先级', '2', true);
        await input('项目目标日', '2024-03-01');
        await input('项目标签', '验收,合成');
        await input('项目类型', 'civil_litigation', true);
        if (professional) {
          await input('受理法院', '合成法院');
          const before = await read();
          await evaluate("document.querySelector('.project-professional-card summary').focus()");
          await propertyKey(' ', 'Space', 32);
          await wait("!document.querySelector('.project-professional-card').open");
          if (JSON.stringify(await read()) !== JSON.stringify(before))
            throw new Error('Disclosure wrote project data');
          await propertyKey(' ', 'Space', 32);
          await wait("document.querySelector('.project-professional-card').open");
          if (
            (await evaluate("document.querySelector('[aria-label=受理法院]').value")) !== '合成法院'
          )
            throw new Error('Disclosure dropped draft');
          for (const [value, label] of [
            ['commercial_arbitration', '仲裁机构'],
            ['non_litigation', '拟交付成果'],
            ['contract_review', '审查重点'],
            ['criminal_litigation', '办案机关'],
          ]) {
            await input('项目类型', value, true);
            await wait(
              `document.querySelector('[aria-label=${label}]') && !document.querySelector('[aria-label=受理法院]')`,
            );
          }
          await input('办案机关', '合成办案机关');
          await input('项目类型', 'civil_litigation', true);
          await wait("document.querySelector('[aria-label=受理法院]')?.value==='合成法院'");
          await input('项目类型', 'criminal_litigation', true);
          await wait("document.querySelector('[aria-label=办案机关]')?.value==='合成办案机关'");
        }
        await input('项目状态', 'active', true);
        if (
          (await evaluate("document.querySelector('[aria-label=项目负责人]').value")) !==
          '合成负责人'
        )
          throw new Error('Type selection replaced manual values');
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
            if (professional)
              await evaluate(
                "document.querySelector('.project-professional-card').scrollIntoView({block:'center'})",
              );
            await assertPropertyRows('dialog[open]');
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
          current.attributes.start_date !== null ||
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
        // 创建界面不能填写旧日期；只在隔离库注入一个历史项目字段再从产品界面重读。
        const fixture = openToolchainProbe(
          join(isolation.userData, 'caselite.sqlite'),
          join(process.resourcesPath, 'migrations'),
        );
        try {
          fixture.sqlite
            .prepare('UPDATE matters SET start_date=?,version=version+1 WHERE id=?')
            .run('2024-02-29', current.id);
        } finally {
          fixture.sqlite.close();
        }
        await button('返回项目列表');
        await button(current.title);
        await wait("document.querySelector('[aria-label=编辑项目名称]')");
        current = (await read(current.id)).projects[0];
        const original = await read(current.id);
        if (!original.state || current.body_revision !== 1)
          throw new Error('Description not saved');
        await projectTab('tasks');
        await assertRemovedControls();
        await input('项目负责人', '合成右栏负责人');
        if (professional) await input('程序阶段', '合成阶段');
        await input('项目目标日', '2024-02-28');
        await wait("document.querySelector('[aria-label=项目目标日][aria-invalid=true]')");
        await wait(
          "document.querySelector('.project-property-error')?.textContent.includes('2024-02-29')",
        );
        if ((await read(current.id)).projects[0].version !== current.version)
          throw new Error('Legacy date conflict remained savable');
        await input('项目目标日', '2024-03-01');
        await evaluate(
          "(()=>{const e=document.querySelector('[aria-label=项目目标日]');e.scrollIntoView({block:'center'});e.addEventListener('input',()=>{if(e.validity.badInput)e.dataset.observedBadInput='true';},true);e.focus();})()",
        );
        await propertyKey('Backspace', 'Backspace', 8);
        await wait(
          "document.querySelector('[aria-label=项目目标日]').dataset.observedBadInput==='true'",
        );
        await wait(
          "document.querySelector('.project-properties [role=alert]')?.textContent.includes('输入已保留')",
        );
        if ((await read(current.id)).projects[0].version !== current.version)
          throw new Error('Native incomplete date remained savable');
        const connection = openToolchainProbe(
          join(isolation.userData, 'caselite.sqlite'),
          join(process.resourcesPath, 'migrations'),
        );
        connection.sqlite.exec(
          "CREATE TRIGGER reject_properties BEFORE INSERT ON catalog_activity BEGIN SELECT RAISE(ABORT,'synthetic properties failure'); END",
        );
        try {
          await input('项目目标日', '2024-03-01');
          await input('项目优先级', '4', true);
          await wait(
            "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原属性提交')",
          );
          const failed = await read(current.id);
          if (JSON.stringify(failed.projects[0]) !== JSON.stringify(current))
            throw new Error('Failed attribute save partially committed');
          await capture('properties-save-failed.png');
        } finally {
          connection.sqlite.exec('DROP TRIGGER reject_properties');
          connection.sqlite.close();
        }
        await button('核对原属性提交');
        await wait(
          "!document.querySelector('.project-properties [role=alert]') && !document.querySelector('#project-tab-tasks').disabled",
        );
        writeFileSync(
          join(root, 'properties-native-date.json'),
          JSON.stringify({
            status: 'PASS_REAL',
            badInputBlocked: true,
            sameCanonicalInputRecovered: true,
          }),
        );
        const saved = await read(current.id);
        if (
          saved.projects[0].body_revision !== 1 ||
          JSON.stringify(saved.state) !== JSON.stringify(original.state) ||
          saved.projects[0].attributes?.start_date !== '2024-02-29' ||
          saved.projects[0].attributes?.assignee !== '合成右栏负责人' ||
          (professional &&
            (saved.projects[0].attributes?.professional_fields?.civil_litigation?.court !==
              '合成法院' ||
              saved.projects[0].attributes?.professional_fields?.criminal_litigation?.stage !==
                '合成阶段'))
        )
          throw new Error('Attribute save changed original body');
        await button('返回项目列表');
        await wait("document.querySelector('[aria-label=侧栏项目名称]')");
        await assertPropertyRows('.project-properties');
        await input('项目标签', '列表侧栏,合成');
        if (!(await evaluate("document.querySelector('[aria-label=搜索项目]').disabled")))
          throw new Error('Filtering can discard property draft');
        await assertRemovedControls();
        await wait("!document.querySelector('[aria-label=搜索项目]').disabled");
        if (await evaluate("Boolean(document.querySelector('.workspace-project-back-button'))"))
          throw new Error('List property save opened detail');
        await button(current.title);
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
            if (professional)
              await evaluate(
                "document.querySelector('.project-professional-card').scrollIntoView({block:'center'})",
              );
            await capture(`properties-sidebar-${width}-${theme}.png`);
            await evaluate(
              "document.querySelector('.project-properties [aria-label=项目标签]').scrollIntoView({block:'center'})",
            );
            await assertPropertyRows('.project-properties');
            const reachable = await evaluate(
              `(()=>{const e=document.querySelector('[aria-label=${professional ? '程序阶段' : '项目标签'}]');const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,viewportHeight:innerHeight};})()`,
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
        if (final.projects[0].attributes?.start_date !== '2024-02-29')
          throw new Error('List save cleared legacy project date');
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
        if (project.archived_at) await select('筛选项目状态', 'archived');
        await button(project.title);
        await wait("document.querySelector('[aria-label=编辑项目名称]')");
        if (professional && process.env.CASELITE_PROJECT_PROPERTIES !== 'preview') {
          await wait("document.querySelector('[aria-label=办案机关]')?.value==='合成办案机关'");
          await input('项目类型', 'civil_litigation', true);
          await wait("document.querySelector('[aria-label=受理法院]')?.value==='合成法院'");
          await evaluate(
            "document.querySelector('.project-professional-card').scrollIntoView({block:'center'})",
          );
          await capture('professional-reopened-civil.png');
        }
        if (professional)
          await evaluate(
            "document.querySelector('.project-professional-card').scrollIntoView({block:'center'})",
          );
        await assertPropertyRows('.project-properties');
        await capture('properties-reopened.png');
        if (process.env.CASELITE_PROJECT_PROPERTIES === 'preview') {
          window.setTitle(
            professional
              ? 'CaseLite · 项目专业卡 · 同一合成工作区'
              : 'CaseLite · 项目属性 · 同一合成工作区',
          );
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
    const discussionMode = process.env.CASELITE_PROJECT_DISCUSSION_TEST;
    if (discussionMode) {
      if (discussionMode !== 'write' && discussionMode !== 'read')
        throw new Error('Invalid discussion test mode');
      const { task } = JSON.parse(readFileSync(join(root, 'promotion-expected.json'), 'utf8'));
      const projectId = task.matter_id;
      const labels = ['项目评论', '项目更新', '更新评论'];
      const samples = [
        '合成项目整体意见。',
        '合成项目更新：资料已整理。',
        '合成回复：已检查资料。',
      ];
      const read = async (request: object): Promise<CatalogResponse> =>
        evaluate(`window.caselite.catalog(${JSON.stringify({ protocol_version: 1, ...request })})`);
      const readProject = () => read({ operation: 'read_project', id: projectId });
      const readActivity = () =>
        read({
          operation: 'list_activity',
          scope: { type: 'project', id: projectId },
          offset: 0,
        });
      const before = { project: await readProject(), activity: await readActivity() };
      if (!before.project.ok || !before.activity.ok) throw new Error('Missing discussion seed');

      await button('独立任务转项目验收');
      const published = async (index: number) => {
        const selector = `[aria-label="已发布${labels[index]}"]`;
        await wait(
          `document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(samples[index])})`,
        );
        return evaluate(
          `document.querySelector(${JSON.stringify(selector)}).closest('article').dataset.discussionId`,
        );
      };
      const fill = async (index: number) => {
        const selector = `[aria-label="${labels[index]}"][contenteditable=true]`;
        await wait(`document.querySelector(${JSON.stringify(selector)})`);
        await evaluate(`(() => {
          const editor = document.querySelector(${JSON.stringify(selector)});
          editor.focus();
          document.execCommand('insertText', false, ${JSON.stringify(samples[index])});
        })()`);
      };
      const ids = [];
      if (discussionMode === 'write') {
        await fill(0);
        const db = openToolchainProbe(
          join(isolation.userData, 'caselite.sqlite'),
          join(process.resourcesPath, 'migrations'),
        ).sqlite;
        db.exec(
          "CREATE TRIGGER reject_discussion_receipt BEFORE INSERT ON catalog_receipts BEGIN SELECT RAISE(ABORT,'synthetic discussion receipt failure'); END",
        );
        try {
          await button('发布项目评论');
          await wait("document.querySelector('.project-discussion [role=alert]')");
          await wait(
            "document.querySelector('[aria-label=项目评论][role=textbox]').textContent.includes('合成项目整体意见') && document.querySelector('#project-tab-activity').disabled && !document.querySelector('[data-discussion-id]')",
          );
          await capture('discussion-failed-draft.png');
        } finally {
          db.exec('DROP TRIGGER reject_discussion_receipt');
          db.close();
        }
        await button('核对原发布');
      }
      ids.push(await published(0));
      await button('活动');
      if (discussionMode === 'write') {
        await fill(1);
        await button('发布项目更新');
      }
      ids.push(await published(1));
      await button('查看与评论更新');
      if (discussionMode === 'write') {
        await fill(2);
        await button('发布更新评论');
      }
      ids.push(await published(2));
      if (
        JSON.stringify(before) !==
        JSON.stringify({ project: await readProject(), activity: await readActivity() })
      )
        throw new Error('Discussion changed project or system activity');
      if (
        (await evaluate(
          "document.querySelectorAll('#project-panel-activity [data-discussion-id]').length",
        )) !== 2
      )
        throw new Error('Duplicate activity discussion');
      const fixture = { ids, before };
      const expectedPath = join(root, 'discussion-expected.json');
      if (discussionMode === 'write') writeFileSync(expectedPath, JSON.stringify(fixture));
      else if (readFileSync(expectedPath, 'utf8') !== JSON.stringify(fixture))
        throw new Error('Reopen changed discussion, description, or activity');
      for (const [width, theme] of [
        [1440, 'light'],
        [640, 'dark'],
      ] as const) {
        window.setSize(width, 900);
        await wait(`innerWidth === ${width}`);
        await evaluate(
          `document.documentElement.dataset.theme = '${theme}'; document.querySelector('[aria-label=已发布更新评论]').scrollIntoView({block:'center'});`,
        );
        const fits =
          await evaluate(`Array.from(document.querySelectorAll('#project-panel-activity .project-discussion button')).every(button => {
          const rect = button.getBoundingClientRect();
          return !rect.width || (rect.left >= 0 && rect.right <= innerWidth + 1);
        }) && document.documentElement.scrollWidth <= innerWidth &&
          document.querySelector('[aria-label=更新评论][role=textbox]').getBoundingClientRect().width >=
            document.querySelector('#project-panel-activity .project-discussion').clientWidth - 100`);
        if (!fits) throw new Error('Discussion input did not fit the viewport');
        await capture(`discussion-${discussionMode}-${width}-${theme}.png`);
      }
      if (discussionMode === 'read') {
        await select('项目状态', 'archived');
        await wait(
          "document.querySelector('[aria-label=项目状态]').value==='archived' && !document.querySelector('#project-panel-activity .project-discussion [contenteditable=true]')",
        );
        if ((await published(2)) !== ids[2])
          throw new Error('Archiving hid the original discussion');
        await button('收起讨论');
        await button('查看与评论更新');
        if ((await published(2)) !== ids[2])
          throw new Error('Archived update discussion did not reopen');
        await capture('discussion-archived.png');
      }
      assertNoRuns();
      writeFileSync(
        join(root, `discussion-${discussionMode}.json`),
        JSON.stringify({
          status: 'PASS_REAL',
          ids,
          providerDispatches: 0,
          isolation,
        }),
      );
      return;
    }
    const routeMode = process.env.CASELITE_PROJECT_ROUTES_TEST;
    if (routeMode) {
      if (!['seed', 'write', 'read'].includes(routeMode))
        throw new Error('Invalid routes test mode');
      const { task: original } = JSON.parse(
        readFileSync(join(root, 'promotion-expected.json'), 'utf8'),
      ) as { task: Extract<TaskResponse, { ok: true }>['tasks'][number] };
      const mutation = () => ({
        protocol_version: 1,
        request_id: randomUUID(),
        idempotency_key: randomUUID(),
      });
      const catalog = async (request: object) => {
        const result: CatalogResponse = await evaluate(
          `window.caselite.catalog(${JSON.stringify({ protocol_version: 1, ...request })})`,
        );
        if (!result.ok) throw new Error(result.message);
        return result;
      };
      const task = async (request: object) => {
        const result: TaskResponse = await evaluate(
          `window.caselite.task(${JSON.stringify({ protocol_version: 1, ...request })})`,
        );
        if (!result.ok) throw new Error(result.message);
        return result;
      };
      const click = async (selector: string) => {
        const target = `document.querySelector(${JSON.stringify(selector)})`;
        await wait(`${target} && !${target}.disabled`);
        await evaluate(`${target}.click()`);
      };
      const list = async () => (await task({ operation: 'list' })).tasks;
      const panel = (name: string) => `#project-panel-${name}:not([hidden])`;
      const link = (name: string, id: string) => `${panel(name)} [data-project-document="${id}"]`;
      const identity = (item: typeof original) => [item.id, item.document_id, item.body_id];
      const read = (id: string) => task({ operation: 'read', task_id: id });
      const navigate = (name: string) => click(`[data-nav=${name}]`);
      const originalProject = original.matter_id;
      const projectTitle = '合成项目乙';
      const secondTitle = '合成项目乙任务';
      const standaloneTitle = '合成独立任务';
      if (routeMode === 'seed') {
        const created = await catalog({
          ...mutation(),
          operation: 'create_project',
          title: projectTitle,
        });
        const second = (
          await task({ ...mutation(), operation: 'create', title: secondTitle, objective: '' })
        ).tasks[0];
        await task({ ...mutation(), operation: 'create', title: standaloneTitle, objective: '' });
        await catalog({
          ...mutation(),
          operation: 'assign_task',
          task_id: second.id,
          expected_version: second.version,
          matter_id: created.target_id,
        });
        return;
      }
      const rows = await list();
      const second = rows.find((row) => row.title === secondTitle);
      const standalone = rows.find((row) => row.title === standaloneTitle);
      if (
        rows.length !== 3 ||
        !second?.matter_id ||
        !standalone ||
        standalone.matter_id ||
        !originalProject ||
        second.matter_id === originalProject ||
        rows.find((row) => row.id === original.id)?.matter_id !== originalProject
      )
        throw new Error('Expected two grouped tasks and one independent Task');
      const openOriginal = async () => {
        await button(original.title);
        await wait(
          `document.querySelector('.catalog-actions')?.dataset.projectId===${JSON.stringify(originalProject)}`,
        );
      };
      const overview = () => catalog({ operation: 'read_project', id: originalProject });
      const before = await overview();
      const files = JSON.parse(readFileSync(join(root, 'files-expected.json'), 'utf8')) as {
        id: string;
        asset_version_id: string;
        sha256: string;
      }[];
      const verifyOriginals = () => {
        for (const file of files) {
          const path = join(
            isolation.userData,
            'materials',
            'originals',
            file.asset_version_id + '.pdf',
          );
          if (createHash('sha256').update(readFileSync(path)).digest('hex') !== file.sha256)
            throw new Error('Original PDF bytes changed');
        }
      };
      verifyOriginals();
      const assertRows = (ids: string[]) =>
        wait(
          `JSON.stringify(Array.from(document.querySelectorAll('[data-row-task]'), e => e.dataset.rowTask).sort())===${JSON.stringify(JSON.stringify(ids.sort()))}`,
        );
      await navigate('tasks');
      await assertRows([original.id, second.id, standalone.id]);
      await select('任务项目范围', second.matter_id);
      await assertRows([second.id]);
      await select('任务项目范围', 'workspace');
      await assertRows([original.id, second.id, standalone.id]);
      await navigate('projects');
      await button(projectTitle);
      await projectTab('tasks');
      await wait(
        `${JSON.stringify(second.id)}===document.querySelector('#project-panel-tasks [data-project-task]')?.dataset.projectTask && document.querySelectorAll('#project-panel-tasks [data-project-task]').length===1`,
      );
      await click('#project-tab-deliverables');
      await wait(
        "document.querySelector('#project-panel-deliverables').textContent.includes('还没有已保存的交付草稿')",
      );
      if (routeMode === 'write') {
        await projectTab('tasks');
        await select('归入已有任务', standalone.id);
        await button('归入项目');
        await wait(
          `document.querySelector('#project-panel-tasks [data-project-task="${standalone.id}"]')`,
        );
        await click(`#project-panel-tasks [data-project-task="${standalone.id}"]`);
        await wait(`document.querySelector('[data-active-task="${standalone.id}"]')`);
        await click('[aria-label="返回来源项目"]');
        await wait(
          `document.activeElement?.dataset.projectTask===${JSON.stringify(standalone.id)}`,
        );
        await click(`#project-panel-tasks [data-project-task="${standalone.id}"] + button`);
        await wait(
          `!document.querySelector('#project-panel-tasks [data-project-task="${standalone.id}"]')`,
        );
        const restored = (await read(standalone.id)).tasks[0];
        if (
          restored.matter_id ||
          JSON.stringify(identity(restored)) !== JSON.stringify(identity(standalone))
        )
          throw new Error('Assignment round trip changed Task identity');
      }
      await button('返回项目列表');
      await openOriginal();
      await wait("document.querySelector('[aria-label=已发布项目评论]')");
      const comment = await evaluate(
        "document.querySelector('[aria-label=已发布项目评论]').textContent",
      );
      await click('#project-tab-files');
      const fileLink = link('files', original.document_id);
      await wait(
        `document.querySelector(${JSON.stringify(fileLink)}) && document.querySelectorAll('#project-panel-files [data-source-id]').length===2`,
      );
      await capture('routes-files.png');
      await click(`${panel('files')} [data-source-id="${files[0].id}"] button`);
      await wait(
        "document.querySelector('.material-paper canvas')?.width>0 && document.querySelector('.material-paper .react-pdf__Page__textContent')?.textContent.length>0",
      );
      await capture('routes-pdf.png');
      await button('收起阅读');
      const checkBody = (sample: string) =>
        wait(
          `document.querySelector('[data-active-task="${original.id}"] [data-testid=body-editor]')?.textContent.includes(${JSON.stringify(sample)})`,
        );
      const returned = (name: string) =>
        wait(
          `document.activeElement === document.querySelector(${JSON.stringify(link(name, original.document_id))}) && document.activeElement?.dataset.projectDocument===${JSON.stringify(original.document_id)}`,
        );
      const append = async (sample: string) => {
        await evaluate(`(() => {
          const editor = document.querySelector('[data-testid=body-editor]');
          editor.focus();
          const selection = window.getSelection();
          selection.selectAllChildren(editor);
          selection.collapseToEnd();
          document.execCommand('insertText', false, ${JSON.stringify(sample)});
        })()`);
        await wait("!document.querySelector('[data-testid=save-body]').disabled");
        await click('[data-testid=save-body]');
        await wait(
          "document.querySelector('[data-testid=save-body]').disabled && document.querySelector('[data-testid=save-status]').textContent.includes('已保存到此设备')",
        );
      };
      const sample1 = '文件入口保存的合成内容。';
      const sample2 = '交付草稿保存的合成内容。';
      await click(fileLink);
      await checkBody('原任务正文与引用保全样本。');
      if (routeMode === 'write') await append(sample1);
      await checkBody(sample1);
      await click('[aria-label="返回来源项目"]');
      await returned('files');
      await click('#project-tab-deliverables');
      const draftLink = link('deliverables', original.document_id);
      await wait(`document.querySelector(${JSON.stringify(draftLink)})`);
      await capture('routes-drafts.png');
      await click(draftLink);
      await checkBody(sample1);
      if (routeMode === 'write') await append(sample2);
      await checkBody(sample2);
      await capture('routes-editor.png');
      await click('[aria-label="返回来源项目"]');
      await returned('deliverables');
      await click(draftLink);
      await checkBody(sample2);
      await click('[aria-label="返回来源项目"]');
      await returned('deliverables');
      if (routeMode === 'write') {
        const archive = async (archived: boolean) => {
          const doc = (await catalog({ operation: 'list' })).documents.find(
            (row) => row.id === original.document_id,
          );
          if (!doc) throw new Error('Missing fixture document');
          await catalog({
            ...mutation(),
            operation: 'archive_document',
            id: doc.id,
            expected_version: doc.version,
            archived,
          });
        };
        await archive(true);
        try {
          await click(draftLink);
          await wait(
            "document.querySelector('.error[role=alert]')?.textContent.includes('文档已归档或已离开来源项目') && document.querySelector('#project-panel-deliverables:not([hidden])') && !document.querySelector('[data-active-task]')",
          );
        } finally {
          await archive(false);
        }
      }
      await projectTab('overview');
      await wait(
        `document.querySelector('[aria-label=已发布项目评论]')?.textContent===${JSON.stringify(comment)}`,
      );
      const after = await overview();
      const saved = (await read(original.id)).tasks[0];
      if (
        JSON.stringify(identity(saved)) !== JSON.stringify(identity(original)) ||
        saved.body_revision !== original.body_revision + 2 ||
        JSON.stringify(after.state) !== JSON.stringify(before.state) ||
        after.projects[0]?.body_revision !== before.projects[0]?.body_revision
      )
        throw new Error('Task route changed identities or project overview');
      verifyOriginals();
      assertNoRuns();
      writeFileSync(
        join(root, `routes-${routeMode}.json`),
        JSON.stringify(
          {
            status: 'PASS_REAL',
            isolation,
            files,
            original: identity(saved),
            revision: saved.body_revision,
            projects: [originalProject, second.matter_id],
            tasks: rows.map(identity),
            providerDispatches: 0,
          },
          null,
          2,
        ),
      );
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
      if (project.archived_at) await select('筛选项目状态', 'archived');
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
        await wait(
          `document.querySelector('.project-catalog-heading h1')?.textContent===${JSON.stringify(title)}`,
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
          await wait(
            "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原属性提交')",
          );
          if (JSON.stringify(await list()) !== JSON.stringify(before))
            throw new Error('Failed save created success activity');
          await capture('project-activity-save-failed.png');
        } finally {
          connection.sqlite.exec('DROP TRIGGER project_probe_reject');
          connection.sqlite.close();
        }
        await button('核对原属性提交');
        await wait(
          "!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='核对原属性提交') && document.querySelector('[aria-label=项目状态]')?.value==='active'",
        );
        const after = await list();
        if (
          after.length !== before.length + 1 ||
          after.filter((e) => e.operation === 'update_project').length !== 1
        )
          throw new Error('Recovery duplicated or lost committed activity');
        await wait(
          "Array.from(document.querySelectorAll('.project-summary [data-activity-id] strong')).some(e=>e.textContent==='更新项目')",
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
        await wait("document.querySelector('[aria-label=返回来源项目]')");
        await evaluate("document.querySelector('[aria-label=返回来源项目]').click()");
        await wait("document.querySelector('.project-summary [data-activity-id]')");
        await assertRemovedControls();
        await projectTab('tasks');
        await button('移出项目');
        await wait("!document.querySelector('#project-tab-overview').disabled");
        await projectTab('overview');
        await wait(
          "document.querySelector('.project-summary-counts dd')?.textContent==='0' && document.querySelector('.project-summary .project-files')?.textContent.includes('项目还没有已登记材料')",
        );
        await projectTab('tasks');
        await evaluate(
          `(()=>{const select=document.querySelector('[aria-label=归入已有任务]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(expected.task.id)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await button('归入项目');
        await wait("!document.querySelector('#project-tab-overview').disabled");
        const memberButton = `document.querySelector('#project-panel-tasks [data-project-task="${expected.task.id}"]')`;
        await wait(`${memberButton} && !${memberButton}.disabled`);
        await evaluate(`${memberButton}.click()`);
        await wait(
          `document.querySelector('[data-active-task="${expected.task.id}"]') && document.querySelector('[aria-label=返回来源项目]')`,
        );
        await evaluate("document.querySelector('[aria-label=返回来源项目]').click()");
        await wait("document.querySelector('#project-tab-tasks[aria-selected=true]')");
        await wait(
          `document.activeElement?.dataset.projectTask===${JSON.stringify(expected.task.id)}`,
        );
        await projectTab('overview');
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
      await showTaskResult();
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.textContent.includes('原任务正文与引用保全样本。')",
      );
      const taskActivityRequest = {
        protocol_version: 1,
        operation: 'list_activity',
        scope: { type: 'task', id: expected.task.id },
        offset: 0,
      };
      const taskActivity = await evaluate(
        `window.caselite.catalog(${JSON.stringify(taskActivityRequest)})`,
      );
      if (!taskActivity.ok || !taskActivity.activity?.length)
        throw new Error('Original Task activity is no longer readable');
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
        await showTaskResult();
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
        if (professional) {
          await input('项目类型', 'commercial_arbitration', true);
          await input('仲裁机构', '合成仲裁机构');
          await evaluate(
            "document.querySelector('.project-professional-card').scrollIntoView({block:'center'})",
          );
        }
        await assertPropertyRows('dialog[open]');
        await capture('project-from-task.png');
        await button('保存项目');
        await wait("!document.querySelector('dialog[open]')");
        await wait(
          "!Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='从任务创建项目')",
        );
        await wait(
          "document.querySelector('[data-testid=task-project-context]')?.textContent==='独立任务转项目验收'",
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
        if (professional)
          await wait("document.querySelector('[aria-label=仲裁机构]')?.value==='合成仲裁机构'");
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
        await projectTab('overview');
        await wait("document.querySelector('#project-panel-overview')?.hidden===false");
        await evaluate(
          "document.querySelector('.project-summary-records > section:nth-child(2) button').click()",
        );
        await wait(
          `document.querySelector('[data-active-task]')?.dataset.activeTask===${JSON.stringify(expected.task.id)}`,
        );
        await showTaskResult();
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
      if (restored) await select('筛选项目状态', 'archived');
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
        await wait(
          "document.querySelector('.project-catalog-heading h1')?.textContent==='验收项目（已编辑）'",
        );
        await wait(`document.querySelector('[data-editor-mode=compact] [aria-expanded=false]')
          && !document.querySelector('[data-editor-mode=compact] [role=toolbar]')
          && !document.querySelector('.project-property-heading')
          && document.querySelector('.project-professional-card summary')?.textContent.trim()==='领域'`);
        app.focus({ steal: true });
        window.focus();
        window.webContents.focus();
        await wait('document.hasFocus()');
        await evaluate(`(() => {
          const body = document.querySelector('[data-testid=project-overview-editor]');
          body.focus();
          window.getSelection().selectAllChildren(body.querySelector('p'));
          document.dispatchEvent(new Event('selectionchange'));
        })()`);
        await wait("document.querySelector('[aria-label=选区格式] [aria-label=加粗]')");
        const editorBounds = window.getBounds();
        for (const [width, theme] of [
          [1440, 'light'],
          [640, 'dark'],
        ] as const) {
          window.setSize(width, 900);
          await wait(`innerWidth === ${width}`);
          await evaluate(`document.documentElement.dataset.theme = '${theme}'`);
          const fits = await evaluate(`(() => {
            const editor = document.querySelector('[data-editor-mode=compact]').getBoundingClientRect();
            const tools = document.querySelector('[aria-label=选区格式]').getBoundingClientRect();
            return tools.width > 0 && tools.left >= editor.left - 1 &&
              tools.right <= Math.min(innerWidth, editor.right + 1) && tools.top >= 0;
          })()`);
          if (!fits) throw new Error('Selection tools overflow the project overview');
          await capture(`overview-selection-${width}-${theme}.png`);
        }
        await evaluate("document.querySelector('[aria-label=选区格式] [aria-label=加粗]').click()");
        await wait("document.querySelector('[data-testid=project-overview-editor] strong')");
        await evaluate("document.querySelector('.compact-format-toggle').focus()");
        await wait("document.activeElement?.matches('.compact-format-toggle')");
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
        await wait("document.querySelector('[aria-label=文档格式] [aria-label=段落样式]')");
        await button('格式工具');
        window.setBounds(editorBounds);
        await evaluate("document.documentElement.dataset.theme = 'light'");
        await button('保存项目概述');
        await wait(
          "Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent.includes('说明修订 1'))",
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
        await assertRemovedControls();
        await capture('project-edited.png');
        await select('项目状态', 'archived');
        await wait(
          "document.querySelector('[aria-label=编辑项目名称]')?.disabled && document.querySelector('[aria-label=项目状态]').value==='archived' && !document.querySelector('[aria-label=项目状态]').disabled",
        );
        const archived: CatalogResponse = await evaluate(
          "window.caselite.catalog({operation:'list',protocol_version:1})",
        );
        if (!archived.ok || !archived.projects[0].archived_at)
          throw new Error('Archive was not persisted');
        if (
          !(await evaluate(
            "document.querySelector('[aria-label=项目状态]').value==='archived' && !document.querySelector('[data-testid=project-overview-editor]').isContentEditable && !document.querySelector('.compact-format-toggle')",
          ))
        )
          throw new Error('Archived project remains writable');
        await capture('project-archived.png');
      }
      if (restored) {
        await wait(
          "document.querySelector('[aria-label=编辑项目名称]')?.disabled && document.querySelector('[aria-label=项目状态]').value==='archived' && !document.querySelector('[aria-label=项目状态]').disabled",
        );
        await select('项目状态', 'restore');
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
            "document.querySelector('[data-testid=project-overview-editor] strong')?.textContent.includes('项目概述：保存与归档恢复验收。')",
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
