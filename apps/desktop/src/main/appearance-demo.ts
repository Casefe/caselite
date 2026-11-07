import { session, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 仅供受限临时目录的离线合成演示，验证外观切换及进程重启读回。
export async function runAppearanceDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow();
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const wait = async (condition: string) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    writeFileSync(join(root, 'appearance-failure.txt'), await evaluate('document.body.innerText'));
    throw new Error(`Appearance demo timed out: ${condition}`);
  };
  const click = (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async (name: string) => {
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(
      "document.querySelector('[data-testid=agent-input]') && !document.body.innerText.includes('正在读取本地任务')",
    );
    if (phase === 'appearance-write') {
      await wait("document.documentElement.dataset.theme==='light'");
      await click('[data-nav=settings]');
      await click('.settings-nav-group[aria-label=个人] button:first-of-type');
      await wait("document.querySelector('.theme-option:nth-child(2):not(:disabled)')");
      await capture('settings-light.png');
      await click('.theme-option:nth-child(2)');
      await wait(
        "document.documentElement.dataset.theme==='dark' && document.querySelector('.theme-option:nth-child(2)[aria-pressed=true]')",
      );
      await capture('settings-dark.png');
      await click('.settings-back');
      await wait(
        "document.querySelector('.agent-main') && document.documentElement.dataset.theme==='dark'",
      );
      await capture('home-dark.png');
    } else {
      await wait("document.documentElement.dataset.theme==='dark'");
      const colors = await evaluate(
        `(()=>{const a=getComputedStyle(document.querySelector('.agent-main')); const h=getComputedStyle(document.querySelector('.agent-start h1')); const empty=getComputedStyle(document.querySelector('.home-task-feed > p')); const reminder=getComputedStyle(document.querySelector('.home-reminder-card h3, .agent-context-section h3')); const card=getComputedStyle(document.querySelector('.home-reminder-card, .agent-context')); return {background:a.backgroundColor,text:h.color,empty:empty.backgroundColor,reminder:reminder.color,card:card.backgroundColor}})()`,
      );
      const luminance = (s: string) => {
        const rgb = (s.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      };
      const bg = luminance(colors.background),
        fg = luminance(colors.text);
      if (
        !Number.isFinite(bg) ||
        !Number.isFinite(fg) ||
        bg >= 0.2 ||
        (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) < 4.5 ||
        luminance(colors.empty) >= 0.2 ||
        (Math.max(luminance(colors.reminder), luminance(colors.card)) + 0.05) /
          (Math.min(luminance(colors.reminder), luminance(colors.card)) + 0.05) <
          4.5
      )
        throw new Error('Dark home contrast or background failed');
      await evaluate(
        "(()=>{const e=document.querySelector('[data-testid=agent-input]');e.focus();document.execCommand('insertText',false,'合成主题验证');})()",
      );
      await click('[data-nav=tasks]');
      await wait("document.querySelector('[data-testid=new-task]')");
      await click('[data-testid=new-task]');
      await wait("document.querySelector('[data-testid=task-title]')");
      await evaluate(
        "(()=>{const e=document.querySelector('[data-testid=task-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'外观合成测试');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
      );
      await click('[data-testid=create-task]');
      await wait("document.querySelector('[data-testid=task-result-tab]')");
      await click('[data-testid=task-result-tab]');
      await wait("document.querySelector('.task-inspector .assistant-panel--compact')");
      await evaluate(
        "document.querySelector('.assistant-panel--compact').scrollIntoView({block:'nearest'})",
      );
      await wait("document.querySelector('[data-testid=assistant-input]')");
      const toolbarColor = await evaluate(
        "getComputedStyle(document.querySelector('.simple-toolbar')).backgroundColor",
      );
      if (luminance(toolbarColor) >= 0.2) throw new Error('Dark editor toolbar is too bright');
      await capture('assistant-dark.png');
      await click('[data-nav=settings]');
      await click('.settings-nav-group[aria-label=个人] button:first-of-type');
      await wait("document.querySelector('.theme-option:first-child:not(:disabled)')");
      await click('.theme-option:first-child');
      await wait(
        "document.documentElement.dataset.theme==='light' && document.querySelector('.theme-option:first-child[aria-pressed=true]')",
      );
      await capture('settings-light-restored.png');
      await click('.settings-back');
      await wait(
        "document.documentElement.dataset.theme==='light' && document.querySelector('[data-testid=body-editor]')",
      );
      await capture('task-light.png');
    }
    process.stdout.write(`Appearance ${phase} passed.\n`);
  } finally {
    if (!window.isDestroyed() && window.webContents.debugger.isAttached())
      window.webContents.debugger.detach();
    if (!window.isDestroyed()) window.destroy();
  }
}
