import { app, session, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { syntheticTextStream } from './agent-demo';

// 仅从已验证的隔离演示入口注入；继续经过真实 Pi/Application/IPC，不接触系统凭据。
export function createSyntheticCustomerStream(root: string): StreamFn {
  const inputs: unknown[] = [];
  return (model, context, options) => {
    inputs.push(context.messages);
    writeFileSync(join(root, 'customer-mock-inputs.json'), JSON.stringify(inputs, null, 2));
    const text = JSON.stringify(context.messages);
    const ordinary = text.includes('修改合同需要注意什么');
    const output = ordinary
      ? '合成普通回答：请核对双方约定。'
      : JSON.stringify({
          kind: 'contact_record',
          title: '合成微信沟通',
          channel: 'wechat',
          occurred_on: '2026-11-10',
          summary: text.includes('日期改为今天')
            ? '客户确认已收到材料清单，沟通日期为今天。'
            : '客户确认已收到材料清单。',
        });
    return syntheticTextStream(model, context, options, [output]);
  };
}

export async function runCustomerDemo(
  createWindow: (show: boolean) => Promise<BrowserWindow>,
  root: string,
  phase: 'customer-write' | 'customer-read' | 'customer-preview',
) {
  for (const path of [
    app.getPath('userData'),
    app.getPath('sessionData'),
    session.defaultSession.storagePath,
  ])
    if (!path?.startsWith(root + sep)) throw Error('Customer demo requires isolated data');
  let httpAttempts = 0;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) httpAttempts++;
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  const window = await createWindow(phase === 'customer-preview');
  window.webContents.setBackgroundThrottling(false);
  window.setContentSize(1440, 960);
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const literal = JSON.stringify;
  const query = (selector: string) => `document.querySelector(${literal(selector)})`;
  const wait = async (condition: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`(async()=>Boolean(await (${condition})))()`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    writeFileSync(
      join(root, 'customer-failure-ui.json'),
      JSON.stringify(
        await evaluate(`({
      condition: ${literal(condition)}, text:document.body.innerText,
      fields:[...document.querySelectorAll('.contacts-inspector input,.contacts-inspector textarea')].map(e=>({tag:e.tagName,value:e.value,disabled:e.disabled,inert:!!e.closest('[inert]')})),
      split:document.querySelector('.contacts-inspector .inspector-split')?.dataset.aiExpanded,
    })`),
        null,
        2,
      ),
    );
    await capture('customer-failure.png');
    throw Error('Customer demo timed out: ' + condition);
  };
  const click = async (expression: string) => {
    await wait(`(${expression}) && !(${expression}).disabled`);
    await evaluate(`(${expression}).click()`);
  };
  const button = (label: string) =>
    click(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${literal(label)})`,
    );
  const fill = async (expression: string, value: string) => {
    await wait(expression);
    await evaluate(`(()=>{const field=${expression};field.focus();
      if(!document.hasFocus()) field.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
      Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(field,${literal(value)});
      field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const field = (label: string) =>
    `Array.from(document.querySelectorAll('.contacts-inspector label')).find(e=>e.textContent.trim().startsWith(${literal(label)}))?.querySelector('input,textarea')`;
  const select = async (selector: string, id: string) => {
    await wait(`${query(selector)}?.querySelector('option[value="${id}"]')`);
    await evaluate(
      `(()=>{const field=${query(selector)};for(const option of field.options)option.selected=option.value===${literal(id)};field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  };
  const capture = async (name: string) => {
    const debug = window.webContents.debugger;
    debug.attach('1.3');
    try {
      const { data } = await debug.sendCommand('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(root, name), Buffer.from(data, 'base64'));
    } finally {
      debug.detach();
    }
  };
  if (phase === 'customer-preview') {
    await click(query('[data-nav=contacts]'));
    window.setTitle('CaseLite · 联系人功能验收（Mock）');
    return;
  }
  const seed = await evaluate(`(async()=>{
    const catalog=await window.caselite.catalog({protocol_version:1,operation:'list'});
    const list=await window.caselite.task({protocol_version:1,operation:'list'});
    if(!catalog.ok || !list.ok)throw Error('Synthetic setup unavailable');
    let project=catalog.projects.find(p=>p.title==='合成客户验收项目');
    if(!project && ${phase === 'customer-write'}){
      const result=await window.caselite.catalog({protocol_version:1,operation:'create_project',title:'合成客户验收项目',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
      if(!result.ok)throw Error(result.message);project={id:result.target_id};
    }
    let task=list.tasks.find(t=>t.title==='合成客户验收任务');
    if(!task && ${phase === 'customer-write'}){
      const result=await window.caselite.task({protocol_version:1,operation:'create',title:'合成客户验收任务',objective:'',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()});
      if(!result.ok)throw Error(result.message);task=result.tasks[0];
    }
    if(!project || !task)throw Error('Missing reopened setup');
    return {project:project.id,task:task.id,document:task.document_id};
  })()`);
  await click(query('[data-nav=contacts]'));
  if (phase === 'customer-write') {
    await button('＋ 新建联系人');
    await fill(query('[aria-label="联系人姓名"]'), '合成客户张某');
    for (const [label, value] of [
      ['电话', '010-00000000'],
      ['微信', 'synthetic_wechat'],
      ['电子邮箱', 'demo@example.invalid'],
      ['地址', '北京合成办公地址'],
      ['标签', '合同业务，长期合作'],
    ])
      await fill(field(label), value);
    await select('.customer-profile-form select[multiple]', seed.project);
    await button('保存联系人');
    await wait(
      `${query('[aria-label="编辑电话"]')} && !${query('[aria-label="编辑电话"]')}.disabled`,
    );
    await click(query('[aria-label="编辑电话"]'));
    await fill(query('input[aria-label="电话"]'), '010-00000001');
    await click(query('[aria-label="保存电话"]'));
    await wait(`document.body.textContent.includes('电话已保存')`);
    await click(query('.customer-affiliation summary'));
    for (const [label, value] of [
      ['单位', '合成科技公司'],
      ['职务', '负责人'],
    ]) {
      await click(query(`[aria-label="编辑${label}"]`));
      await fill(query(`input[aria-label="${label}"]`), value);
      await click(query(`[aria-label="保存${label}"]`));
      await wait(`!${query('.customer-inline-editor')}`);
    }
    await evaluate(
      `${query('.customer-name')}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    await wait(query('.customer-detail-page'));
    await capture('contact-detail-inline.png');
    await button('← 返回联系人列表');
    await wait(`${query('.customer-list-page')}.hidden===false`);
    await button('＋ 手动记录');
    await fill(field('标题'), '合成电话记录');
    await fill(field('沟通内容'), '已向客户说明材料清单，客户表示明天补齐。');
    await select('.customer-entry-form select', 'phone');
    await fill(field('联系日期'), '2026-11-10');
    await button('保存记录');
    await wait(`${query('.customer-timeline')}?.textContent.includes('合成电话记录')`);
    await click(query('[role=tab][aria-label="备注（0）"]'));
    await button('＋ 添加备注');
    await fill(field('标题'), '合成备注');
    await fill(field('备注内容'), '优先通过微信联系。');
    await button('保存记录');
    await wait(`${query('.customer-timeline')}?.textContent.includes('合成备注')`);
    await click(query('[role=tab][aria-label="任务（0）"]'));
    await button('编辑关联');
    await select('.customer-link-form select', seed.task);
    await button('保存关联');
    await wait(`${query('[role=tab][aria-label="任务（1）"]')}`);
    await click(query('[role=tab][aria-label="文档（0）"]'));
    await button('编辑关联');
    await select('.customer-link-form select', seed.document);
    await button('保存关联');
    await wait(`${query('[role=tab][aria-label="文档（1）"]')}`);
    await click(query('[role=tab][aria-label^="往来记录（"]'));
    await click(query('[role=tab][aria-label="项目（1）"]'));
    await click(query('[role=tab][aria-label^="往来记录（"]'));
    await capture('customer-compact.png');
    await fill(
      query('.contacts-inspector .assistant-panel textarea'),
      '记录今天微信沟通：客户确认已收到材料清单。',
    );
    await wait(`${query('.contacts-inspector .agent-page-reference')}`);
    await click(query('.contacts-inspector .assistant-panel button[type=submit]'));
    await wait(
      `${query('.customer-record-card')} && !${query('.customer-record-card button')}.disabled`,
    );
    await capture('customer-ai-candidate.png');
    await button('保存为往来记录');
    await wait(`document.querySelectorAll('.customer-timeline article').length>=2`);
    await button('继续修改');
    await wait(`${query('[aria-label="已引用联系记录候选"]')}`);
    await capture('customer-explicit-reference.png');
    await fill(query('.contacts-inspector .assistant-panel textarea'), '日期改为今天');
    await click(query('.contacts-inspector .assistant-panel button[type=submit]'));
    await wait("document.querySelectorAll('.customer-record-card').length===2");
    await click("[...document.querySelectorAll('.customer-record-card button.primary')].at(-1)");
    await wait(`document.querySelectorAll('.customer-timeline article').length>=3`);
    await click(
      "[...document.querySelectorAll('.customer-record-card button')].filter(e=>e.textContent==='继续修改').at(-1)",
    );
    await click(query('[aria-label="移除候选引用"]'));
    await fill(query('.contacts-inspector .assistant-panel textarea'), '修改合同需要注意什么');
    await click(query('.contacts-inspector .assistant-panel button[type=submit]'));
    await wait(`document.body.textContent.includes('合成普通回答：请核对双方约定。')`);
    const runId = await evaluate(`(async()=>{
      const run_id=crypto.randomUUID();
      const result=await window.caselite.agent({protocol_version:1,operation:'start',scope:'home',run_id,prompt:'修改合同需要注意什么：合成跨页往来',confirmed:true});
      if(!result.ok)throw Error(result.message);return run_id;
    })()`);
    await wait(
      `(async()=>{const r=await window.caselite.agent({protocol_version:1,operation:'read',scope:'home'});return r.ok&&r.runs.some(run=>run.id===${literal(runId)}&&run.status==='succeeded')})()`,
    );
    await button('关联来源');
    await select('.customer-source-picker select[aria-label="来源所在位置"]', 'home');
    await wait(`document.querySelectorAll('.customer-source-option').length===1`);
    await click(query('.customer-source-option input'));
    await button('保存来源关联');
    await wait(`!${query('.customer-source-picker')}`);
    await wait(`document.querySelector('.customer-timeline').textContent.includes('合成跨页往来')`);
    await capture('contact-unified-activity.png');
    // 再次打开详情，验证来源与正式记录共存，且右下角 AI 不因开合详情丢失。
    await evaluate(
      `${query('.customer-name')}.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    await wait(query('.customer-detail-page'));
    await capture('contact-detail-unified.png');
    await button('← 返回联系人列表');
    await click(query('.contacts-inspector .inspector-ai-heading button[aria-expanded=true]'));
  } else {
    await wait(`${query('.customer-name')}?.textContent.includes('合成客户张某')`);
    await click(query('.customer-name'));
    await wait(`document.querySelectorAll('.customer-timeline article').length>=3`);
  }
  const result = await evaluate(`(async()=>{
    const list=await window.caselite.contacts({protocol_version:1,operation:'list'});
    if(!list.ok || list.contacts.length!==1)throw Error('Customer duplicates or read failure');
    const result=await window.caselite.contacts({protocol_version:1,operation:'read',contact_id:list.contacts[0].id});
    if(!result.ok || (${phase === 'customer-write'} && (result.detail.source_links.length!==1 || result.contacts[0].address!=='北京合成办公地址' || result.contacts[0].phone!=='010-00000001')) || result.detail.entries.length!==4 || result.detail.task_ids.length!==1 || result.detail.document_ids.length!==1 || result.contacts[0].project_ids.length!==1)throw Error('Customer workspace persistence mismatch');
    const split=document.querySelector('.contacts-inspector .inspector-split');
    const rect=split.querySelector('.inspector-ai-region').getBoundingClientRect();
    if(split.dataset.aiExpanded!=='false' || rect.height>166)throw Error('Customer composer not compact');
    return {contact:result.contacts[0],detail:result.detail,aiHeight:rect.height};
  })()`);
  await capture(phase + '-final.png');
  writeFileSync(
    join(root, phase + '.json'),
    JSON.stringify(
      {
        phase,
        status: 'PASS_REAL',
        generation: 'MOCK_ONLY',
        providerDispatches: 0,
        httpAttempts,
        ...result,
      },
      null,
      2,
    ),
  );
}
