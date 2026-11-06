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
  async function drop(file: string) {
    // CDP 将固定合成文件装入浏览器 File，再发真实 drop；沿产品 preload/webUtils/IPC 导入。
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
      await click('scan.pdf');
      await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
      if (existsSync(join(directory, 'unexpected-runtime.txt')))
        throw new Error('Unexpected restart dispatch');
      await capture('materials-reopened');
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
    await click('导入并保存');
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
    stage = 'drop-scan';
    await drop('scan.pdf');
    await click('导入并保存');
    await waitFor("!document.querySelector('.material-staged')");
    items = await settled();
    const scan = items.find((item) => item.name === 'scan.pdf')!;
    if (scan.status !== 'needs_ocr') throw new Error('Scan not classified');
    stage = 'ocr';
    await waitFor("document.body.textContent.includes('扫描页待识别')");
    const started = Date.now();
    await evaluate(
      "[...document.querySelectorAll('.material-saved-card')].find(el=>el.textContent.includes('scan.pdf')).querySelector('.material-card-actions button').click()",
    );
    await waitFor(
      "[...document.querySelectorAll('.material-saved-card')].some(el=>el.textContent.includes('scan.pdf') && (el.textContent.includes('正在处理') || el.textContent.includes('OCR 已完成')))",
    );
    await capture('pdf-ocr-progress');
    items = await settled();
    const recognized = items.find((item) => item.id === scan.id)!;
    if (
      recognized.status !== 'ready' ||
      !recognized.pages.some(
        (page) => page.origin === 'ocr_candidate' && page.text.includes('合同'),
      )
    )
      throw new Error('Vision did not recognize synthetic contract');
    const ocrMs = Date.now() - started;
    await click('scan.pdf');
    await waitFor(
      "Boolean(document.querySelector('.material-paper canvas')?.width) && document.body.textContent.includes('本地 OCR 文字')",
    );
    await capture('pdf-scan-ocr-reader');
    await evaluate(
      "document.querySelector('.material-recognized').scrollIntoView({block:'center'})",
    );
    await capture('pdf-ocr-text');
    await click('收起阅读');
    stage = 'selected-preview';
    await evaluate(
      "document.querySelectorAll('.material-card-actions input[type=checkbox]').forEach(input=>input.click())",
    );
    await evaluate(
      "(()=>{const editor=document.querySelector('[data-testid=agent-input]');editor.focus();})()",
    );
    await evaluate(
      "document.execCommand('insertText',false,'梳理两份材料中的事实、矛盾和缺件，形成律师内部沟通初稿。')",
    );
    await waitFor("!document.querySelector('.assistant-submit').disabled");
    await evaluate("document.querySelector('.assistant-compose').requestSubmit()");
    await waitFor("Boolean(document.querySelector('.assistant-preview'))");
    const preview = (await evaluate(
      "document.querySelector('.assistant-preview pre').textContent",
    )) as string;
    if (
      !preview.includes('text.pdf') ||
      !preview.includes('scan.pdf') ||
      !preview.includes('OCR 文字')
    )
      throw new Error('Preview missing source');
    await evaluate("document.querySelector('.assistant-preview').scrollIntoView({block:'start'})");
    await capture('agent-selected-materials');
    stage = 'agent-synthetic-dispatch';
    await click('确认发送');
    await waitFor("document.body.textContent.includes('生成完成')");
    const context = JSON.parse(readFileSync(join(directory, 'material-pi-context.json'), 'utf8'));
    const message = context.messages.find((entry: { role: string }) => entry.role === 'user');
    const sent =
      typeof message.content === 'string'
        ? message.content
        : message.content.map((part: { text?: string }) => part.text ?? '').join('');
    if (sent !== preview) throw new Error('Pi input differs from confirmed preview');
    await capture('agent-material-analysis-synthetic');
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
          preview,
          network: 'HTTP(S) blocked; no Key or remote model used',
          agentDispatch:
            'MOCK_ONLY: real Pi Runtime with synthetic Provider; exact payload equality verified',
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
