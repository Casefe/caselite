import { app, session, type BrowserWindow } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { createTaskApplication } from '@caselite/application';

const sample = [
  '字体排版验收 · 合成法律文档',
  '一、审查范围',
  '本页仅使用合成资料，验证中文标点、数字与姓名用字，不涉及真实客户或案件。',
  '当事人应依约履行义务；对事实、证据与法律意见分别核对，并保留原始材料。',
  '二、生僻姓名字与扩展汉字',
  '逯　禤　甯　喆　堃　垚　翊　祎　龘　𠮷　𠀀',
  '三、中英文与金额',
  'CaseLite Document 2026　人民币 ¥123,456.78　（2026）示例字第001号',
  '引号：“依法履行”；括号（补充说明）；破折号——；省略号……。',
].join('\n\n');
const glyphs = [...'中文法律逯禤甯喆堃垚翊祎龘𠮷𠀀'];

// 只由 Main 既有临时目录门禁进入；固定样本沿真实 Application/编辑器保存，不接收脚本或路径。
export async function runTypographyDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  tasks: ReturnType<typeof createTaskApplication>,
) {
  const phase = process.env.CASELITE_TYPOGRAPHY_PHASE;
  if (phase !== 'write' && phase !== 'read') throw new Error('Invalid typography phase');
  const userData = app.getPath('userData');
  const sessionData = app.getPath('sessionData');
  if (![userData, sessionData].every((path) => path.startsWith(root + sep)))
    throw new Error('Typography isolation failed');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const expected = process.env.CASELITE_TYPOGRAPHY_FONT === 'source-han-serif';
  let stage = 'seed';
  let taskId: string;
  if (phase === 'write') {
    const created = tasks.execute({
      protocol_version: 1,
      operation: 'create',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      title: '字体排版验收（合成资料）',
      objective: '验证中文、生僻姓名字及保存重开；无模型调用。',
    });
    if (!created.ok) throw new Error('Typography task creation failed');
    taskId = created.tasks[0].id;
    writeFileSync(join(root, 'typography-task.json'), JSON.stringify({ taskId }));
  } else {
    taskId = JSON.parse(readFileSync(join(root, 'typography-task.json'), 'utf8')).taskId;
  }
  const window = await createWindow();
  window.setContentSize(1440, 960);
  window.webContents.setBackgroundThrottling(false);
  window.webContents.debugger.attach('1.3');
  const command = (method: string, params?: Record<string, unknown>) =>
    window.webContents.debugger.sendCommand(method, params);
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const capture = async (name: string) => {
    await evaluate('document.fonts.ready');
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, name), Buffer.from(screenshot.data, 'base64'));
  };
  const wait = async (predicate: string) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await capture('typography-failure.png');
    throw new Error(`Typography timed out at ${stage}`);
  };
  try {
    await command('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    stage = 'open-task';
    await wait("document.querySelector('[data-nav=tasks]')");
    await evaluate("document.querySelector('[data-nav=tasks]').click()");
    await wait("document.querySelector('.task-row-title')");
    await evaluate("document.querySelector('.task-row-title').click()");
    await wait("document.querySelector('[data-testid=task-result-tab]')");
    await evaluate("document.querySelector('[data-testid=task-result-tab]').click()");
    await wait("document.querySelector('.document .tiptap[contenteditable=true]')");
    if (phase === 'write') {
      stage = 'type-and-save';
      await evaluate("document.querySelector('.document .tiptap').focus()");
      await command('Input.insertText', { text: sample });
      await wait("document.querySelector('[data-testid=save-body]:not(:disabled)')");
      await evaluate("document.querySelector('[data-testid=save-body]').click()");
      await wait(
        "document.querySelector('[data-testid=save-status]').textContent.includes('已保存到此设备')",
      );
    }
    stage = 'read-document';
    await wait(`document.querySelector('.document .tiptap').innerText.includes('𠮷')`);
    const rendered = await evaluate("document.querySelector('.document .tiptap').innerText");
    for (const line of sample.split('\n').filter(Boolean)) {
      if (!rendered.includes(line)) throw new Error('Saved typography text changed');
    }
    const task = tasks.execute({ protocol_version: 1, operation: 'read', task_id: taskId });
    if (!task.ok || task.tasks[0].body_revision < 1) throw new Error('Typography save not durable');
    stage = 'fonts';
    await evaluate('document.fonts.ready');
    const fontState = await evaluate(`(async()=>{
      const editor=document.querySelector('.document .tiptap');
      const body=getComputedStyle(editor), ui=getComputedStyle(document.body);
      const faces=await document.fonts.load('400 16px "CaseLite Source Han Serif"', '法律𠮷');
      const supplementary=await document.fonts.load('400 24px "CaseLite Supplementary Han"', '𠮷𠀀');
      const probe=document.createElement('div');probe.id='typography-glyph-probe';
      probe.style.cssText='position:fixed;left:8px;bottom:8px;z-index:2147483647;background:white;';
      ${JSON.stringify(glyphs)}.forEach((text,index)=>{
        const span=document.createElement('span');span.id='typography-glyph-'+index;
        span.textContent=text;span.style.fontFamily=body.fontFamily;span.style.fontSize='24px';
        probe.append(span);
      });document.body.append(probe);
      return {ui:ui.fontFamily,document:body.fontFamily,size:body.fontSize,
        loadedFaces:faces.map(f=>({family:f.family,status:f.status,weight:f.weight})),
        supplementaryFaces:supplementary.map(f=>({family:f.family,status:f.status})),
        resources:performance.getEntriesByType('resource').filter(r=>/\\.(woff2?|otf|ttf)(?:$|\\?)/.test(r.name)).map(r=>r.name)};
    })()`);
    if (
      expected &&
      !fontState.loadedFaces.some((face: { status: string }) => face.status === 'loaded')
    )
      throw new Error('Packaged Source Han Serif did not load');
    if (expected && !fontState.document.includes('CaseLite Source Han Serif'))
      throw new Error('Document font was not applied');
    // Chromium 只为实际绘制的字形提供平台字体；不能把屏外节点被裁剪误判为缺字。
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await command('Page.captureScreenshot', { format: 'png' });
    await command('DOM.enable');
    await command('CSS.enable');
    const document = await command('DOM.getDocument');
    const renderedFonts = [];
    for (const [index, text] of glyphs.entries()) {
      const { nodeId } = await command('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector: `#typography-glyph-${index}`,
      });
      const { fonts } = await command('CSS.getPlatformFontsForNode', { nodeId });
      if (
        !fonts.some((font: { glyphCount: number }) => font.glyphCount > 0) ||
        fonts.some((font: { familyName: string }) => /last.?resort/i.test(font.familyName))
      )
        throw new Error(`Missing glyph: ${text}`);
      if (
        expected &&
        text.codePointAt(0)! < 0x20000 &&
        !fonts.some(
          (font: { isCustomFont: boolean; familyName: string }) =>
            font.isCustomFont && /Source Han Serif/.test(font.familyName),
        )
      )
        throw new Error('Chinese document text did not use the packaged font');
      // glyphCount 也会统计 .notdef；扩展字必须命中已独立核验 cmap/轮廓的补充字库。
      if (
        expected &&
        text.codePointAt(0)! >= 0x20000 &&
        !fonts.some(
          (font: { isCustomFont: boolean; familyName: string }) =>
            font.isCustomFont && font.familyName === 'Jigmo2',
        )
      )
        throw new Error(`Supplementary glyph did not use Jigmo2: ${text}`);
      renderedFonts.push({ text, fonts });
    }
    await capture(`glyphs-${phase}.png`);
    await evaluate(
      "document.querySelector('#typography-glyph-probe').remove();document.activeElement?.blur()",
    );
    await capture(`document-${phase}.png`);
    stage = 'pdf-original';
    const url = new URL(window.webContents.getURL());
    url.searchParams.set('engineering', '1');
    await window.loadURL(url.toString());
    await wait("document.querySelector('main > button')");
    await evaluate("document.querySelector('main > button').click()");
    await wait(
      "document.querySelector('canvas')?.width>0 && document.querySelector('.react-pdf__Page__textContent')?.textContent.includes('合同')",
    );
    const pdfPixels = await evaluate("document.querySelector('canvas').toDataURL('image/png')");
    await capture(`pdf-${phase}.png`);
    writeFileSync(
      join(root, `typography-${phase}.json`),
      JSON.stringify(
        {
          status: expected ? 'PASS_REAL' : 'BASELINE_OBSERVED',
          phase,
          taskId,
          revision: task.tasks[0].body_revision,
          userData,
          sessionData,
          viewport: { width: 1440, height: 960, scale: 1 },
          fontState,
          renderedFonts,
          expected,
          textPreserved: true,
          glyphScope: expected
            ? 'Native font identity plus independently checked cmap/outlines for the fixed sample'
            : 'Baseline only; glyphCount cannot rule out .notdef and is not glyph acceptance',
          pdfCanvasSha256: createHash('sha256').update(pdfPixels).digest('hex'),
          realProviderCalls: 0,
          network: 'HTTP(S) denied in the isolated session',
          notRun: [
            'Physical network disconnection',
            'All Unicode characters',
            'Windows/Linux',
            'Human acceptance',
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    writeFileSync(
      join(root, `typography-${phase}.json`),
      JSON.stringify(
        {
          status: 'FAIL',
          stage,
          message: error instanceof Error ? error.message : 'Typography failed',
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    window.webContents.debugger.detach();
    window.destroy();
  }
}
