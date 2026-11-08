import type { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
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
  const materialSnapshot = (items: Material[]) =>
    items.map((item) => ({
      id: item.id,
      hash: item.sha256,
      status: item.status,
      pages: item.pages.map((page) => ({ page: page.page, text: page.text, origin: page.origin })),
    }));
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
    await evaluate(`document.querySelector('[data-row-task="${id}"] .task-row-title').click()`);
    await waitFor("Boolean(document.querySelector('[data-testid=task-result-tab]'))");
    await evaluate("document.querySelector('[data-testid=task-result-tab]').click()");
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
  async function reattach(file: string) {
    const before = await list();
    await drop(file);
    await waitFor("!document.querySelector('.material-staged')");
    const after = await settled();
    const added = after.filter((item) => !before.some((old) => old.id === item.id));
    // 重新上传创建新来源版本；旧原件身份与字节不得被覆盖，也不能自动选回旧材料。
    if (
      added.length !== 1 ||
      after.length !== before.length + 1 ||
      !before.some((old) => old.name === file && old.sha256 === added[0].sha256) ||
      before.some((old) => after.find((item) => item.id === old.id)?.sha256 !== old.sha256)
    )
      throw new Error('Reattaching a PDF changed existing sources');
    return added[0];
  }
  async function assertSelection(ids: string[]) {
    const state = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
    );
    const actual = state.runs
      .at(-1)
      ?.attachments?.map((item: { source_id: string }) => item.source_id)
      .sort();
    if (!state.ok || JSON.stringify(actual) !== JSON.stringify([...ids].sort()))
      throw new Error('Run included an unselected source version');
  }
  async function docxStructure(selector: string) {
    const structure = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      return {
        listItems: node.querySelectorAll('ol > li').length,
        tables: node.querySelectorAll('table').length,
        horizontal: node.querySelector('td[colspan="2"]')?.textContent,
        vertical: node.querySelector('td[rowspan="2"]')?.textContent,
        text: node.textContent,
      };
    })()`);
    if (
      structure.listItems !== 2 ||
      structure.tables !== 2 ||
      structure.horizontal !== '横向合并' ||
      structure.vertical !== '纵向合并' ||
      !structure.text.includes('付款期限：新期限十日') ||
      ['旧期限三十日', '核对交付日期', '页眉保真标记', '页脚保真标记'].some((text) =>
        structure.text.includes(text),
      )
    )
      throw new Error('Unexpected DOCX structure');
    return structure;
  }
  async function savedDocxTask(id: string) {
    const result = await evaluate(
      `window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(id)}})`,
    );
    if (!result.ok || result.tasks[0]?.id !== id || !result.state?.length)
      throw new Error('Draft did not persist as Yjs');
    return {
      revision: result.tasks[0].body_revision,
      stateBytes: result.state.length,
      stateSha256: createHash('sha256').update(Buffer.from(result.state)).digest('hex'),
    };
  }
  try {
    await waitFor("Boolean(document.querySelector('.material-composer'))");
    if (phase === 'materials-docx-reopen') {
      stage = 'docx-reopen';
      const prior = JSON.parse(readFileSync(join(directory, 'docx-result.json'), 'utf8'));
      const [item] = await settled();
      if (
        item?.id !== prior.sourceId ||
        item.asset_version_id !== prior.assetVersion ||
        item.sha256 !== prior.sha256
      )
        throw new Error('Fixed original identity changed on restart');
      const reopened = await savedDocxTask(item.task_id);
      if (JSON.stringify(reopened) !== JSON.stringify(prior.edited))
        throw new Error('Draft changed on restart');
      await openTask(item.task_id);
      const structure = await docxStructure('[data-testid=body-editor]');
      if (!structure.text.includes('隔离实测：已保存后重开。'))
        throw new Error('Edited text missing on restart');
      await capture('05-docx-reopened');
      writeFileSync(
        join(directory, 'docx-reopened.json'),
        JSON.stringify(
          { ...reopened, structure, sourceId: item.id, assetVersion: item.asset_version_id },
          null,
          2,
        ),
      );
      return;
    }
    if (phase === 'materials-read') {
      const items = await list();
      const saved = JSON.parse(readFileSync(join(directory, 'materials-write.json'), 'utf8'));
      if (
        items.length !== 4 ||
        JSON.stringify(materialSnapshot(items)) !== JSON.stringify(saved.materials)
      )
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
    if (
      phase === 'materials-docx' ||
      phase === 'materials-docx-lists' ||
      phase === 'materials-docx-recovery'
    ) {
      stage = 'docx-import';
      await drop('中文合同.docx');
      await waitFor(
        "!document.querySelector('.material-staged') || Boolean(document.querySelector('.material-error'))",
      );
      const [item] = await settled();
      const page = item?.pages.find((entry) => entry.text.includes('新期限十日'));
      if (item?.status !== 'ready' || !page?.docx_review?.revisions || !page.docx_review.comments)
        throw new Error('Missing DOCX extraction or review flags');
      await click('中文合同.docx');
      await waitFor("Boolean(document.querySelector('.material-docx-reader input'))");
      await evaluate(
        "[...document.querySelectorAll('.material-docx-reader label')].find(x=>x.textContent.includes('新期限十日')).querySelector('input').click()",
      );
      await capture('01-docx-selection');
      stage = 'docx-structured-preview';
      await click('预览可编辑草稿');
      await waitFor("Boolean(document.querySelector('[data-testid=docx-draft-preview]'))");
      const structure = await docxStructure('[data-testid=docx-draft-preview]');
      await capture('02-docx-preview');
      await click('确认保存草稿');
      await waitFor(
        "document.querySelector('[data-testid=docx-draft-status]')?.textContent.includes('草稿已保存')",
      );
      const firstDraft = await savedDocxTask(item.task_id);
      if (firstDraft.revision !== 1) throw new Error('Unexpected initial revision');
      await click('收起阅读');
      stage = 'docx-send';
      const prompt =
        phase === 'materials-docx-recovery'
          ? '取消恢复测试：仅核对选中段的付款期限。'
          : '仅核对选中段的付款期限。';
      await evaluate(
        `document.querySelector('[data-testid=agent-input]').focus();document.execCommand('insertText',false,${JSON.stringify(prompt)})`,
      );
      await evaluate("document.querySelector('.assistant-compose').requestSubmit()");
      if (phase === 'materials-docx-recovery') {
        stage = 'docx-cancel-restore';
        await waitFor("Boolean(document.querySelector('button[aria-label=停止生成]'))");
        await evaluate("document.querySelector('button[aria-label=停止生成]').click()");
        await waitFor("Boolean(document.querySelector('.assistant-run-status.cancelled'))");
        await click('恢复上轮要求与原选段');
        await waitFor(
          `document.querySelector('[data-testid=agent-input]')?.value===${JSON.stringify(prompt)}`,
        );
        const state = await evaluate(
          "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
        );
        if (!state.ok || state.runs.length !== 1 || state.runs[0].status !== 'cancelled')
          throw new Error('Restore dispatched a new run');
        await capture('07-restored-input');
        writeFileSync(
          join(directory, 'composer-recovery.json'),
          JSON.stringify({
            cancelled: true,
            restoredPrompt: true,
            noAutomaticRetry: true,
            attachments: state.runs[0].attachments,
          }),
        );
        await evaluate("document.querySelector('.assistant-compose').requestSubmit()");
      }
      await waitFor(
        "Boolean(document.querySelector('.assistant-run-status.succeeded') && document.querySelector('.message-attachments button'))",
      );
      const context = readFileSync(join(directory, 'material-pi-context.json'), 'utf8');
      if (
        !context.includes('新期限十日') ||
        context.includes('旧期限三十日') ||
        context.includes('交付条款正文') ||
        context.includes('核对交付日期')
      )
        throw new Error('Unexpected provider input');
      await waitFor(
        "[...document.querySelectorAll('.assistant-message--assistant')].some(node => node.textContent.includes('付款期限：新期限十日'))",
      );
      await capture('03-docx-model-input');
      stage = 'docx-original';
      await evaluate("document.querySelector('.message-attachments button').click()");
      await waitFor(
        "Boolean(document.querySelector('.material-docx-reader')?.textContent.includes('固定原件已校验'))",
      );
      const original = await evaluate(
        `(async()=>{const r=await window.caselite.material({protocol_version:1,operation:'read',scope:'home',source_id:'${item.id}'});return [...r.data]})()`,
      );
      const hash = createHash('sha256').update(Buffer.from(original)).digest('hex');
      if (
        hash !== item.sha256 ||
        !Buffer.from(original).equals(readFileSync(join(directory, '中文合同.docx')))
      )
        throw new Error('Fixed original bytes mismatch');
      await capture('04-docx-original');
      await click('收起阅读');
      stage = 'docx-edit-draft';
      await openTask(item.task_id);
      await docxStructure('[data-testid=body-editor]');
      await evaluate(`(() => {
        const body = document.querySelector('[data-testid=body-editor]');
        const paragraph = [...body.querySelectorAll('p')].find(p => p.textContent.includes('Word复核段'));
        window.getSelection().collapse(paragraph, paragraph.childNodes.length);
        body.focus();
        document.execCommand('insertText', false, '隔离实测：已保存后重开。');
      })()`);
      await waitFor(
        "Boolean(document.querySelector('[data-testid=body-editor]')?.textContent.includes('隔离实测：已保存后重开。'))",
      );
      await click('保存正文');
      await waitFor("document.querySelector('[data-testid=revision]')?.textContent === '2'");
      const edited = await savedDocxTask(item.task_id);
      if (firstDraft.stateSha256 === edited.stateSha256) throw new Error('Edit was not saved');
      writeFileSync(
        join(directory, 'docx-result.json'),
        JSON.stringify(
          {
            sourceId: item.id,
            assetVersion: item.asset_version_id,
            sha256: hash,
            selected: page.page,
            review: page.docx_review,
            provider: 'MOCK_ONLY',
            network: 'OS network denied and Chromium offline',
            structure,
            firstDraft,
            edited,
          },
          null,
          2,
        ),
      );
      if (phase === 'materials-docx-lists') {
        stage = 'docx-directory';
        const projectId = await evaluate(`(async()=>{
          const mutation=()=>({protocol_version:1,request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
          for(let i=1;i<=25;i++){const r=await window.caselite.task({...mutation(),operation:'create',title:'合成分页合同'+String(i).padStart(2,'0'),objective:''});if(!r.ok)throw new Error('Seed task failed');}
          const p=await window.caselite.catalog({...mutation(),operation:'create_project',title:'合成Word原件项目'});if(!p.ok)throw new Error('Seed project failed');
          const t=await window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(item.task_id)}});
          const r=await window.caselite.catalog({...mutation(),operation:'assign_task',task_id:${JSON.stringify(item.task_id)},expected_version:t.tasks[0].version,matter_id:p.target_id});if(!r.ok)throw new Error('Assign failed');return p.target_id;
        })()`);
        await evaluate("document.querySelector('[data-nav=documents]').click()");
        await waitFor("document.querySelectorAll('[data-document-id]').length===20");
        await click('下一页');
        await waitFor("document.querySelectorAll('[data-document-id]').length===6");
        await capture('08-document-pagination');
        await evaluate("document.querySelector('[data-nav=projects]').click()");
        await waitFor("Boolean(document.querySelector('.project-title-link'))");
        await click('合成Word原件项目');
        await waitFor("Boolean(document.querySelector('[aria-label=编辑项目名称]'))");
        await click('文件');
        await waitFor(`Boolean(document.querySelector('[data-source-id="${item.id}"]'))`);
        await evaluate(
          `document.querySelector('[data-source-id="${item.id}"] .project-file-name').click()`,
        );
        await waitFor("Boolean(document.querySelector('.material-docx-reader'))");
        await capture('09-project-word-original');
        const original = await evaluate(
          `window.caselite.material({protocol_version:1,operation:'read_project',project_id:${JSON.stringify(projectId)},source_id:${JSON.stringify(item.id)}})`,
        );
        if (
          !original.ok ||
          createHash('sha256').update(Buffer.from(original.data)).digest('hex') !== hash
        )
          throw new Error('Project original mismatch');
        writeFileSync(
          join(directory, 'lists-result.json'),
          JSON.stringify({
            projectId,
            pagination: [20, 6],
            originalSha256: hash,
            sourceId: item.id,
          }),
        );
      }
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
    const secondText = await reattach('text.pdf');
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
    if (items.length !== 3) throw new Error('Missing second attachment');
    let scan = items.find((item) => item.name === 'scan.pdf')!;
    await assertSelection([secondText.id, scan.id]);
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
    scan = await reattach('scan.pdf');
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
    if (items.length !== 4) throw new Error('Missing reattached scan source');
    await assertSelection([scan.id]);
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
      "[...document.querySelectorAll('.message-attachments button')].filter(b=>b.textContent.includes('scan.pdf')).at(-1).click()",
    );
    await waitFor("Boolean(document.querySelector('.material-paper canvas')?.width)");
    await click('提取文字（离线）');
    await waitFor(
      `window.caselite.material({protocol_version:1,operation:'list',scope:'home'}).then(r=>r.ok && r.materials.some(m=>m.id===${JSON.stringify(scan.id)} && m.derivation_id!==${JSON.stringify(oldDerivation)} && m.status==='ready'))`,
    );
    await capture('chat-offline-reader');
    await click('收起阅读');
    items = await settled();
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
          materials: materialSnapshot(items),
          ocrMs,
          importPendingAtSend,
          visualImages: images.length,
          inputCleared: true,
          offlineReaderWithoutKey: true,
          attachmentMessages: 3,
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
