import { app, BrowserWindow, ipcMain, nativeTheme, session, type WebContents } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPEARANCE_CHANNEL, appearanceResponseSchema } from '@caselite/contracts';
import { createAppearanceApplication } from '@caselite/application';
import { createAppearancePreferences } from './adapters/appearance-preferences';
import { isTrustedDesktopSender } from './ipc/register-application-ipc';

// 只从已核验的临时离线演示入口调用；延迟和故障不进入正常主题通道。
export async function runAppearanceFlashDemo(
  create: (observe: (window: BrowserWindow) => Promise<void>) => Promise<BrowserWindow>,
  root: string,
  confirm?: (contents: WebContents, theme: 'light' | 'dark') => boolean,
) {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const application = createAppearanceApplication(
    createAppearancePreferences(app.getPath('userData')),
  );
  const initial = application.execute({ protocol_version: 1, operation: 'read' });
  let fault: 'none' | 'reject' | 'unknown' = 'none';
  const requests: unknown[] = [];
  ipcMain.removeHandler(APPEARANCE_CHANNEL);
  ipcMain.handle(APPEARANCE_CHANNEL, async (event, input) => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, message: '当前页面无权访问外观设置。' };
    requests.push(input);
    if (input.operation === 'read') await new Promise((resolve) => setTimeout(resolve, 1200));
    if (input.operation === 'set' && fault === 'reject')
      return { ok: false, message: '合成故障：未写入，保存失败。' };
    const response = appearanceResponseSchema.parse(application.execute(input));
    if (input.operation === 'applied' && response.ok && confirm)
      if (!confirm(event.sender, response.theme))
        throw new Error('Window theme confirmation failed');
    if (input.operation === 'set' && fault === 'unknown')
      return { ok: false, message: '合成故障：已落盘但回执未知，请重新读取。' };
    return response;
  });
  const frames: { file: string; timestamp: number }[] = [];
  mkdirSync(join(root, 'frames'), { recursive: true });
  const window = await create(async (window) => {
    writeFileSync(join(root, 'probe-stage.txt'), 'observer');
    await window.loadURL('about:blank');
    writeFileSync(join(root, 'probe-stage.txt'), 'blank loaded');
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Page.enable');
    await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__appearanceFrames=[];
        const record=()=>{const p=document.querySelector('.agent-main,.settings-page,.theme-bootstrap');
          const b=document.querySelector('.theme-option');
          if(p)window.__appearanceFrames.push({at:performance.now(),theme:document.documentElement.dataset.theme,
            background:getComputedStyle(p).backgroundColor,button:b?getComputedStyle(b).color:null,
            transition:b?getComputedStyle(b).transitionDuration:null});
          requestAnimationFrame(record)};requestAnimationFrame(record);`,
    });
    writeFileSync(join(root, 'probe-stage.txt'), 'collector installed');
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method !== 'Page.screencastFrame') return;
      const file = `frame-${String(frames.length).padStart(4, '0')}.jpg`;
      writeFileSync(join(root, 'frames', file), Buffer.from(params.data, 'base64'));
      frames.push({ file, timestamp: params.metadata.timestamp });
      void window.webContents.debugger.sendCommand('Page.screencastFrameAck', {
        sessionId: params.sessionId,
      });
    });
  });
  // 隐藏的空白页可能不产出screencast帧；先导航，再非激活显示，不抢用户键盘焦点。
  window.showInactive();
  await window.webContents.debugger.sendCommand('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 1280,
    maxHeight: 800,
  });
  const evaluate = async (source: string) => {
    try {
      return await window.webContents.executeJavaScript(source);
    } catch (error) {
      writeFileSync(
        join(root, 'evaluation-failure.json'),
        JSON.stringify(
          {
            source,
            error: error instanceof Error ? error.message : 'unknown',
          },
          null,
          2,
        ),
      );
      throw error;
    }
  };
  const wait = async (condition: string) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Appearance flash timeout: ${condition}`);
  };
  const snapshot = async (name: string) => {
    writeFileSync(join(root, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
  try {
    if (!initial.ok) {
      const file = join(app.getPath('userData'), 'appearance-preferences.json');
      const before = readFileSync(file, 'utf8');
      await wait("document.querySelector('.theme-bootstrap [role=alert]')");
      if (await evaluate("!!document.querySelector('.workbench')"))
        throw new Error('Corrupt preference exposed workbench');
      await snapshot('corrupt-error');
      if (readFileSync(file, 'utf8') !== before) throw new Error('Corrupt preference overwritten');
      // 只修复本演示的合成配置，用于核验用户显式重读的恢复路径。
      writeFileSync(join(root, 'corrupt-original.txt'), before);
      writeFileSync(file, JSON.stringify({ version: 1, theme: 'dark' }));
      await evaluate("document.querySelector('.theme-bootstrap button').click()");
      await wait(
        "document.querySelector('.agent-main') && document.documentElement.dataset.theme==='dark'",
      );
      await snapshot('corrupt-recovered');
      writeFileSync(
        join(root, 'flash-result.json'),
        JSON.stringify(
          {
            mode: 'MOCK_ONLY corrupt file; real packaged Electron UI',
            corruptPreservedUntilExplicitRepair: true,
            recovered: true,
            theme: await evaluate('document.documentElement.dataset.theme'),
            background: window.getBackgroundColor(),
            native: nativeTheme.themeSource,
            requests,
            frames,
          },
          null,
          2,
        ),
      );
      return;
    }
    await wait("document.querySelector('[data-nav=settings]')");
    await snapshot('startup');
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await snapshot('settled');
    const startup = await evaluate('window.__appearanceFrames.slice()');
    const background = initial.theme === 'dark' ? 'rgb(34, 34, 37)' : 'rgb(255, 255, 255)';
    if (
      !startup.length ||
      startup.some(
        (frame: { theme: string; background: string }) =>
          frame.theme !== initial.theme || frame.background !== background,
      )
    )
      throw new Error('Opposite theme appeared during delayed startup');
    await evaluate("document.querySelector('[data-nav=settings]').click()");
    await wait("document.querySelector('.settings-nav-group[aria-label=个人]')");
    await evaluate(
      "[...document.querySelectorAll('.settings-nav-group[aria-label=个人] button')].find(b=>b.textContent.trim()==='偏好设置').click()",
    );
    await wait("document.querySelector('.theme-option:not(:disabled)')");
    const switches: unknown[] = [];
    const choose = async (theme: 'light' | 'dark') => {
      await wait("document.querySelector('.theme-option:not(:disabled)')");
      await evaluate('window.__appearanceFrames=[]');
      await evaluate(
        `document.querySelector('.theme-option:nth-child(${theme === 'light' ? 1 : 2})').click()`,
      );
      await wait(`document.documentElement.dataset.theme==='${theme}'`);
      await wait("document.querySelector('.theme-option:not(:disabled)')");
      await new Promise((resolve) => setTimeout(resolve, 200));
      switches.push({
        target: theme,
        frames: await evaluate('window.__appearanceFrames'),
        background: window.getBackgroundColor(),
        native: nativeTheme.themeSource,
      });
      const expectedBackground = theme === 'dark' ? '#1C1C1F' : '#F7F7F8';
      const expectedInk = theme === 'dark' ? 'rgb(238, 238, 239)' : 'rgb(35, 35, 38)';
      const samples = await evaluate('window.__appearanceFrames');
      if (
        nativeTheme.themeSource !== theme ||
        window.getBackgroundColor() !== expectedBackground ||
        samples.some(
          (frame: { theme: string; button: string }) =>
            frame.theme === theme && frame.button !== expectedInk,
        )
      )
        throw new Error('Theme switch produced mixed native or intermediate colors');
      await snapshot(`switch-${theme}`);
    };
    await choose('light');
    await choose('dark');
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve());
      window.webContents.reload();
    });
    await wait(
      "document.querySelector('.agent-main') && document.documentElement.dataset.theme==='dark'",
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const reloadFrames = await evaluate('window.__appearanceFrames.slice()');
    if (reloadFrames.some((frame: { theme: string }) => frame.theme !== 'dark'))
      throw new Error('Reload used stale startup theme');
    await snapshot('reload-dark');
    await evaluate("document.querySelector('[data-nav=settings]').click()");
    await wait("document.querySelector('.settings-nav-group[aria-label=个人]')");
    await evaluate(
      "[...document.querySelectorAll('.settings-nav-group[aria-label=个人] button')].find(b=>b.textContent.trim()==='偏好设置').click()",
    );
    await wait("document.querySelector('.theme-option:not(:disabled)')");
    fault = 'reject';
    await evaluate("document.querySelector('.theme-option:first-child').click()");
    await wait("document.querySelector('.theme-error')");
    const rejectedTheme = await evaluate('document.documentElement.dataset.theme');
    await evaluate("document.querySelector('.theme-error button').click()");
    await wait(
      "!document.querySelector('.theme-error') && !document.querySelector('.theme-option').disabled",
    );
    fault = 'unknown';
    await evaluate("document.querySelector('.theme-option:first-child').click()");
    await wait("document.querySelector('.theme-error')");
    const unknownTheme = await evaluate('document.documentElement.dataset.theme');
    fault = 'none';
    await evaluate("document.querySelector('.theme-error button').click()");
    await wait(
      "document.documentElement.dataset.theme==='light' && !document.querySelector('.theme-error')",
    );
    const result = {
      mode: 'MOCK_ONLY timing and write faults; real packaged Electron UI',
      userData: app.getPath('userData'),
      startup,
      reloadFrames,
      switches,
      rejectedTheme,
      unknownTheme,
      recoveredTheme: await evaluate('document.documentElement.dataset.theme'),
      requests,
      background: window.getBackgroundColor(),
      native: nativeTheme.themeSource,
      frames,
    };
    if (rejectedTheme !== 'dark' || unknownTheme !== 'dark' || result.recoveredTheme !== 'light')
      throw new Error('Failed or unknown write changed display without readback');
    writeFileSync(join(root, 'flash-result.json'), JSON.stringify(result, null, 2));
    await snapshot('recovered');
  } finally {
    await window.webContents.debugger.sendCommand('Page.stopScreencast');
    window.webContents.debugger.detach();
    window.destroy();
  }
}
