import { createAgentCredentials } from './adapters/agent-credentials';
import { app, BrowserWindow, nativeImage, session } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// 仅在宿主校验过的临时合成目录运行；不触碰正常用户数据，也不开放调试端口。
export async function runTaskDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  const isolation = {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    sessionStorage: session.defaultSession.storagePath,
    sqlite: join(app.getPath('userData'), 'caselite.sqlite'),
    credentials: ['openai-credential.enc', 'deepseek-credential.enc'].map((name) =>
      join(app.getPath('userData'), name),
    ),
    originals: 'N/A: managed AssetVersion storage is not implemented in this Task/body slice',
    credentialEvidence: 'System encryption of synthetic keys only; real provider requests NOT_RUN',
  };
  if (
    [isolation.userData, isolation.sessionData, isolation.sessionStorage].some(
      (path) => !path || !path.startsWith(root + sep),
    )
  )
    throw new Error('Demo application data or browser cache escaped isolation');
  writeFileSync(join(root, 'isolation.json'), JSON.stringify(isolation, null, 2));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow();
  // 合成演示需要稳定绘制帧；产品窗口的后台节流策略不变。
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') writeFileSync(join(root, 'renderer-error.txt'), event.message);
  });
  window.webContents.debugger.attach('1.3');
  try {
    const setViewport = async (width: number, height: number) => {
      window.setContentSize(width, height);
      // 仅合成测试使用固定桌面视口；不让小屏原生窗口限制改变1080p布局，正常产品保持系统缩放。
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: false,
      });
      // 导航栏宽度有过渡动画；等待布局达到断言目标，避免把过渡帧当最终布局。
      for (let i = 0; i < 150; i++) {
        const settled = await window.webContents.executeJavaScript(`(()=>{
          const nav = document.querySelector('.primary-sidebar');
          if (!nav) return false;
          const expected = document.querySelector('.workbench.is-collapsed') ? 65 : ${width} > 1250 ? 200 : 180;
          return Math.abs(nav.getBoundingClientRect().width - expected) <= 1;
        })()`);
        if (settled) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`Navigation layout did not settle at viewport ${width}x${height}`);
    };
    await setViewport(1920, 1080);
    const evaluate = (code: string) => window.webContents.executeJavaScript(code);
    const wait = async (predicate: string) => {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(`Boolean(${predicate})`)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      writeFileSync(join(root, 'failure-ui.txt'), await evaluate('document.body.innerText'));
      await capture('failure.png');
      throw new Error('Task demo timed out: ' + predicate);
    };
    const shellMeasurements: unknown[] = [];
    const homeGeometry = new Map<number, number[]>();
    const capture = async (name: string) => {
      await evaluate(
        'Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))),new Promise(resolve=>setTimeout(resolve,2000))])',
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      const size = await evaluate('({width:innerWidth,height:innerHeight,ratio:devicePixelRatio})');
      const shell = await evaluate(`(()=>{
        const profile=document.querySelector('.profile-settings');
        const nav=document.querySelector('.primary-sidebar').getBoundingClientRect();
        const rect=profile.getBoundingClientRect();
        const center=document.querySelector('.task-work-area, .agent-main, .collection-main');
        const right=document.querySelector('.task-inspector, .agent-context, .project-properties');
        const c=center?.getBoundingClientRect(), r=right?.getBoundingClientRect();
        const header=document.querySelector('header[aria-label="工作台顶部栏"]');
        const h=header?.getBoundingClientRect();
        return {page:document.querySelector('[data-nav][aria-current=page]')?.getAttribute('data-nav'),
          width:innerWidth, height:innerHeight, navWidth:nav.width,
          alerts:Array.from(document.querySelectorAll('.workspace-main > [role=alert]')).map(e=>e.textContent),
          centerLeft:c?.left, centerRight:c?.right, rightWidth:r?.width,
          geometry:c && r ? [c.left,c.top,c.width,c.height,r.left,r.top,r.width,r.height] : null,
          legacyHeaderAbsent:!document.querySelector('.global-bar, .brand-caption'),
          headerValid:Boolean(h && h.left===0 && h.top===0 && Math.abs(h.width-innerWidth)<=1 && h.height===48 && header.querySelector('.workspace-navigation-toggle[aria-controls="primary-navigation"]') && !header.querySelector('input, [data-testid=new-task], .collection-search') && (!c || c.top===h.bottom) && (!r || r.top===h.bottom)),
          profileValid:rect.left>=nav.left && rect.right<=nav.right && rect.bottom>=innerHeight-20 && rect.bottom<=innerHeight && Boolean(profile.querySelector('.profile-avatar')) && Boolean(profile.querySelector('.profile-name'))};
      })()`);
      if (!shell.legacyHeaderAbsent || !shell.headerValid || !shell.profileValid)
        throw new Error('Workspace header or bottom profile regression: ' + JSON.stringify(shell));
      if (shell.centerLeft !== undefined) {
        const navWidth = size.width > 1250 ? 200 : 180,
          rightWidth = size.width > 1250 ? 300 : 250;
        if (
          Math.abs(shell.navWidth - navWidth) > 1 ||
          Math.abs(shell.centerLeft - navWidth) > 1 ||
          Math.abs(shell.rightWidth - rightWidth) > 1 ||
          Math.abs(shell.centerRight - (size.width - rightWidth)) > 1
        )
          throw new Error('Shared workspace dimensions diverged: ' + JSON.stringify(shell));
      }
      if (shell.page === 'home' && shell.geometry) homeGeometry.set(size.width, shell.geometry);
      if (
        ['tasks', 'documents', 'knowledge'].includes(shell.page) &&
        shell.geometry &&
        homeGeometry.has(size.width)
      ) {
        const baseline = homeGeometry.get(size.width)!;
        if (
          shell.geometry.some(
            (value: number, index: number) => Math.abs(value - baseline[index]) > 1,
          )
        )
          throw new Error('Workspace does not match Home dimensions: ' + JSON.stringify(shell));
      }
      shellMeasurements.push({ capture: name, ...shell });
      writeFileSync(join(root, 'shell-layout.json'), JSON.stringify(shellMeasurements, null, 2));

      // 只从当前隔离测试的同一渲染表面捕获完整视口，不开启调试端口，也不拉伸补画PNG。
      const snapshot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
      });
      const bytes = Buffer.from(snapshot.data, 'base64');
      const frame = nativeImage.createFromBuffer(bytes);
      if (
        frame.getSize().width !== Math.round(size.width * size.ratio) ||
        frame.getSize().height !== Math.round(size.height * size.ratio)
      )
        throw new Error(
          'Screenshot does not match the complete viewport and DPR: ' +
            JSON.stringify({ size, pixels: frame.getSize() }),
        );
      writeFileSync(join(root, name), bytes);
      if (name === 'three-column-ai.png') {
        const viewport = await evaluate(
          '({width:innerWidth,height:innerHeight,devicePixelRatio,zoom:visualViewport.scale})',
        );
        writeFileSync(
          join(root, 'layout.json'),
          JSON.stringify(
            {
              mode: 'Electron desktop viewport emulation at 100%; physical window is screen-limited',
              viewport,
              capturedPixels: frame.getSize(),
            },
            null,
            2,
          ),
        );
      }
    };
    const click = async (selector: string) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const button = async (label: string) =>
      evaluate(
        `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
    const input = async (selector: string, value: string) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(e.isContentEditable){e.focus();const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,${JSON.stringify(value)});}else{const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}})()`,
      );
    await wait(
      "document.querySelector('[data-testid=agent-input]') && !document.body.textContent.includes('正在读取')",
    );
    const openTask = async (id: string) => {
      await click('[data-nav=tasks]');
      await wait("document.querySelector('.list-view')");
      await click(`[data-row-task="${id}"]`);
      await wait(
        `document.querySelector('[data-row-task="${id}"]')?.getAttribute('aria-current')==='true'`,
      );
      await click(`[data-row-task="${id}"] .task-row-title`);
    };
    const navLabels = await evaluate(
      "Array.from(document.querySelectorAll('.primary-navigation button')).map(e=>e.getAttribute('aria-label'))",
    );
    if (JSON.stringify(navLabels) !== JSON.stringify(['首页', '任务', '项目', '文档', '知识库']))
      throw new Error('Primary navigation does not match the approved five entries');
    const selectAllText = async (selector: string) => {
      // 富文本选区工具条依赖原生窗口焦点；隔离演示先取得焦点，不放宽格式断言。
      app.focus({ steal: true });
      window.focus();
      window.webContents.focus();
      await wait('document.hasFocus()');
      await evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();const range=document.createRange();range.selectNodeContents(e);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));})()`,
      );
    };
    const insertText = async (text: string) =>
      evaluate(`document.execCommand('insertText',false,${JSON.stringify(text)})`);
    const taskGoalTab = async () =>
      evaluate(
        "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='内容').click()",
      );
    const bodyTab = async () =>
      evaluate(
        "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.startsWith('成果正文')).click()",
      );
    if (phase !== 'write') {
      const vault = await createAgentCredentials(join(root, 'userData'));
      if (
        vault.get('deepseek') !== 'sk-synthetic-restart-deepseek' ||
        vault.getDefaultModel() !== 'deepseek-v4-pro'
      )
        throw new Error('DeepSeek key/default did not survive process restart');
      const profile = await evaluate(
        "window.caselite.agent({protocol_version:1,operation:'profile'})",
      );
      if (!profile.ok || profile.model !== 'deepseek-v4-pro' || !profile.providers.deepseek)
        throw new Error('Host profile failed to read persisted DeepSeek settings');
    }
    if (phase === 'write') {
      await click('[data-nav=tasks]');
      await wait(
        "document.querySelector('.inspector-empty') && document.querySelectorAll('[data-row-task]').length===0",
      );
      await click('[data-nav=home]');
      await wait("document.querySelector('.agent-home [data-testid=agent-input]')");
      await wait("document.querySelector('[data-testid=agent-input]').tagName==='TEXTAREA'");
      await capture('agent-composer-empty.png');
      await input('[data-testid=agent-input]', '核对两份材料的事实、矛盾及缺件，形成内部沟通初稿');
      await wait(
        "document.querySelector('[data-testid=agent-input]').value.includes('事实、矛盾')",
      );
      await capture('agent-composer-filled.png');
      await click('[data-nav=tasks]');
      await wait("document.querySelector('[data-testid=new-task]')");
      await click('[data-testid=new-task]');
      await wait("document.querySelector('[data-testid=task-title]')");
      await input(
        '[data-testid=task-objective]',
        '核对两份材料的事实、矛盾及缺件，形成内部沟通初稿',
      );
      await wait(
        "document.querySelector('[data-testid=task-objective]').textContent==='核对两份材料的事实、矛盾及缺件，形成内部沟通初稿'",
      );
      const createWidth = await evaluate(
        "document.querySelector('.create-form').getBoundingClientRect().width",
      );
      if (createWidth < 700)
        throw new Error('Task creation form is too narrow on the wide desktop');
      await capture('task-create-light.png');
      await evaluate("document.documentElement.dataset.theme='dark'");
      await capture('task-create-dark.png');
      await evaluate("document.documentElement.dataset.theme='light'");
      await input('[data-testid=task-objective]', '/');
      await wait("document.querySelector('.create-objective [data-block-command=heading2]')");
      await click('.create-objective [data-block-command=heading2]');
      await insertText('核对两份材料的事实、矛盾及缺件，形成内部沟通初稿');
      await selectAllText('[data-testid=task-objective]');
      await wait("document.querySelector('.create-objective [aria-label=选区格式]')");
      await wait(`(()=>{
        const toolbar=document.querySelector('.create-objective .selection-tools')?.getBoundingClientRect();
        const heading=document.querySelector('[data-testid=task-objective] h2')?.getBoundingClientRect();
        return toolbar && heading && toolbar.bottom<=heading.top+2;
      })()`);
      await click('.create-objective [aria-label=选区格式] [aria-label=加粗]');
      await wait("document.querySelector('[data-testid=task-objective] h2 strong')");
      await input('[data-testid=task-title]', '服务合同事实梳理');
      await click('[data-testid=create-task]');
      await wait("document.querySelector('[data-testid=task-result-tab]')");
      await bodyTab();
      await wait("document.querySelector('[data-testid=body-editor]')");
      const body =
        '合同记载服务费120,000元；补充记录称100,000元，差异待核验。现有材料未提供金额变更文件、发票及收悉凭证。请补充文件并解释金额差异。';
      await evaluate(
        `document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,${JSON.stringify(body)})`,
      );
      await wait("document.querySelector('.document [data-editor-mode=simple] .simple-toolbar')");
      await selectAllText('[data-testid=body-editor]');
      await click('.simple-toolbar [aria-label=加粗]');
      await wait("document.querySelector('[data-testid=body-editor] strong')");
      await evaluate(
        "document.querySelector('.assistant-panel--compact')?.scrollIntoView({block:'nearest'})",
      );
      await wait(
        "document.querySelector('.assistant-panel--compact') && document.querySelector('[data-testid=body-editor]')",
      );
      await evaluate(
        "document.querySelector('.task-inspector details > summary').scrollIntoView({block:'start'})",
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
      const id = await evaluate(
        "document.querySelector('[data-active-task]').getAttribute('data-active-task')",
      );
      await click('[data-testid=toggle-favorite]');
      await wait(`document.querySelector('[data-task-id="${id}"]')`);
      await click('[data-testid=toggle-favorite]');
      await wait(`!document.querySelector('[data-task-id="${id}"]')`);
      await click('[data-testid=toggle-favorite]');
      await wait(`document.querySelector('[data-task-id="${id}"]')`);
      await taskGoalTab();
      await wait("document.querySelector('[data-testid=task-content-editor] h2 strong')");
      await evaluate("document.querySelector('[data-testid=task-content-editor]').focus()");
      await click('.task-content-panel .compact-format-toggle');
      await click('.task-content-panel [aria-label=插入内容块]');
      await wait("document.querySelector('.task-content-panel [data-block-command=heading3]')");
      await click('.task-content-panel [data-block-command=heading3]');
      await insertText('待补收悉凭证');
      await wait(
        "document.querySelector('[data-testid=task-content-editor] h3')?.textContent==='待补收悉凭证'",
      );
      for (const action of ['复制块', '删除块']) {
        await click('.task-content-panel [aria-label=块操作]');
        await evaluate(
          `Array.from(document.querySelectorAll('.task-content-panel [role=menuitem]')).find(e=>e.textContent===${JSON.stringify(action)}).click()`,
        );
      }
      await wait(
        "document.querySelectorAll('[data-testid=task-content-editor] h3').length===1 && document.querySelector('[data-testid=task-content-editor] h2 strong')",
      );
      const goal = await evaluate(
        "document.querySelector('[data-testid=task-content-editor]').textContent",
      );
      await click('[data-testid=save-task-content]');
      await wait(
        "document.querySelector('[data-testid=task-content-status]')?.textContent==='任务内容已保存'",
      );
      if (
        await evaluate(
          "Boolean(document.querySelector('.workspace-main > .error [aria-label=关闭提示]'))",
        )
      )
        await click('.workspace-main > .error [aria-label=关闭提示]');
      await wait("!document.querySelector('.workspace-main > .error')");
      await capture('task-content.png');
      await bodyTab();
      await wait(
        `document.querySelector('[data-testid=body-editor]')?.textContent===${JSON.stringify(body)} && document.querySelector('[data-testid=body-editor] strong')`,
      );
      writeFileSync(join(root, 'expected.json'), JSON.stringify({ id, body, goal }));
      const vault = await createAgentCredentials(join(root, 'userData'));
      await vault.set('sk-synthetic-restart-deepseek', 'deepseek');
      await vault.setDefaultModel('deepseek-v4-pro');
      await click('[data-nav=home]');
      await wait("document.querySelector('[data-testid=agent-input]')");
      await input('[data-testid=agent-input]', '独立任务B，不应显示A的正文');
      await click('[data-nav=tasks]');
      await wait("document.querySelector('[data-testid=new-task]')");
      await click('[data-testid=new-task]');
      await wait("document.querySelector('[data-testid=task-title]')");
      await input('[data-testid=task-title]', '采购任务隔离样本B');
      await input('[data-testid=task-objective]', '独立任务B，不应显示A的正文');
      await click('[data-testid=create-task]');
      await wait(
        "document.querySelector('[data-testid=task-content-editor]') && document.body.textContent.includes('采购任务隔离样本B')",
      );
      await click(`[data-task-id="${id}"]`);
      await wait("document.querySelector('[data-testid=task-result-tab]')");
      await bodyTab();
      await wait(
        `document.querySelector('[data-testid=body-editor]')?.textContent.includes(${JSON.stringify(body)})`,
      );
    } else {
      const expected = JSON.parse(readFileSync(join(root, 'expected.json'), 'utf8'));
      await openTask(expected.id);
      await wait("document.querySelector('[data-testid=task-result-tab]')");
      await bodyTab();
      await wait("document.querySelector('[data-testid=body-editor]')");
      await wait(
        `document.querySelector('[data-testid=body-editor]')?.textContent.includes(${JSON.stringify(expected.body)})`,
      );
      await taskGoalTab();
      await wait(
        `document.querySelector('[data-testid=task-content-editor]')?.textContent===${JSON.stringify(expected.goal)} && document.querySelector('[data-testid=task-content-editor] h2 strong') && document.querySelector('[data-testid=task-content-editor] h3')`,
      );
      await bodyTab();
      await wait(
        `document.querySelector('[data-testid=body-editor]')?.textContent===${JSON.stringify(expected.body)} && document.querySelector('[data-testid=body-editor] strong')`,
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
        "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent==='内容').click()",
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
    if (phase === 'write') {
      const expected = JSON.parse(readFileSync(join(root, 'expected.json'), 'utf8'));
      await click('[data-nav=projects]');
      await wait("document.querySelector('[data-testid=project-catalog]')");
      await button('创建项目');
      await input('[aria-label=项目名称]', '本地项目验收样本');
      await button('保存项目');
      await wait(
        "document.querySelector('[data-project-id]') && !document.querySelector('[aria-label=项目名称]')",
      );
      expected.projectId = await evaluate(
        "document.querySelector('[data-project-id]').dataset.projectId",
      );
      await wait("document.querySelector('[data-testid=project-overview-editor]')");
      await input('[data-testid=project-overview-editor]', '项目说明重启保全：梳理事实与缺件。');
      await selectAllText('[data-testid=project-overview-editor]');
      await wait("document.querySelector('.catalog-actions [aria-label=选区格式]')");
      await click('.catalog-actions [aria-label=选区格式] [aria-label=加粗]');
      await wait("document.querySelector('[data-testid=project-overview-editor] strong')");
      await button('保存项目概述');
      await wait(
        "document.querySelector('[data-testid=project-overview-editor] strong')?.textContent.includes('项目说明重启保全') && Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent.includes('说明修订 1'))",
      );
      await click('#project-tab-tasks');
      await evaluate(
        `(()=>{const e=document.querySelector('[aria-label=归入已有任务]');e.value=${JSON.stringify(expected.id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await button('归入项目');
      await wait("document.querySelector('.project-properties')?.textContent.includes('1 个任务')");
      const task = await evaluate(
        `window.caselite.task({operation:'read',protocol_version:1,task_id:${JSON.stringify(expected.id)}})`,
      );
      if (!task.ok || task.tasks[0].matter_id !== expected.projectId)
        throw new Error('Original Task association failed');
      expected.documentId = task.tasks[0].document_id;
      await click('[data-nav=documents]');
      await wait("document.querySelector('[data-document-id]')");
      await click(`[data-document-id="${expected.documentId}"]`);
      await button('编辑分类与标签');
      await input('[aria-label=文档分类]', '内部资料');
      await input('[aria-label=文档标签]', '验收');
      await button('保存分类');
      await wait(
        "!document.querySelector('[aria-label=文档分类]') && document.querySelector('.catalog-table')?.textContent.includes('内部资料')",
      );
      await button('收藏文档');
      await wait(
        "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='取消收藏')",
      );
      await button('加入知识库');
      await wait(
        "Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='移出知识库')",
      );
      writeFileSync(join(root, 'expected.json'), JSON.stringify(expected));
      await openTask(expected.id);
      await wait("document.querySelector('[data-testid=task-result-tab]')");
      await bodyTab();
      await wait("document.querySelector('[data-testid=body-editor]')");
    }
    await wait(`(()=>{
      const shell=document.querySelector('.workbench');
      const top=document.querySelector('.workspace-topbar');
      const nav=document.querySelector('.primary-sidebar');
      const main=document.querySelector('.workspace-main');
      const toggle=document.querySelector('.workspace-topbar [aria-label="收起导航"]');
      if (!shell || !top || !nav || !main || !toggle) return false;
      const t=top.getBoundingClientRect(), n=nav.getBoundingClientRect(), m=main.getBoundingClientRect();
      return getComputedStyle(shell).display==='grid' && Math.abs(t.height-48)<=1 &&
        t.left===0 && Math.abs(t.right-innerWidth)<=1 && n.top>=t.bottom-1 &&
        m.top>=t.bottom-1 && n.right<=m.left+1;
    })()`);
    await click('.workspace-topbar [aria-label="收起导航"]');
    await wait(
      "document.querySelector('.workbench.is-collapsed') && document.querySelector('.workspace-topbar [aria-label=展开导航]') && Math.abs(document.querySelector('.primary-sidebar').getBoundingClientRect().width-65)<=1",
    );
    await click('.workspace-topbar [aria-label="展开导航"]');
    await wait(
      "!document.querySelector('.workbench.is-collapsed') && document.querySelector('.workspace-topbar [aria-label=收起导航]') && Math.abs(document.querySelector('.primary-sidebar').getBoundingClientRect().width-200)<=1",
    );
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
      const density = await evaluate(`(()=>{
      const editor = document.querySelector('[data-testid=body-editor]').getBoundingClientRect();
      const tabs = document.querySelector('.detail-tabs').getBoundingClientRect();
      const topbar = document.querySelector('.workspace-topbar').getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,scale:visualViewport.scale,tabs:tabs.height,editorTop:editor.top,topbarHeight:topbar.height};
    })()`);
      if (
        density.width !== 1920 ||
        density.height !== 1080 ||
        density.scale !== 1 ||
        density.tabs > 34 ||
        density.editorTop - density.topbarHeight >= 240
      )
        throw new Error(
          '1080p viewport or compact editor geometry does not match: ' + JSON.stringify(density),
        );
      await click('[data-testid=toggle-favorite]');
      await wait("document.querySelector('[data-task-id]')");
      await evaluate(
        "document.querySelector('.assistant-panel--compact')?.scrollIntoView({block:'nearest'})",
      );
      await wait(
        "document.querySelector('.assistant-panel--compact') && document.querySelector('[data-testid=revision]')?.textContent==='2'",
      );
      await capture('three-column-ai.png');
      await setViewport(980, 740);
      await evaluate(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      await assertColumns();
      await capture('three-column-compact.png');
      await setViewport(1920, 1080);
      await evaluate(
        "document.querySelector('.task-inspector details > summary').scrollIntoView({block:'start'})",
      );
      await click('[data-nav=home]');
      await wait("document.querySelector('.home-view')");
      const assertCollectionColumns = async (centerSelector: string, rightSelector: string) => {
        const valid = await evaluate(`(()=>{
          const left=document.querySelector('.primary-sidebar').getBoundingClientRect();
          const center=document.querySelector(${JSON.stringify(centerSelector)}).getBoundingClientRect();
          const right=document.querySelector(${JSON.stringify(rightSelector)}).getBoundingClientRect();
          return left.right<=center.left+1 && center.width>=300 && center.right<=right.left+1 && right.width>=240 && right.right<=innerWidth+1 && right.bottom<=innerHeight+1;
        })()`);
        if (!valid) throw new Error('Collection three-column geometry failed: ' + centerSelector);
      };
      await assertCollectionColumns('.agent-main', '.agent-context');
      await capture('home.png');
      await setViewport(980, 740);
      await capture('home-compact.png');
      await setViewport(1920, 1080);
      await click('[data-nav=knowledge]');
      await wait("document.querySelector('.knowledge-view [data-document-id]')");
      await assertCollectionColumns('.collection-main', '.task-inspector');
      await capture('knowledge.png');
      await evaluate(
        "Array.from(document.querySelectorAll('.task-inspector [role=tab]')).find(e=>e.textContent.includes('AI 助手')).click()",
      );
      await wait("document.querySelector('[data-testid=assistant-input]')");
      await capture('knowledge-ai.png');
      await setViewport(980, 740);
      await capture('knowledge-compact.png');
      await setViewport(1920, 1080);
      await click('[data-nav=settings]');
      await wait("document.querySelector('.settings-center')");
      await capture('profile-settings.png');
      await click('.settings-back');
      await wait("document.querySelector('.knowledge-view [data-document-id]')");
      await click('[data-nav=projects]');
      await wait("document.querySelector('[data-testid=project-catalog] [data-project-id]')");
      await assertCollectionColumns('.collection-main', '.project-properties');
      await capture('projects-list.png');
      await button('本地项目验收样本');
      await wait(
        "document.querySelector('[data-testid=project-overview-editor] strong')?.textContent.includes('项目说明重启保全')",
      );
      await capture('project-overview.png');
      await capture('project-editors.png');
      await button('返回项目列表');
      const projectStatus = (value: string) =>
        evaluate(
          `(()=>{const e=document.querySelector('[aria-label=项目状态]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
      await projectStatus('archived');
      await wait(
        "document.querySelector('[aria-label=项目状态]').value==='archived' && !document.querySelector('[aria-label=项目状态]').disabled",
      );
      await projectStatus('restore');
      await wait(
        "document.querySelector('[aria-label=项目状态]').value==='planned' && !document.querySelector('[aria-label=项目状态]').disabled",
      );
      const catalog = await evaluate(
        "window.caselite.catalog({protocol_version:1,operation:'list'})",
      );
      if (
        !catalog.ok ||
        catalog.projects[0].task_count !== 1 ||
        catalog.documents.filter(
          (d: { in_library: boolean; favorite: boolean; tags: string[] }) =>
            d.in_library && d.favorite && d.tags.includes('验收'),
        ).length !== 1
      )
        throw new Error('Catalog restart organization mismatch');
      await capture('project-task.png');
      await click('[data-nav=tasks]');
      await evaluate("document.querySelector('[data-testid=back-to-tasks]')?.click()");
      await wait("document.querySelector('.list-view')");
      await evaluate(
        "Array.from(document.querySelectorAll('.view-tabs button')).find(e=>e.textContent==='未写正文').click()",
      );
      await wait(
        "document.querySelectorAll('[data-row-task]').length===1 && document.querySelector('.task-row-title')?.textContent.includes('采购')",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.view-tabs button')).find(e=>e.textContent==='全部任务').click()",
      );
      await wait("document.querySelectorAll('[data-row-task]').length===2");
      await assertCollectionColumns('.collection-main', '.task-inspector');
      const rowIds = await evaluate(
        "Array.from(document.querySelectorAll('[data-row-task]')).map(e=>e.dataset.rowTask)",
      );
      for (const id of rowIds) {
        await click(`[data-row-task="${id}"]`);
        await wait(
          `document.querySelector('[data-row-task="${id}"]')?.getAttribute('aria-current')==='true' && document.querySelector('.collection-main')`,
        );
      }
      await capture('task-list.png');
      await evaluate(
        "document.querySelector('.assistant-panel--compact')?.scrollIntoView({block:'nearest'})",
      );
      await wait("document.querySelector('[data-testid=assistant-input]')");
      await capture('task-list-ai.png');
      await click('[data-nav=documents]');
      await wait("document.querySelector('[data-collection=documents]')");
      await assertCollectionColumns('.collection-main', '.task-inspector');
      await capture('documents-list.png');
      await button('收藏');
      await wait("document.querySelectorAll('[data-document-id]').length===1");
      await button('归档文档');
      await wait("document.querySelectorAll('[data-document-id]').length===0");
      await button('已归档');
      await wait("document.querySelector('[data-document-id]')");
      await button('打开正文');
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.getAttribute('contenteditable')==='false' && document.querySelector('[data-testid=save-status]')?.textContent.includes('已归档')",
      );
      await click('[data-nav=documents]');
      await wait("document.querySelector('[data-collection=documents]')");
      await button('已归档');
      await wait("document.querySelector('[data-document-id]')");
      await button('恢复文档');
      await wait("document.querySelectorAll('[data-document-id]').length===0");
      await button('全部文档');
      await wait("document.querySelectorAll('[data-document-id]').length===2");
      await setViewport(980, 740);
      await assertCollectionColumns('.collection-main', '.task-inspector');
      await capture('documents-compact.png');
      await setViewport(1920, 1080);
      await click('[data-testid=inspector-open]');
      await wait("document.querySelector('[data-testid=body-editor]')");
      await click('[data-nav=documents]');
      await wait("document.querySelector('[data-document-id]')");
      await evaluate("document.querySelector('[data-document-id]').focus()");
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await wait("document.querySelector('[data-testid=body-editor]')");
      await click('[data-nav=documents]');
      await wait("document.querySelector('[data-document-id]')");
      await evaluate(
        "document.querySelector('[data-document-id]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
      );
      await wait("document.querySelector('[data-testid=body-editor]')");
      const savedTaskId = await evaluate(
        "document.querySelector('.task-detail').dataset.activeTask",
      );
      await evaluate(
        "document.querySelector('.assistant-panel--compact')?.scrollIntoView({block:'nearest'})",
      );
      await wait("document.querySelector('.model-settings-link')");
      if (
        await evaluate("Boolean(document.querySelector('.assistant-panel input[type=password]'))")
      )
        throw new Error('Credential form remains in AI panel');
      await click('.model-settings-link');
      await wait(
        "document.querySelector('[aria-label=设置中心]') && document.querySelector('[aria-label=\"OpenAI API Key\"]')",
      );
      const categories = await evaluate(
        "Array.from(document.querySelectorAll('[aria-label=设置分类] button')).map(e=>e.textContent)",
      );
      if (
        JSON.stringify(categories) !==
        JSON.stringify(['系统设置', '账户管理', '外观', '模型', '个性化'])
      )
        throw new Error('Settings categories mismatch');
      await wait("!document.querySelector('[data-provider=openai]').disabled");
      const testKey = 'sk-' + 'synthetic-settings-test';
      await input('[aria-label="OpenAI API Key"]', testKey);
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='保存 Key').click()",
      );
      await wait("document.querySelector('.settings-notice')?.textContent.includes('已加密保存')");
      if (await evaluate("document.querySelector('[aria-label=\"OpenAI API Key\"]').value !== ''"))
        throw new Error('Key remains in settings input');
      const encrypted = readFileSync(join(root, 'userData', 'openai-credential.enc'));
      if (encrypted.includes(testKey)) throw new Error('Plaintext key persisted');
      const reopenedCredentials = await createAgentCredentials(join(root, 'userData'));
      if (reopenedCredentials.get() !== testKey)
        throw new Error('Saved settings credential did not decrypt on reopen');
      await capture('settings-models.png');
      await click('[data-provider=deepseek]');
      await wait('!document.querySelector(\'[aria-label="DeepSeek API Key"]\').disabled');
      await input('[aria-label="DeepSeek API Key"]', 'sk-synthetic-settings-deepseek');
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='保存 Key').click()",
      );
      await wait("document.querySelector('.settings-notice')?.textContent.includes('已加密保存')");
      await evaluate(
        "(()=>{const e=document.querySelector('[aria-label=模型选择]');e.value='deepseek-flash';e.dispatchEvent(new Event('change',{bubbles:true}));})()",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='设为默认模型').click()",
      );
      await wait(
        "document.querySelector('.settings-notice')?.textContent.includes('默认模型已保存')",
      );
      const dsVault = await createAgentCredentials(join(root, 'userData'));
      if (
        dsVault.get('deepseek') !== 'sk-synthetic-settings-deepseek' ||
        dsVault.get() !== testKey ||
        dsVault.getDefaultModel() !== 'deepseek-flash'
      )
        throw new Error('Provider settings isolation failed');
      if (
        readFileSync(join(root, 'userData', 'deepseek-credential.enc')).includes(
          'sk-synthetic-settings-deepseek',
        )
      )
        throw new Error('DeepSeek key persisted as plaintext');
      await capture('settings-deepseek.png');
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='删除 Key').click()",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='确认删除').click()",
      );
      await wait("document.querySelector('.settings-notice')?.textContent.includes('已删除')");
      const dsRemoved = await evaluate(
        "window.caselite.agent({protocol_version:1,operation:'profile'})",
      );
      if (
        !dsRemoved.ok ||
        dsRemoved.configured ||
        dsRemoved.providers.deepseek ||
        !dsRemoved.providers.openai ||
        dsRemoved.model !== 'deepseek-flash'
      )
        throw new Error('Provider deletion caused fallback or removed OpenAI');
      await click('[data-provider=openai]');
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='设为默认模型').click()",
      );
      await wait(
        "document.querySelector('.settings-notice')?.textContent.includes('默认模型已保存')",
      );
      for (const provider of ['mineru', 'yuandian']) {
        await click(`[data-provider=${provider}]`);
        await wait("document.querySelector('.provider-detail input[type=password]').disabled");
        await capture(`settings-${provider}.png`);
      }
      for (const [label, file] of [
        ['系统设置', 'system'],
        ['账户管理', 'account'],
        ['外观', 'appearance'],
        ['个性化', 'personalization'],
      ]) {
        await evaluate(
          `Array.from(document.querySelectorAll('[aria-label=设置分类] button')).find(e=>e.textContent===${JSON.stringify(label)}).click()`,
        );
        await wait(
          `document.querySelector('.settings-page > h2')?.textContent===${JSON.stringify(label)}`,
        );
        await capture(`settings-${file}.png`);
      }
      await evaluate(
        "Array.from(document.querySelectorAll('[aria-label=设置分类] button')).find(e=>e.textContent==='模型').click()",
      );
      await wait(
        "document.querySelector('[data-provider=openai]')?.textContent.includes('已保存')",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='删除 Key').click()",
      );
      await wait("document.querySelector('[aria-label=确认删除密钥]')");
      await evaluate(
        "Array.from(document.querySelectorAll('.key-delete-confirm button')).find(e=>e.textContent==='取消').click()",
      );
      const kept = await evaluate(
        "window.caselite.agent({protocol_version:1,operation:'profile'})",
      );
      if (!kept.ok || !kept.configured) throw new Error('Cancel deleted key');
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='删除 Key').click()",
      );
      await evaluate(
        "Array.from(document.querySelectorAll('.key-delete-confirm button')).find(e=>e.textContent==='确认删除').click()",
      );
      await wait("document.querySelector('.settings-notice')?.textContent.includes('已删除')");
      const removed = await evaluate(
        "window.caselite.agent({protocol_version:1,operation:'profile'})",
      );
      if (!removed.ok || removed.configured) throw new Error('Settings key deletion failed');
      await click('.settings-back');
      await wait(
        `document.querySelector('.task-detail')?.dataset.activeTask===${JSON.stringify(savedTaskId)} && document.querySelector('[data-testid=body-editor]')`,
      );
    }
    process.stdout.write(`Task UI ${phase} passed.\n`);
    window.destroy();
  } finally {
    if (!window.isDestroyed() && window.webContents.debugger.isAttached())
      window.webContents.debugger.detach();
  }
}
