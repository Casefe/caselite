import type { BrowserWindow } from 'electron';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Material, MaterialResponse } from '@caselite/contracts';
export async function runMaterialDemo(
  create: () => Promise<BrowserWindow>,
  directory: string,
  phase: string,
) {
  const window = await create();
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  let stage = 'home';
  const trace = (event: string) =>
    writeFileSync(
      join(directory, 'stage.json'),
      JSON.stringify({ stage, event, time: Date.now() }),
    );
  window.webContents.on('render-process-gone', (_event, details) =>
    trace('renderer-' + details.reason),
  );
  async function waitFor(predicate: string, limit = 300) {
    trace(predicate);
    for (let i = 0; i < limit; i++) {
      if (await evaluate(predicate)) return;
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error(`Material demo timeout: ${stage}`);
  }
  async function click(text: string) {
    await evaluate(
      `[...document.querySelectorAll('button')].find(el=>(el.textContent.trim()===${JSON.stringify(text)} || el.querySelector('strong')?.textContent===${JSON.stringify(text)}))?.click()`,
    );
  }
  async function list() {
    const r = (await evaluate(
      "window.caselite.material({protocol_version:1,operation:'list',scope:'home'})",
    )) as MaterialResponse;
    if (!r.ok) throw new Error('List failed');
    return r.materials;
  }
  async function settled() {
    for (let i = 0; i < 500; i++) {
      const items = await list();
      if (items.length && items.every((item) => item.status !== 'processing')) return items;
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error('Processing timeout');
  }
  async function capture(name: string) {
    await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(join(directory, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  const bodyText = '合成回归：已保存的律师内部沟通初稿；金额和日期仍待核对。';
  async function openTask(id: string) {
    await evaluate("document.querySelector('[data-nav=tasks]').click()");
    await waitFor(`Boolean(document.querySelector('[data-row-task="${id}"]'))`);
    await evaluate(`document.querySelector('[data-row-task="${id}"]').click()`);
    await waitFor("Boolean(document.querySelector('[data-testid=inspector-open]'))");
    await evaluate("document.querySelector('[data-testid=inspector-open]').click()");
    await waitFor("Boolean(document.querySelector('[data-testid=body-editor]'))");
  }
  async function drop(file: string) {
    // CDP 将固定合成文件装入浏览器 File，再派发合成drop事件；沿产品 preload/webUtils/IPC 导入，非Finder物理拖放。
    await evaluate(
      "(()=>{const old=document.querySelector('#material-demo-file');old?.remove();const input=document.createElement('input');input.type='file';input.id='material-demo-file';input.hidden=true;document.body.append(input);})()",
    );
    try {
      const doc = await window.webContents.debugger.sendCommand('DOM.getDocument');
      const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: '#material-demo-file',
      });
      await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId,
        files: [join(directory, file)],
      });
      await evaluate(
        "(()=>{const file=document.querySelector('#material-demo-file').files[0];const data=new DataTransfer();data.items.add(file);document.querySelector('.material-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()",
      );
    } finally {
      // 调试连接仅用于合成演示，保持到末尾以固定1080p视口。
    }
    await waitFor("Boolean(document.querySelector('.material-staged'))");
  }
  try {
    await waitFor("Boolean(document.querySelector('.material-composer'))");
    if (phase === 'materials-read') {
      const items = await list();
      if (items.length !== 2 || items.some((item) => !item.pages.length))
        throw new Error('Restart lost material');
      await waitFor("document.querySelectorAll('.message-attachments').length===3");
      await evaluate(
        "[...document.querySelectorAll('.message-attachments button')].find(b=>b.textContent.includes('scan.pdf')).click()",
      );
      await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
      if (existsSync(join(directory, 'unexpected-runtime.txt')))
        throw new Error('Unexpected restart dispatch');
      await capture('materials-reopened');
      await openTask(items[0].task_id);
      await waitFor(
        `document.querySelector('[data-testid=body-editor]').textContent.includes(${JSON.stringify(bodyText)})`,
      );
      await capture('task-body-reopened');
      writeFileSync(
        join(directory, 'materials-read.json'),
        JSON.stringify(
          {
            passed: true,
            ids: items.map((item) => item.id),
            texts: items.map((item) => item.pages[0].text),
            network: 'HTTP(S) blocked; physical adapter unchanged',
          },
          null,
          2,
        ),
      );
      return;
    }
    stage = 'drop-text';
    await drop('text.pdf');
    await capture('pdf-drop-staged');
    stage = 'import-text';
    await waitFor("!document.querySelector('.material-staged')");
    let items = await settled();
    if (items.length !== 1 || items[0].status !== 'ready')
      throw new Error('Text extraction failed');
    stage = 'read-text';
    await click('text.pdf');
    await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
    await capture('pdf-text-reader');
    await click('收起阅读');
    for (let n = 0; n < 3; n++) {
      await click('text.pdf');
      await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
      await click('收起阅读');
    }
    stage = 'single-pdf-and-text';
    await evaluate(
      "document.querySelector('[data-testid=agent-input]').focus();document.execCommand('insertText',false,'概括这一份 PDF 的主体、金额、日期和待核对事项。')",
    );
    await evaluate("document.querySelector('.assistant-compose').requestSubmit()");
    await waitFor(
      "document.querySelector('.assistant-run-status.succeeded') && document.querySelector('[data-testid=agent-input]').value==='' && document.querySelectorAll('.message-attachments').length===1",
    );
    const singleContext = JSON.parse(
      readFileSync(join(directory, 'material-pi-context.json'), 'utf8'),
    );
    if (
      singleContext.messages.length !== 2 ||
      singleContext.messages.filter((message: { role: string }) => message.role === 'user')
        .length !== 1 ||
      singleContext.messages.filter((message: { role: string }) => message.role === 'system')
        .length !== 1 ||
      !JSON.stringify(singleContext).includes('text.pdf') ||
      JSON.stringify(singleContext).includes('scan.pdf')
    )
      throw new Error('Single PDF dispatch included an unexpected message or attachment');
    writeFileSync(
      join(directory, 'single-pdf-pi-context.json'),
      JSON.stringify(singleContext, null, 2),
    );
    await capture('chat-single-pdf-output');
    await evaluate(
      "document.querySelector('.material-library').open=true;[...document.querySelectorAll('.material-library > div')].find(row=>row.textContent.includes('text.pdf')).querySelectorAll('button')[1].click()",
    );
    stage = 'drop-and-send-scan';
    await drop('scan.pdf');
    await evaluate("document.querySelector('[data-testid=agent-input]').focus()");
    const instruction = '梳理两份材料中的事实、矛盾和缺件，形成律师内部沟通初稿。';
    await evaluate(`document.execCommand('insertText',false,${JSON.stringify(instruction)})`);
    const importPendingAtSend = await evaluate(
      "Boolean(document.querySelector('.material-staged'))",
    );
    await evaluate("document.querySelector('.assistant-compose').requestSubmit()");
    await capture('chat-preparing');
    await waitFor(
      "document.querySelector('.assistant-run-status.succeeded') && document.querySelector('[data-testid=agent-input]').value==='' && !document.querySelector('[aria-label=待发送附件]')",
    );
    items = await settled();
    if (items.length !== 2) throw new Error('Missing second attachment');
    const scan = items.find((item) => item.name === 'scan.pdf')!;
    if (scan.status !== 'needs_ocr')
      throw new Error('Visual path unexpectedly waited for local OCR');
    const context = JSON.parse(readFileSync(join(directory, 'material-pi-context.json'), 'utf8'));
    const message = context.messages.find((entry: { role: string }) => entry.role === 'user');
    const text = message.content
      .filter((part: { type: string }) => part.type === 'text')
      .map((part: { text: string }) => part.text)
      .join('');
    const images = message.content.filter((part: { type: string }) => part.type === 'image');
    if (
      !text.includes(instruction) ||
      !text.includes('text.pdf') ||
      !text.includes('scan.pdf') ||
      !text.includes('对应附图 1') ||
      images.length !== 1
    )
      throw new Error('Incomplete visual dispatch');
    writeFileSync(join(directory, 'vision-pi-context.json'), JSON.stringify(context, null, 2));
    await capture('chat-visual-analysis');
    stage = 'message-attachment-reader';
    await evaluate(
      "[...document.querySelectorAll('.message-attachments button')].find(b=>b.textContent.includes('scan.pdf')).click()",
    );
    await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
    await capture('chat-message-reader');
    await click('收起阅读');
    stage = 'automatic-local-fallback';
    await evaluate(
      "(()=>{const select=document.querySelector('[aria-label=选择大模型]');select.value='deepseek-v4-pro';select.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await waitFor("document.querySelector('[aria-label=选择大模型]').value==='deepseek-v4-pro'");
    await evaluate(
      "document.querySelector('.material-library').open=true;[...document.querySelectorAll('.material-library > div')].find(row=>row.textContent.includes('scan.pdf')).querySelectorAll('button')[1].click()",
    );
    await evaluate(
      "document.querySelector('[data-testid=agent-input]').focus();document.execCommand('insertText',false,'核对这份扫描材料的付款条款。')",
    );
    const started = Date.now();
    await evaluate("document.querySelector('.assistant-compose').requestSubmit()");
    await waitFor(
      "document.querySelector('[data-testid=agent-input]').value==='' && document.querySelectorAll('.message-attachments').length===3 && document.body.textContent.includes('DeepSeek · deepseek-v4-pro · 生成完成')",
    );
    const ocrMs = Date.now() - started;
    items = await settled();
    if (
      !items
        .find((item) => item.id === scan.id)
        ?.pages.some((page) => page.origin === 'ocr_candidate' && page.text.includes('合同'))
    )
      throw new Error('Automatic local OCR failed');
    const localContext = JSON.parse(
      readFileSync(join(directory, 'material-pi-context.json'), 'utf8'),
    );
    const localUser = localContext.messages.find(
      (entry: { role: string }) => entry.role === 'user',
    );
    if (
      localUser.content.some((part: { type: string }) => part.type === 'image') ||
      !JSON.stringify(localUser).includes('OCR 文字') ||
      JSON.stringify(localUser).includes('text.pdf')
    )
      throw new Error('Local fallback selection mismatch');
    await capture('chat-local-fallback');
    stage = 'offline-reader-ocr-without-key';
    await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'clear_key',provider:'deepseek'})",
    );
    await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'clear_key',provider:'openai'})",
    );
    const noKey = await evaluate("window.caselite.agent({protocol_version:1,operation:'profile'})");
    if (noKey.providers.openai || noKey.providers.deepseek)
      throw new Error('Demo keys were not cleared');
    const oldDerivation = items.find((item) => item.id === scan.id)!.derivation_id;
    await evaluate(
      "[...document.querySelectorAll('.message-attachments button')].find(b=>b.textContent.includes('scan.pdf')).click()",
    );
    await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
    await click('提取文字（离线）');
    await waitFor(
      `window.caselite.material({protocol_version:1,operation:'list',scope:'home'}).then(r=>r.ok && r.materials.some(m=>m.id===${JSON.stringify(scan.id)} && m.derivation_id!==${JSON.stringify(oldDerivation)} && m.status==='ready'))`,
    );
    await capture('chat-offline-reader');
    await click('收起阅读');
    stage = 'task-body-regression';
    await openTask(items[0].task_id);
    await evaluate(
      `(()=>{document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,${JSON.stringify(bodyText)});})()`,
    );
    await waitFor("document.querySelector('[data-testid=save-body]')?.disabled===false");
    await evaluate("document.querySelector('[data-testid=save-body]').click()");
    await waitFor(
      "document.querySelector('[data-testid=revision]')?.textContent==='1' && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
    );
    await evaluate("document.querySelector('[data-nav=home]').click()");
    await openTask(items[0].task_id);
    await waitFor(
      `document.querySelector('[data-testid=body-editor]').textContent.includes(${JSON.stringify(bodyText)})`,
    );
    await capture('task-body-saved');
    writeFileSync(
      join(directory, 'materials-write.json'),
      JSON.stringify(
        {
          passed: true,
          ids: items.map((item) => item.id),
          materials: items.map((item: Material) => ({
            id: item.id,
            hash: item.sha256,
            status: item.status,
            pages: item.pages.map((page) => ({
              page: page.page,
              text: page.text,
              origin: page.origin,
            })),
          })),
          ocrMs,
          importPendingAtSend,
          visualImages: images.length,
          inputCleared: true,
          offlineReaderWithoutKey: true,
          attachmentMessages: 2,
          network: 'HTTP(S) blocked; no Key or remote model used',
          agentDispatch:
            'MOCK_ONLY: real Pi Runtime with synthetic Provider; real Pi receives both selected sources, one scan image; second run local OCR only and excludes first-round text attachment',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await capture('materials-failure');
    writeFileSync(
      join(directory, 'materials-failure.json'),
      JSON.stringify(
        { stage, error: String(error), body: await evaluate('document.body.innerText') },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
}
