import type { createTaskApplication } from '@caselite/application';
import { app, session, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 沿既有临时目录门禁和合成 Provider；通过真实界面保存，禁止访问正式工作区。
export async function runEditorSchemeDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  tasks: ReturnType<typeof createTaskApplication>,
  runs: () => unknown[],
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + '/'),
    )
  )
    throw new Error('Editor scheme isolation failed');
  const window = await createWindow();
  window.setContentSize(1440, 960);
  window.webContents.setBackgroundThrottling(false);
  const wc = window.webContents;
  wc.debugger.attach('1.3');
  const command = (method: string, params?: Record<string, unknown>) =>
    wc.debugger.sendCommand(method, params);
  const evaluate = (source: string) => wc.executeJavaScript(source);
  const capture = async (name: string) => {
    await evaluate('document.fonts.ready');
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const wait = async (condition: string) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await capture('editor-scheme-failure.png');
    throw new Error('Editor scheme condition failed: ' + condition);
  };
  const click = async (selector: string) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const named = (label: string) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled)`;
  const button = async (label: string) => {
    await wait(named(label));
    await evaluate(`${named(label)}.click()`);
  };
  const list = tasks.execute({ protocol_version: 1, operation: 'list' });
  if (!list.ok || list.tasks.length !== 2) throw new Error('Missing scheme samples');
  const task = list.tasks.find((item) => item.title.includes('合成文档甲'))!;
  const body = "document.querySelector('[data-testid=body-editor]')";
  const surface = "document.querySelector('.rich-editor[data-editor-scheme]')";
  const open = async () => {
    await click('[data-nav=documents]');
    await click(`[data-document-id="${task.document_id}"]`);
    await button('打开正文');
    await wait(body);
  };
  const scheme = async (value: 'markdown' | 'word') => {
    await click('[data-nav=settings]');
    await button('编辑器');
    await wait("document.querySelector('.editor-settings fieldset:not(:disabled)')");
    await click(`input[name=editor-scheme][value=${value}]`);
    await button('保存编辑器设置');
    await wait(
      "document.querySelector('.editor-settings [role=status]')?.textContent.includes('已保存到此工作区')",
    );
    await capture(`settings-${value}.png`);
    await click('.settings-back');
    await wait(`${surface}?.dataset.editorScheme===${JSON.stringify(value)}`);
  };
  try {
    await open();
    if (phase === 'editor-scheme-write') {
      await wait(`${surface}?.dataset.editorScheme==='markdown'`);
      await capture('document-markdown.png');
      await evaluate(
        `(()=>{${body}.focus();const r=document.createRange();r.selectNodeContents(${body});r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);})()`,
      );
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.insertText', { text: '#' });
      await command('Input.insertText', { text: ' ' });
      await wait(`${body}.querySelector('h1')`);
      await command('Input.insertText', { text: '一、双方案验收' });
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.insertText', {
        text: '合成验收正文：切换方案后，条款内容与已有格式应完整保留。',
      });
      await click('[data-testid=save-body]:not(:disabled)');
      await wait(
        "document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
      );
      const before = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      await scheme('word');
      await wait("document.querySelector('.simple-toolbar [aria-label=段落样式]')");
      await evaluate(
        `(()=>{const p=${body}.querySelector('p');${body}.focus();const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`,
      );
      await click('.simple-toolbar [aria-label=加粗]');
      await wait(`${body}.querySelector('strong')`);
      await click('.simple-toolbar [aria-label=撤销]:not(:disabled)');
      await wait(`!${body}.querySelector('strong')`);
      await click('.simple-toolbar [aria-label=重做]:not(:disabled)');
      await wait(`${body}.querySelector('strong')`);
      await evaluate(
        `(()=>{const p=${body}.querySelector('p:last-child');${body}.focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`,
      );
      // 等待原生选区观察器接收光标，再操作表格，避免同一脚本帧沿用旧选区。
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await evaluate(
        "(()=>{const s=document.querySelector('.simple-toolbar [aria-label=表格操作]');s.value='insert';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
      );
      await wait(`${body}.querySelectorAll('td').length===4`);
      await wait(`${body}.querySelector('strong')?.textContent==='乙方应于验收后支付剩余款项。'`);
      await click('[data-testid=save-body]:not(:disabled)');
      await wait(
        "document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
      );
      const saved = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      const html = await evaluate(`${body}.innerHTML`);
      await capture('document-word.png');
      await scheme('markdown');
      if (
        await evaluate(
          `${body}.innerHTML!==${JSON.stringify(html)} || document.querySelector('.markdown-format-menu').open`,
        )
      )
        throw new Error('Scheme switch changed content or opened Markdown toolbar');
      await capture('document-markdown-formatted.png');
      await scheme('word');
      const after = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      if (JSON.stringify(saved) !== JSON.stringify(after) || !before.ok || !saved.ok)
        throw new Error('Scheme switch changed durable body');
      await command('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await capture('document-word-narrow.png');
      writeFileSync(
        join(root, 'editor-scheme-write.json'),
        JSON.stringify({
          status: 'PASS_REAL',
          taskId: task.id,
          revision: saved.tasks[0].body_revision,
          markdownShortcut: true,
          undoRedo: true,
          schemePreservesBody: true,
          modelCalls: runs().length,
        }),
      );
    } else {
      await wait(`${surface}?.dataset.editorScheme==='word'`);
      await wait(
        `${body}.querySelector('h1')?.textContent==='一、双方案验收' && ${body}.querySelector('strong') && ${body}.querySelectorAll('td').length===4`,
      );
      await capture('document-word-reopened.png');
      const result = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      if (!result.ok) throw new Error('Cannot read reopened body');
      writeFileSync(
        join(root, 'editor-scheme-read.json'),
        JSON.stringify({
          status: 'PASS_REAL',
          taskId: task.id,
          revision: result.tasks[0].body_revision,
          persistedScheme: 'word',
          modelCalls: runs().length,
        }),
      );
    }
    if (runs().length) throw new Error('Unexpected model dispatch');
  } finally {
    wc.debugger.detach();
    window.destroy();
  }
}
