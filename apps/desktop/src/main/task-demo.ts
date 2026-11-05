import { BrowserWindow, nativeImage, session } from 'electron';
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
    };
    await setViewport(1920, 1080);
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
      const size = await evaluate('({width:innerWidth,height:innerHeight,ratio:devicePixelRatio})');
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
    const input = async (selector: string, value: string) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    await wait(
      "document.querySelector('[data-testid=new-task]') && !document.body.textContent.includes('正在读取')",
    );
    const openTask = async (id: string) => {
      await click('[data-nav=tasks]');
      await wait("document.querySelector('.list-view')");
      await click(`[data-row-task="${id}"]`);
    };
    const navLabels = await evaluate(
      "Array.from(document.querySelectorAll('.primary-navigation button')).map(e=>e.getAttribute('aria-label'))",
    );
    if (
      JSON.stringify(navLabels) !==
      JSON.stringify(['首页（Agent）', '任务', '项目', '文档', '知识库'])
    )
      throw new Error('Primary navigation does not match the approved five entries');
    if (phase === 'write') {
      await wait("document.querySelector('.agent-home')");
      await input(
        '[aria-label="Agent 工作目标"]',
        '核对两份材料的事实、矛盾及缺件，形成内部沟通初稿',
      );
      await click('.agent-prompt button');
      await wait("document.querySelector('[data-testid=task-title]')");
      await wait(
        "document.querySelector('[data-testid=task-objective]').value==='核对两份材料的事实、矛盾及缺件，形成内部沟通初稿'",
      );
      await input('[data-testid=task-title]', '服务合同事实梳理');
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
      const id = await evaluate(
        "document.querySelector('[data-active-task]').getAttribute('data-active-task')",
      );
      await click('[data-testid=toggle-favorite]');
      await wait(`document.querySelector('[data-task-id="${id}"]')`);
      await click('[data-testid=toggle-favorite]');
      await wait(`!document.querySelector('[data-task-id="${id}"]')`);
      await click('[data-testid=toggle-favorite]');
      await wait(`document.querySelector('[data-task-id="${id}"]')`);
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
      await openTask(expected.id);
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
      const density = await evaluate(`(()=>{
      const editor = document.querySelector('[data-testid=body-editor]').getBoundingClientRect();
      const tabs = document.querySelector('.detail-tabs').getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,scale:visualViewport.scale,tabs:tabs.height,editorTop:editor.top};
    })()`);
      if (
        density.width !== 1920 ||
        density.height !== 1080 ||
        density.scale !== 1 ||
        density.tabs > 34 ||
        density.editorTop >= 240
      )
        throw new Error(
          '1080p viewport or compact editor geometry does not match: ' + JSON.stringify(density),
        );
      await click('[data-testid=toggle-favorite]');
      await wait("document.querySelector('[data-task-id]')");
      await evaluate(
        "Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent.includes('AI 助手')).click()",
      );
      await wait(
        "document.querySelector('.ai-inspector') && document.querySelector('[data-testid=revision]')?.textContent==='2'",
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
  } finally {
    if (!window.isDestroyed() && window.webContents.debugger.isAttached())
      window.webContents.debugger.detach();
  }
}
