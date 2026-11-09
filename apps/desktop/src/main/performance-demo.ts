import { app, session, type BrowserWindow } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import * as Y from 'yjs';
import type {
  createTaskApplication,
  createCatalogApplication,
  createContactsApplication,
  createFinanceApplication,
} from '@caselite/application';

type Tasks = ReturnType<typeof createTaskApplication>;
type Catalog = ReturnType<typeof createCatalogApplication>;
type Sample = { operation: string; ms: number; ok: boolean; code?: string };
export const applicationSamples: Sample[] = [];
export function performanceApplication<T extends { execute(input: unknown): unknown }>(
  name: string,
  application: T,
): T {
  return {
    ...application,
    execute(input: unknown) {
      const start = performance.now();
      let ok = false;
      try {
        const result = application.execute(input);
        ok = Boolean((result as { ok?: boolean })?.ok);
        return result;
      } finally {
        applicationSamples.push({
          operation: `${name}.${String((input as { operation?: string })?.operation)}${name === 'task' && (input as { operation?: string })?.operation === 'list' ? ((input as { query?: unknown }).query ? '.page' : '.full') : ''}`,
          ms: performance.now() - start,
          ok,
        });
      }
    },
  } as T;
}
const mutation = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
export function seedPerformance(
  root: string,
  tasks: Tasks,
  catalog: Catalog,
  contacts: ReturnType<typeof createContactsApplication>,
  finance: ReturnType<typeof createFinanceApplication>,
) {
  const count = Number(process.env.CASELITE_PERFORMANCE_COUNT);
  if (![10, 1000].includes(count)) throw new Error('Performance count must be 10 or 1000');
  const existing = tasks.execute({ protocol_version: 1, operation: 'list' });
  if (!existing.ok || existing.tasks.length)
    throw new Error('Performance seed requires empty synthetic workspace');
  const projects: string[] = [];
  for (let i = 0; i < 10; i++) {
    const p = catalog.execute({
      ...mutation(),
      operation: 'create_project',
      title: `合成性能项目${String(i).padStart(2, '0')}`,
    });
    if (!p.ok) throw new Error('Project seed failed');
    const id = p.projects.find((p) => p.title === `合成性能项目${String(i).padStart(2, '0')}`)!.id;
    projects.push(id);
    const f = finance.execute({
      ...mutation(),
      operation: 'register_contract',
      project_id: id,
      number: `SYNTHETIC-${i}`,
      amount_cents: 10000,
      installments: [{ amount_cents: 10000, due_date: '2026-11-09' }],
    });
    if (!f.ok) throw new Error('Finance seed failed');
  }
  const doc = new Y.Doc();
  const content = Array.from(
    { length: 16 },
    (_, i) => `合成测试段落${i}：仅用于本机性能测量，不包含真实案件或客户资料。`,
  );
  doc.getXmlFragment('default').insert(
    0,
    content.map((line) => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, line);
      p.insert(0, [t]);
      return p;
    }),
  );
  const state = Array.from(Y.encodeStateAsUpdate(doc));
  const manifest = {
    seed: 'dev1838-v1',
    count,
    projects,
    tasks: [] as string[],
    documents: [] as string[],
    bodySha256: createHash('sha256').update(Buffer.from(state)).digest('hex'),
    content,
  };
  for (let i = 0; i < count; i++) {
    const r = tasks.execute({
      ...mutation(),
      operation: 'create',
      title: `合成性能任务${String(i).padStart(4, '0')}`,
      objective: '合成工作目标',
      matter_id: projects[i % 10],
      due_date: '2026-11-09',
    });
    if (!r.ok) throw new Error('Task seed failed');
    const t = r.tasks[0];
    const saved = tasks.execute({
      ...mutation(),
      operation: 'save',
      task_id: t.id,
      document_id: t.document_id,
      body_id: t.body_id,
      expected_revision: 0,
      editor_schema: 1,
      state,
    });
    if (!saved.ok) throw new Error('Body seed failed');
    const list = catalog.execute({ protocol_version: 1, operation: 'list' });
    if (!list.ok) throw new Error('Catalog seed read failed');
    const d = list.documents.find((d) => d.id === t.document_id)!;
    const organized = catalog.execute({
      ...mutation(),
      operation: 'organize_document',
      id: d.id,
      expected_version: d.version,
      collection: '合成性能样本',
      tags: ['合成'],
      favorite: false,
      in_library: true,
    });
    if (!organized.ok) throw new Error('Knowledge seed failed');
    const c = contacts.execute({
      protocol_version: 1,
      operation: 'save',
      contact_id: randomUUID(),
      expected_version: 0,
      receipt: randomUUID(),
      name: `合成联系人${String(i).padStart(4, '0')}`,
      kind: 'person',
      phone: '',
      email: '',
      project_ids: [projects[i % 10]],
    });
    if (!c.ok) throw new Error('Contacts seed failed');
    manifest.tasks.push(t.id);
    manifest.documents.push(t.document_id);
  }
  doc.destroy();
  writeFileSync(join(root, 'performance-manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
  });
}

export async function runPerformance(
  create: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + sep),
    )
  )
    throw new Error('Performance isolation failed');
  const resourceStarts = new Map<number, number>();
  const localResources: unknown[] = [];
  let blockedHttpRequests = 0;
  session.defaultSession.webRequest.onBeforeRequest((r, done) => {
    const blocked = /^https?:/i.test(r.url);
    if (blocked) blockedHttpRequests++;
    else if (r.url.startsWith('file:')) resourceStarts.set(r.id, performance.now());
    done({ cancel: blocked });
  });
  session.defaultSession.webRequest.onCompleted((r) => {
    const start = resourceStarts.get(r.id);
    resourceStarts.delete(r.id);
    if (start !== undefined && localResources.length < 2000)
      localResources.push({
        name: new URL(r.url).pathname.split('/').pop(),
        type: r.resourceType,
        ms: performance.now() - start,
        statusCode: r.statusCode,
      });
  });
  applicationSamples.length = 0;
  const manifest = JSON.parse(readFileSync(join(root, 'performance-manifest.json'), 'utf8'));
  const window = await create();
  window.setContentSize(1440, 900);
  window.setTitle('CaseLite · DEV-1838 性能测量 · 隔离合成资料');
  window.show();
  app.focus({ steal: true });
  window.focus();
  const wc = window.webContents;
  const evaluate = (code: string) => wc.executeJavaScript(code);
  const results: unknown[] = [];
  let fatalError: string | null = null;
  // 计时与完成条件都在同一Renderer执行，工具往返、截图和播种不计入UI耗时。
  const waitUntimed = async (condition: string) => {
    await evaluate(
      `new Promise((resolve,reject)=>{const deadline=performance.now()+15000;const check=()=>{if(${condition})return resolve();if(performance.now()>deadline)return reject(Error('setup readiness timeout'));requestAnimationFrame(check);};check();})`,
    );
  };
  const measure = async (name: string, action: string, ready: string, n = 5, prepare = '') => {
    for (let i = 0; i < n; i++) {
      const row = await evaluate(`(async()=>{
        let start, error=null, stage='prepare';
        try { ${prepare}; start=performance.now();stage='operation'; ${action};
          await new Promise((resolve,reject)=>{const deadline=performance.now()+15000; const check=async()=>{try { if (await (${ready})) {resolve();return;} if(performance.now()>deadline){reject(Error('readiness timeout'));return;} requestAnimationFrame(check);}catch(e){reject(e);}};check();});
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        } catch(e){error=String(e);}
        return {operation:${JSON.stringify(name)}, index:${i}, startTime:start, endTime:performance.now(), ms:start===undefined?null:performance.now()-start, ok:!error,error,stage,visibility:document.visibilityState,focused:document.hasFocus()};
      })()`);
      results.push(row);
    }
  };
  const ready = `document.querySelector('[data-nav=home]') && document.querySelector('[data-testid=agent-input]') && !document.querySelector('.loading')`;
  await measure('startup.renderer-ready', '', ready, 1);
  const started = process.env.CASELITE_PERFORMANCE_START_NS;
  const startupMs =
    started && /^\d+$/.test(started)
      ? Number(process.hrtime.bigint() - BigInt(started)) / 1e6
      : null;
  await evaluate(
    `(()=>{window.__perfLong=[];try{new PerformanceObserver(list=>window.__perfLong.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});}catch{};})()`,
  );
  const nav = (page: string) => `document.querySelector('[data-nav=${page}]').click()`;
  const visibleReady = (selector: string) =>
    `document.querySelector(${JSON.stringify(selector)}) && ![...document.querySelectorAll('.workspace-main [role=status]')].some(e=>e.getClientRects().length && /正在(读取|加载)|加载中/.test(e.textContent))`;
  const pages: Record<string, string> = {
    home: '[data-testid=agent-input]',
    calendar: '[aria-label=日历工作台]',
    tasks: '[data-collection=tasks] [data-row-task]',
    projects: '[data-testid=project-catalog] [data-project-id]',
    documents: '[data-collection=documents] [data-document-id]',
    knowledge: '[data-collection=knowledge] [data-document-id]',
    finance: '.finance-totals',
    contacts: '.contacts-workbench .collection-footer',
    settings: '.settings-back',
  };
  try {
    if (phase === 'performance-run') {
      await measure('observer.double-raf', '', 'true', 30);
      for (let round = 0; round < 5; round++)
        for (const [page, selector] of Object.entries(pages))
          await measure(`nav.${page}`, nav(page), visibleReady(selector), 1);
      const settingsLabels: string[] = await evaluate(
        `[...document.querySelectorAll('.settings-navigation nav button')].map(e=>e.textContent.trim())`,
      );
      for (let round = 0; round < 5; round++)
        for (const label of settingsLabels)
          await measure(
            'settings.' + label,
            `[...document.querySelectorAll('.settings-navigation nav button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`,
            `document.querySelector('.settings-page h2')?.textContent===${JSON.stringify(label)}`,
            1,
          );
      const firstTask = manifest.tasks.at(-1);
      const firstProject = manifest.projects[0];
      const firstDocument = manifest.documents.at(-1);
      // Query样本逐次调用既有typed API，失败回执原样计入，绝不重试写入。
      for (const [owner, request] of [
        ['task', { operation: 'list', protocol_version: 1 }],
        [
          'task',
          {
            operation: 'list',
            protocol_version: 1,
            query: {
              scope: { type: 'workspace' },
              text: '',
              status: null,
              priority: null,
              dates: 'all',
              from: null,
              to: null,
              body: 'all',
              sort: 'updated',
              offset: 0,
            },
          },
        ],
        ['task', { operation: 'read', protocol_version: 1, task_id: firstTask }],
        ['catalog', { operation: 'list', protocol_version: 1 }],
        ['catalog', { operation: 'read_project', protocol_version: 1, id: firstProject }],
        ['contacts', { operation: 'list', protocol_version: 1 }],
        ['finance', { operation: 'read', protocol_version: 1, project_id: firstProject }],
      ] as const) {
        const rows = await evaluate(
          `(async()=>{const rows=[];for(let i=0;i<30;i++){const start=performance.now();let r,error;try{r=await window.caselite[${JSON.stringify(owner)}](${JSON.stringify(request)});}catch(e){error=String(e);}rows.push({operation:${JSON.stringify('ipc.' + owner + '.' + request.operation + ('query' in request ? '.page' : ''))},index:i,ms:performance.now()-start,ok:r?.ok===true,code:r?.code,error});}return rows;})()`,
        );
        results.push(...rows);
      }
      const click = (selector: string) =>
        `document.querySelector(${JSON.stringify(selector)}).click()`;
      const named = (text: string) =>
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled)`;
      for (const file of ['text.pdf', 'scan.pdf', 'sample.docx']) {
        await evaluate(
          `(()=>{document.querySelector('#performance-file')?.remove();const e=document.createElement('input');e.type='file';e.id='performance-file';e.hidden=true;document.body.append(e);})()`,
        );
        wc.debugger.attach('1.3');
        try {
          const document = await wc.debugger.sendCommand('DOM.getDocument');
          const { nodeId } = await wc.debugger.sendCommand('DOM.querySelector', {
            nodeId: document.root.nodeId,
            selector: '#performance-file',
          });
          await wc.debugger.sendCommand('DOM.setFileInputFiles', {
            nodeId,
            files: [join(root, file)],
          });
        } finally {
          wc.debugger.detach();
        }
        const rows = await evaluate(`(async()=>{
          const rows=[]; let start=performance.now();
          const staged=await window.caselite.dropPdf(document.querySelector('#performance-file').files[0],'home');
          rows.push({operation:'ipc.import.stage.${file}',ms:performance.now()-start,ok:staged.ok,code:staged.code});
          if(!staged.ok||!staged.staged)return rows;
          const commitStart=performance.now();const committed=await window.caselite.material({protocol_version:1,operation:'commit',scope:'home',token:staged.staged.token});
          rows.push({operation:'ipc.import.commit.${file}',ms:performance.now()-commitStart,ok:committed.ok,code:committed.code});
          if(!committed.ok)return rows;const source=committed.materials.find(m=>m.name===${JSON.stringify(file)});
          if(!source){rows.push({operation:'ipc.parse.${file}',ok:false,error:'committed source missing'});return rows;}
          let parsed=committed;const deadline=performance.now()+60000;
          while(parsed.ok&&parsed.materials.find(m=>m.id===source.id)?.status==='processing'&&performance.now()<deadline){await new Promise(r=>requestAnimationFrame(r));parsed=await window.caselite.material({protocol_version:1,operation:'list',scope:'home'});}
          let item=parsed.ok?parsed.materials.find(m=>m.id===source.id):undefined;
          rows.push({operation:'ipc.import.ready.${file}',ms:performance.now()-commitStart,ok:item?.status==='ready'||item?.status==='needs_ocr',code:parsed.code,message:parsed.message,status:item?.status,pages:item?.page_count,origins:item?.pages?.map(p=>p.origin),sha256:item?.sha256});
          if(${file === 'scan.pdf'}&&item?.status==='needs_ocr') {
            start=performance.now();parsed=await window.caselite.material({protocol_version:1,operation:'process',scope:'home',source_id:source.id,ocr:true});
            while(parsed.ok&&parsed.materials.find(m=>m.id===source.id)?.status==='processing'&&performance.now()<deadline){await new Promise(r=>requestAnimationFrame(r));parsed=await window.caselite.material({protocol_version:1,operation:'list',scope:'home'});}
            item=parsed.ok?parsed.materials.find(m=>m.id===source.id):undefined;
            rows.push({operation:'ipc.ocr.local-vision',ms:performance.now()-start,ok:item?.status==='ready',code:parsed.code,message:parsed.message,status:item?.status,pages:item?.page_count,origins:item?.pages?.map(p=>p.origin),sha256:item?.sha256});
          }
          return rows;
        })()`);
        results.push(...rows);
      }
      const snapshotRows = await evaluate(`(async()=>{
        const rows=[]; for(let i=0;i<5;i++) {
          const t=(await window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(firstTask)}})).tasks[0];
          let start=performance.now();const r=await window.caselite.task({protocol_version:1,operation:'create_snapshot',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),task_id:t.id,document_id:t.document_id,body_id:t.body_id,expected_revision:t.body_revision,expected_metadata_version:t.document_metadata_version,expected_task_version:t.version,note:'合成性能快照'});
          rows.push({operation:'ipc.snapshot.create',index:i,ms:performance.now()-start,ok:r.ok,code:r.code});
          if(!r.ok)continue;const snapshot=r.snapshots[0];
          for(const format of ['docx','pdf']) {start=performance.now();const e=await window.caselite.task({protocol_version:1,operation:'export_snapshot',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),task_id:t.id,document_id:t.document_id,snapshot_id:snapshot.id,format});rows.push({operation:'ipc.export.'+format,index:i,ms:performance.now()-start,ok:e.ok&&e.exports?.[0]?.status==='ready',code:e.code,export:e.exports?.[0]});}
        } return rows;
      })()`);
      results.push(...snapshotRows);
      for (let i = 0; i < 5; i++) {
        if (i > 0)
          await evaluate(`document.querySelector('.workspace-project-back-button').click()`);
        await evaluate(nav('projects'));
        await waitUntimed(
          `document.querySelector('[data-project-id="${firstProject}"] .project-title-link')`,
        );
        await measure(
          'project.open',
          `document.querySelector('[data-project-id="${firstProject}"] .project-title-link').click()`,
          visibleReady('#project-panel-overview:not([hidden])'),
          1,
        );
      }
      for (let i = 0; i < 5; i++)
        for (const tab of [
          'tasks',
          'files',
          'visualization',
          'deliverables',
          'activity',
          'overview',
        ])
          await measure(
            'project.tab.' + tab,
            click('#project-tab-' + tab),
            visibleReady('#project-panel-' + tab + ':not([hidden])') +
              (tab === 'visualization'
                ? ` && document.querySelector('#project-panel-visualization .react-flow__node')`
                : ''),
            1,
          );
      for (let i = 0; i < 5; i++) {
        await evaluate(nav('documents'));
        await waitUntimed(`document.querySelector('[data-document-id="${firstDocument}"]')`);
        await measure(
          'document.inspect',
          click(`[data-document-id="${firstDocument}"]`),
          `${named('打开正文')}`,
          1,
        );
        await measure(
          'document.body-open',
          `${named('打开正文')}.click()`,
          visibleReady('[data-testid=body-editor]'),
          1,
        );
        await measure(
          'document.save-ack',
          `document.querySelector('[data-testid=save-body]').click()`,
          `document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备' && (async()=>{const r=await window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(firstTask)}});window.__perfSaved=r;return r.ok&&r.tasks[0].body_revision===window.__perfBefore.tasks[0].body_revision+1;})()`,
          1,
          `window.__perfBefore=await window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(firstTask)}});if(!window.__perfBefore.ok)throw Error('baseline read failed');const e=document.querySelector('[data-testid=body-editor]');e.focus();const range=document.createRange();range.selectNodeContents(e);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);document.execCommand('insertText',false,'合成追加${i}');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(document.querySelector('[data-testid=save-body]').disabled||document.querySelector('[data-testid=save-status]').textContent!=='有未保存修改')throw Error('editor not dirty');`,
        );
        const saved = await evaluate('window.__perfSaved');
        if (saved?.ok && saved.state) {
          const body = new Y.Doc();
          Y.applyUpdate(body, new Uint8Array(saved.state));
          results.push({
            operation: 'verification.saved-content',
            ok: body
              .getXmlFragment('default')
              .toString()
              .includes('合成追加' + i),
            revision: saved.tasks[0].body_revision,
          });
          body.destroy();
        }
      }
      for (let i = 0; i < 5; i++) {
        await evaluate(nav('tasks'));
        await waitUntimed(
          `document.querySelector('[data-row-task="${firstTask}"] .task-row-title')`,
        );
        await measure(
          'task.detail-open',
          click(`[data-row-task="${firstTask}"] .task-row-title`),
          visibleReady('[data-testid=back-to-tasks]'),
          1,
        );
        await waitUntimed(`document.querySelector('[aria-label=任务优先级]:not(:disabled)')`);
        await measure(
          'task.properties-autosave',
          `const e=document.querySelector('[aria-label=任务优先级]');e.value=String(window.__perfPriority);e.dispatchEvent(new Event('change',{bubbles:true}));`,
          `(async()=>{const r=await window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(firstTask)}});return r.ok&&r.tasks[0].version===window.__perfBefore.tasks[0].version+1&&r.tasks[0].priority===window.__perfPriority&&!document.querySelector('.task-properties-editor [role=status]');})()`,
          1,
          `window.__perfBefore=await window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(firstTask)}});if(!window.__perfBefore.ok)throw Error('baseline read failed');window.__perfPriority=window.__perfBefore.tasks[0].priority===1?2:1;`,
        );
      }
      for (let i = 0; i < 5; i++) {
        await measure(
          'ai.expand',
          `${named('展开 AI 对话')}.click()`,
          `document.querySelector('[data-ai-expanded=true]')`,
          1,
        );
        await measure(
          'ai.collapse',
          `${named('收起 AI 对话')}.click()`,
          `document.querySelector('[data-ai-expanded=false]')`,
          1,
        );
      }
      await evaluate(nav('home'));
      await waitUntimed(`document.querySelector('[data-testid=agent-input]')`);
      await measure(
        'ai.local-input',
        `(()=>{const e=document.querySelector('[data-testid=agent-input]');e.focus();document.execCommand('insertText',false,'合成本地输入');})()`,
        `document.querySelector('[data-testid=agent-input]')?.textContent.includes('合成本地输入')`,
        5,
      );
      for (let i = 0; i < 5; i++) {
        await measure(
          'ai.mock-dispatch-to-running',
          `document.querySelector('[aria-label=发送]').click()`,
          `document.querySelector('[aria-label=停止生成]')`,
          1,
        );
        await measure(
          'ai.mock-stop',
          `document.querySelector('[aria-label=停止生成]').click()`,
          `!document.querySelector('[aria-label=停止生成]') && document.querySelector('[aria-label=发送]')`,
          1,
        );
        if (i < 4)
          await evaluate(
            `(()=>{const e=document.querySelector('[data-testid=agent-input]');e.focus();document.execCommand('insertText',false,'合成停止样本');})()`,
          );
      }
      // 真实Provider与外部OCR不在本次授权内；本地控制与Mock流另列，不能推断网络速度。
    }
  } catch (error) {
    fatalError = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw error;
  } finally {
    const resources = await evaluate(
      `({resources:performance.getEntriesByType('resource').map(e=>({name:e.name.split('/').pop(),startTime:e.startTime,duration:e.duration,transferSize:e.transferSize,decodedBodySize:e.decodedBodySize})),longTasks:window.__perfLong,visibility:document.visibilityState,focused:document.hasFocus(),fonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,status:f.status}))})`,
    );
    const current = await evaluate(
      `window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(manifest.tasks.at(-1))}})`,
    );
    if (current.ok) {
      const actual = {
        id: current.tasks[0].id,
        revision: current.tasks[0].body_revision,
        version: current.tasks[0].version,
        priority: current.tasks[0].priority,
        stateSha256: createHash('sha256')
          .update(Buffer.from(current.state ?? []))
          .digest('hex'),
      };
      const expectedFile = join(root, 'performance-expected.json');
      if (phase === 'performance-run')
        writeFileSync(expectedFile, JSON.stringify(actual), { flag: 'wx' });
      else if (existsSync(expectedFile))
        results.push({
          operation: 'verification.restart',
          ok: JSON.stringify(actual) === readFileSync(expectedFile, 'utf8'),
          actual,
        });
    }
    const output = {
      phase,
      fatalError,
      count: manifest.count,
      startupMs,
      window: window.getContentSize(),
      results,
      applicationSamples: [...applicationSamples],
      resources,
      localResources,
      blockedHttpRequests,
      cpu: process.getCPUUsage(),
      memory: process.memoryUsage(),
      network: 'HTTP(S) blocked',
      realProvider: 'NOT_RUN',
      physicalIme: 'NOT_RUN',
    };
    writeFileSync(join(root, 'performance-' + phase + '.json'), JSON.stringify(output, null, 2));
    await wc
      .capturePage()
      .then((image) => writeFileSync(join(root, 'performance-' + phase + '.png'), image.toPNG()));
    window.destroy();
  }
}
