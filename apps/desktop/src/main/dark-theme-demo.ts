import type { BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 仅由既有隔离外观验收调用；创建的是合成任务，测量真实样式，不注入覆盖CSS。
export async function checkDarkTheme(window: BrowserWindow, root: string) {
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const command = (method: string, params: Record<string, unknown>) =>
    window.webContents.debugger.sendCommand(method, params);
  const wait = async (code: string) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${code})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Dark theme wait failed: ' + code);
  };
  const capture = async (name: string) => {
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const pages: unknown[] = [];
  const audit = async (page: string) => {
    const result = await evaluate(`(()=>{
      const root=document.querySelector('.workspace-main');
      const bright=[];
      for(const el of root.querySelectorAll('*')){
        if(el.closest('.theme-swatch,.appearance-preview,.pdf-page,.react-pdf__Page,.error,.key-delete-confirm,.sample-badge,.document-comment-anchor,.annotation-composer,.annotation-list')) continue;
        const rect=el.getBoundingClientRect();
        if(!rect.width||!rect.height||getComputedStyle(el).visibility==='hidden') continue;
        const style=getComputedStyle(el);
        const bg=style.backgroundColor.match(/[\\d.]+/g)?.map(Number)??[];
        if(rect.width*rect.height>4000&&bg.length>=3&&(bg.length<4||bg[3]>=0.5)&&Math.min(...bg.slice(0,3))>160)
          bright.push({tag:el.tagName,class:el.className,background:style.backgroundColor});
        for(const side of ['Top','Right','Bottom','Left']){
          const width=parseFloat(style['border'+side+'Width']);
          if(!width||style['border'+side+'Style']==='none') continue;
          if((side==='Top'||side==='Bottom'?rect.width:rect.height)<90) continue;
          const c=style['border'+side+'Color']; const n=c.match(/[\\d.]+/g)?.map(Number)??[];
          if(n.length<3||(n.length===4&&n[3]<0.5)) continue;
          if(Math.min(...n.slice(0,3))>120) bright.push({tag:el.tagName,class:el.className,side,color:c,width});
        }
      }
      return {page:${JSON.stringify(page)},bright,theme:document.documentElement.dataset.theme};
    })()`);
    pages.push(result);
    writeFileSync(join(root, 'dark-theme-audit.json'), JSON.stringify({ pages }, null, 2));
    if (result.theme !== 'dark' || result.bright.length)
      throw new Error('Bright decorative borders remain: ' + JSON.stringify(result));
    await capture(`dark-${page}.png`);
  };
  const seeded = await evaluate(`(async()=>{
    const ids=[];
    for(const title of ['普通任务（合成资料）','重要日程（合成资料）']){
      const r=await window.caselite.task({protocol_version:1,operation:'create',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),title,objective:''});
      if(!r.ok) throw Error('Theme fixture create failed');
      const task=r.tasks.find(t=>t.title===title);ids.push(task.id);
      if(ids.length===2){
        const date=new Intl.DateTimeFormat('sv-SE').format(new Date());
        const s=await window.caselite.task({protocol_version:1,operation:'update_calendar',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),task_id:task.id,expected_version:task.version,
          calendar:{planned_date:null,schedule:null,important:true,type_id:'hearing',attention_source:'custom',attention_date:date,attention_time:null}});
        if(!s.ok) throw Error('Theme calendar fixture failed');
      }
    }
    window.dispatchEvent(new Event('caselite:material-task-saved'));return ids;
  })()`);
  await audit('home');
  await evaluate("document.querySelector('[data-nav=calendar]').click()");
  await wait(
    `document.querySelector('[data-calendar-task="${seeded[0]}"]') && document.querySelector('.resize-separator[aria-disabled=false]')`,
  );
  await evaluate("document.querySelector('.calendar-undated-tasks > summary')?.click()");
  await evaluate(`document.querySelector('[data-calendar-task="${seeded[0]}"]').click()`);
  await wait(
    "document.querySelector('.calendar-task-row[aria-pressed=true]') && document.querySelector('.calendar-selected-task')",
  );
  await wait(
    "getComputedStyle(document.querySelector('.calendar-task-row[aria-pressed=true]')).backgroundColor === 'rgb(50, 50, 63)'",
  );
  const calendar = await evaluate(`(()=>{
    const bars=[...document.querySelectorAll('.resize-separator')].map(el=>({hit:el.getBoundingClientRect().width,fill:getComputedStyle(el).backgroundColor,line:getComputedStyle(el,'::before').width,color:getComputedStyle(el,'::before').backgroundColor}));
    return {bars,row:getComputedStyle(document.querySelector('.calendar-task-row[aria-pressed=true]')).backgroundColor,date:getComputedStyle(document.querySelector('.calendar-date-grid button[aria-pressed=true]')).backgroundColor};
  })()`);
  if (
    calendar.bars.some(
      (bar: { hit: number; line: string; fill: string; color: string }) =>
        bar.hit !== 6 ||
        bar.line !== '1px' ||
        bar.fill !== 'rgba(0, 0, 0, 0)' ||
        bar.color !== 'rgb(58, 58, 66)',
    ) ||
    calendar.row !== 'rgb(50, 50, 63)' ||
    calendar.date !== 'rgb(50, 50, 63)'
  )
    throw new Error('Dark calendar geometry or selection mismatch: ' + JSON.stringify(calendar));
  await audit('calendar');
  const before = await evaluate(
    "Number(document.querySelector('.calendar-left-separator').getAttribute('aria-valuenow'))",
  );
  await evaluate("document.querySelector('.calendar-left-separator').focus()");
  await command('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
  });
  await command('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'ArrowRight',
    code: 'ArrowRight',
    windowsVirtualKeyCode: 39,
  });
  await wait(
    `Number(document.querySelector('.calendar-left-separator').getAttribute('aria-valuenow')) > ${before}`,
  );
  const focus = await evaluate(
    "({outline:getComputedStyle(document.querySelector('.calendar-left-separator')).outlineColor,visible:document.querySelector('.calendar-left-separator').matches(':focus-visible')})",
  );
  if (!focus.visible || focus.outline !== 'rgb(160, 168, 255)')
    throw new Error('Resize keyboard focus is not visible');
  await capture('dark-calendar-focus.png');
  await evaluate(
    "document.querySelector('.calendar-forecast-strip button[aria-pressed=true]').focus()",
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1180,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await capture('dark-calendar-narrow.png');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("document.querySelector('.calendar-selected-task button').click()");
  await wait("document.querySelector('[data-testid=task-result-tab]')");
  await evaluate("document.querySelector('[data-testid=task-result-tab]').click()");
  await wait("document.querySelector('.document .tiptap')");
  await audit('editor');
  for (const [page, selector] of [
    ['tasks', '.task-query-list'],
    ['projects', '[data-testid=project-catalog]'],
    ['documents', '.document-workspace'],
    ['knowledge', '.knowledge-view, [data-collection=knowledge]'],
    ['finance', '.finance-workspace'],
    ['contacts', '.contacts-workbench'],
    ['settings', '.settings-content'],
  ]) {
    await evaluate(`document.querySelector('[data-nav=${page}]').click()`);
    await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await audit(page);
  }
  await evaluate(
    "document.querySelector('.settings-back').click();document.querySelector('[data-nav=home]').click()",
  );
  await wait("document.querySelector('.agent-main')");
  writeFileSync(
    join(root, 'dark-theme-result.json'),
    JSON.stringify(
      {
        status: 'PASS_REAL',
        pages,
        calendar,
        focus,
        keyboardResize: true,
        network: 'HTTP(S) blocked, synthetic records, no Provider calls',
      },
      null,
      2,
    ),
  );
}
