import { assertExportFontCoverage } from './adapters/export-font-coverage';
import { createExportConfigurationResolver } from './adapters/export-configuration';
import { defaultExportStyle } from '@caselite/contracts';
import type { createTaskApplication } from '@caselite/application';
import { app, session, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';

// 仅沿已有临时合成目录门禁运行；不读正式资料或密钥，不放宽Electron沙箱。
export async function runExportStyleDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  tasks: ReturnType<typeof createTaskApplication>,
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (path) => !path?.startsWith(root + '/'),
    )
  )
    throw new Error('Export isolation failed');
  const fonts = createExportConfigurationResolver();
  const resource = await fonts.resolve(defaultExportStyle);
  await fonts.verify(resource);
  const fontBytes = await fonts.readFont(resource);
  if (createHash('sha256').update(fontBytes).digest('hex') !== resource.font.sha256)
    throw new Error('Font resource mismatch');
  assertExportFontCoverage(fontBytes, '合成中文验收，逯禤甯喆堃垚翊祎龘。');
  let missingRejected = false;
  try {
    assertExportFontCoverage(fontBytes, '合成姓名𠮷');
  } catch (error) {
    missingRejected = error instanceof Error && error.message === 'PDF_GLYPH_UNAVAILABLE';
  }
  if (!missingRejected) throw new Error('Unsupported glyph was not rejected');
  const listing = tasks.execute({ protocol_version: 1, operation: 'list' });
  if (!listing.ok) throw new Error('Missing export samples');
  let task = listing.tasks.find((row) => row.title.includes('合成文档甲'))!;
  if (!task) throw new Error('Missing export document');
  if (phase === 'export-style-write') {
    const doc = new Y.Doc();
    const paragraph = (value: string) => {
      const p = new Y.XmlElement('paragraph'),
        t = new Y.XmlText();
      t.insert(0, value);
      p.insert(0, [t]);
      return p;
    };
    const rows = Array.from({ length: 64 }, (_, i) => {
      const row = new Y.XmlElement('tableRow');
      row.insert(
        0,
        ['事项' + (i + 1), '合成金额 ' + (i + 1) + '00 元'].map((value) => {
          const cell = new Y.XmlElement(i === 0 ? 'tableHeader' : 'tableCell');
          cell.insert(0, [paragraph(value)]);
          return cell;
        }),
      );
      return row;
    });
    const table = new Y.XmlElement('table');
    table.insert(0, rows);
    doc
      .getXmlFragment('default')
      .insert(0, [
        ...Array.from({ length: 24 }, (_, i) =>
          paragraph(`第${i + 1}条 合成导出验收。付款期限为十日，旧稿不因继续编辑发生变化。`),
        ),
        table,
      ]);
    const saved = tasks.execute({
      protocol_version: 1,
      operation: 'save',
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
      task_id: task.id,
      document_id: task.document_id,
      body_id: task.body_id,
      expected_revision: task.body_revision,
      editor_schema: 1,
      state: Array.from(Y.encodeStateAsUpdate(doc)),
    });
    doc.destroy();
    if (!saved.ok) throw new Error('Synthetic body save failed');
    task = saved.tasks[0];
  }
  const window = await createWindow();
  window.setContentSize(1440, 960);
  const wc = window.webContents;
  wc.setBackgroundThrottling(false);
  wc.debugger.attach('1.3');
  const evaluate = (source: string) => wc.executeJavaScript(source);
  const capture = async (name: string) => {
    await evaluate('document.fonts.ready');
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(root, name + '.png'), (await wc.capturePage()).toPNG());
  };
  const wait = async (condition: string) => {
    for (let i = 0; i < 250; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    await capture('export-failure');
    writeFileSync(join(root, 'export-failure.txt'), await evaluate('document.body.innerText'));
    throw new Error('Export condition failed: ' + condition);
  };
  const button = async (name: string) => {
    const query = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)}&&!b.disabled)`;
    await wait(query);
    await evaluate(`${query}.click()`);
  };
  const click = async (selector: string) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const field = async (label: string, value: string) => {
    const q = `document.querySelector('[aria-label="${label}"]')`;
    await wait(q);
    await evaluate(
      `(()=>{const e=${q};Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
    );
  };
  try {
    await click('[data-nav=settings]');
    await button('编辑器');
    await wait("document.querySelector('.export-style-settings:not(:disabled)')");
    if (phase === 'export-style-write') {
      await field('导出纸张', 'Letter');
      await field('导出字号', '14');
      for (const [side, value] of [
        ['上', '18'],
        ['右', '24'],
        ['下', '22'],
        ['左', '26'],
      ])
        await field('导出' + side + '边距', value);
      await field('导出页眉', '合成验收 {page}/{pages}');
      await field('导出页脚', '固定版本 · 合成资料');
      await button('保存编辑器设置');
    }
    await wait(
      "document.querySelector('[aria-label=导出纸张]')?.value==='Letter' && document.querySelector('[aria-label=导出页脚]')?.value==='固定版本 · 合成资料' && [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存编辑器设置')?.disabled",
    );
    await capture('export-settings-' + phase);
    await click('[data-nav=documents]');
    await click(`[data-document-id="${task.document_id}"]`);
    await button('交付版本');
    if (phase === 'export-style-write') {
      await button('固定当前修订');
      await wait("document.querySelector('.delivery-version-row[aria-pressed=true]')");
      const latest = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      if (!latest.ok) throw new Error('Missing working draft');
      const doc = new Y.Doc(),
        p = new Y.XmlElement('paragraph'),
        text = new Y.XmlText();
      text.insert(0, 'ONLY-IN-V2 合成新稿付款期限三十日，旧快照必须保留十日。');
      p.insert(0, [text]);
      doc.getXmlFragment('default').insert(0, [p]);
      const saved = tasks.execute({
        protocol_version: 1,
        operation: 'save',
        request_id: randomUUID(),
        idempotency_key: randomUUID(),
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: latest.tasks[0].body_revision,
        editor_schema: 1,
        state: Array.from(Y.encodeStateAsUpdate(doc)),
      });
      doc.destroy();
      if (!saved.ok) throw new Error('New working draft save failed');
    }
    await wait("document.querySelector('.delivery-version-row[aria-pressed=true]')");
    if (phase === 'export-style-write') {
      await button('导出此版本 Word');
      await wait(
        "document.querySelector('.delivery-word-controls')?.textContent.includes('输出摘要')",
      );
      await button('导出此版本 Word');
      await wait(
        "document.querySelector('.delivery-word-controls')?.textContent.includes('输出摘要') && [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出此版本 Word'&&!b.disabled)",
      );
    }
    await button('PDF');
    if (phase === 'export-style-write') await button('导出此版本 PDF');
    await button('预览最终 PDF');
    await wait(
      "document.querySelector('.react-pdf__Page__canvas') && document.querySelector('.react-pdf__Page__textContent')?.textContent.includes('付款期限为十日')",
    );
    await evaluate("document.querySelector('.material-reader').scrollIntoView({block:'center'})");
    await capture('export-pdf-' + phase);
    const evidence = await evaluate(
      `(async()=>{const prefs=await window.caselite.preferences({protocol_version:1,operation:'read'});const list=await window.caselite.task({protocol_version:1,operation:'list_snapshots',task_id:'${task.id}',document_id:'${task.document_id}',offset:0});const snapshot=list.snapshots[0];const records=[];for(const format of ['docx','pdf']){const r=await window.caselite.task({protocol_version:1,operation:'read_export',task_id:'${task.id}',document_id:'${task.document_id}',snapshot_id:snapshot.id,format,export_style:prefs.preferences.export_style,include_history:true});if(!r.ok||r.exports?.[0]?.status!=='ready')throw Error('Missing ready '+format);records.push(r.exports[0]);}return {preferences:prefs.preferences,snapshot,records};})()`,
    );
    const legacyRecords =
      phase === 'export-style-write'
        ? await evaluate(
            `(async()=>{const records=[];for(const format of ['docx','pdf']){const request={protocol_version:1,operation:'export_snapshot',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),task_id:'${task.id}',document_id:'${task.document_id}',snapshot_id:'${evidence.snapshot.id}',format};const result=await window.caselite.task(request);if(!result.ok||result.exports?.[0]?.configuration)throw Error('Legacy export failed');records.push({request,result});}return records;})()`,
          )
        : JSON.parse(readFileSync(join(root, 'export-style-write.json'), 'utf8')).legacyRecords;
    for (const row of evidence.records) {
      const bytes = readFileSync(
        join(root, 'userData', 'delivery-exports', 'fixed', row.id + '.' + row.format),
      );
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256)
        throw new Error('Artifact disk hash mismatch');
    }
    if (phase !== 'export-style-write') {
      const old = JSON.parse(readFileSync(join(root, 'export-style-write.json'), 'utf8'));
      if (JSON.stringify(old.records) !== JSON.stringify(evidence.records))
        throw new Error('Restart changed exports');
    }
    writeFileSync(
      join(root, phase + '.json'),
      JSON.stringify(
        {
          ...evidence,
          legacyRecords,
          providerCalls: 0,
          synthetic: true,
          systemIme: 'NOT_RUN',
          savedCopy: 'NOT_RUN: native save panel is verified separately',
        },
        null,
        2,
      ),
    );
    if (phase === 'export-style-preview')
      window.setTitle('CaseLite · 统一导出样式与最终PDF验收 · 合成资料');
  } finally {
    if (wc.debugger.isAttached()) wc.debugger.detach();
  }
}
