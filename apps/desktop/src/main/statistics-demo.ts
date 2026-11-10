import { app, session, type BrowserWindow } from 'electron';
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

// 只由既有离线 project-demo 调用；所有业务样本走正式 Preload/Application，不能借探针接触用户资料。
export async function checkStatisticsCards(
  window: BrowserWindow,
  root: string,
  phase: 'write' | 'read',
) {
  const isolation = {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    storage: session.defaultSession.storagePath,
  };
  if (
    process.env.CASELITE_STATISTICS_CARDS !== '1' ||
    process.env.CASELITE_PROJECT_DASHBOARD !== '1' ||
    process.env.CASELITE_TASK_DEMO !== `project-${phase}` ||
    !process.env.CASELITE_TASK_DEMO_DIR ||
    realpathSync(process.env.CASELITE_TASK_DEMO_DIR) !== realpathSync(root) ||
    !basename(root).startsWith('caselite-task-demo-project-') ||
    Object.values(isolation).some(
      (path) => !path || !realpathSync(path).startsWith(realpathSync(root) + sep),
    )
  )
    throw new Error('Statistics probe requires the existing isolated project demo');
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Statistics probe timed out: ${predicate}`);
  };
  const click = (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const capture = async (name: string) => {
    await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    window.webContents.debugger.attach('1.3');
    try {
      const { data } = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      writeFileSync(join(root, name), Buffer.from(data, 'base64'));
    } finally {
      window.webContents.debugger.detach();
    }
  };
  const openSettings = async () => {
    await click('[data-nav=settings]');
    await wait("document.querySelector('.settings-nav-group[aria-label=个人]')");
    await evaluate(
      "[...document.querySelectorAll('.settings-nav-group[aria-label=个人] button')].find(b=>b.textContent.trim()==='偏好设置').click()",
    );
    await wait("document.querySelector('.statistics-settings:not(:disabled)')");
  };
  const save = async () => {
    await wait(
      "[...document.querySelectorAll('.personal-settings button')].some(b=>b.textContent.trim()==='保存个人设置'&&!b.disabled)",
    );
    await evaluate(
      "[...document.querySelectorAll('.personal-settings button')].find(b=>b.textContent.trim()==='保存个人设置').click()",
    );
    await wait(
      "document.querySelector('.statistics-settings:not(:disabled)') && [...document.querySelectorAll('.personal-settings button')].find(b=>b.textContent.trim()==='保存个人设置')?.disabled && document.querySelector('.personal-settings [role=status]')?.textContent.includes('已保存')",
    );
  };
  const configure = async (label: string, position: string, enabled: boolean) => {
    const changed = await evaluate(`(() => {
      const toggle=document.querySelector('[aria-label="启用${label}统计"]');
      if(toggle.checked===${enabled}) return false;
      toggle.click();return true;
    })()`);
    await wait(`document.querySelector('[aria-label="启用${label}统计"]').checked===${enabled}`);
    // 先等启用更新完成，第二个事件才能读取最新受控表单，不能用旧闭包覆盖开关。
    await evaluate('new Promise(done=>requestAnimationFrame(done))');
    const moved = await evaluate(`(() => {
      const select=document.querySelector('[aria-label="${label}统计位置"]');
      if(select.value===${JSON.stringify(position)}) return false;
      if(select.disabled) throw new Error('Cannot move a disabled statistics card');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(position)});
      select.dispatchEvent(new Event('change',{bubbles:true}));return true;
    })()`);
    return changed || moved;
  };
  const pages: Record<string, string> = {
    tasks: '.task-query-list',
    projects: '.project-catalog[data-project-view=list]',
    finance: '.finance-workspace',
  };
  const expected: Record<string, string[]> = {
    tasks: ['4', '4', '0', '0'],
    projects: ['23', '12', '3', '8'],
    finance: ['1,000.00', '700.00', '600.00', '400.00'],
  };
  const inspect = async (module: string, position: string) => {
    await click(`[data-nav=${module}]`);
    await wait(`document.querySelector(${JSON.stringify(pages[module])})`);
    await wait(
      `document.querySelector('[data-inspector-card="${module}-statistics"][data-card-position=${position}]') && JSON.stringify([...document.querySelectorAll('[data-statistics-module=${module}] [data-statistic-total], [data-statistics-module=${module}] .statistics-card-value')].map(e=>e.textContent))===${JSON.stringify(JSON.stringify(expected[module]))}`,
    );
    return evaluate(`(async () => {
      const card=document.querySelector('[data-statistics-module=${module}]');
      const scroll=card.closest('.inspector-properties-scroll');
      if(!scroll || document.querySelector('.collection-main [data-statistics-module]') || document.querySelector('[data-statistics-module=contacts]')) throw new Error('Statistics escaped inspector or contacts became active');
      const slot=card.closest('[data-inspector-card]'), stack=slot.parentElement;
      const properties=stack.querySelector('.inspector-card-properties');
      if(getComputedStyle(stack).display!=='flex' || getComputedStyle(stack).flexDirection!=='column' || Number(getComputedStyle(slot).order)!==${{ top: 0, middle: 20, bottom: 40 }[position as 'top' | 'middle' | 'bottom']}) throw new Error('Statistics position CSS is inactive');
      const before=slot.getBoundingClientRect(), prop=properties.getBoundingClientRect();
      if(${JSON.stringify(position)}==='top' ? before.bottom>prop.top+1 : before.top<prop.bottom-1) throw new Error('Statistics order differs from properties');
      // 窄窗工作区可横向滚动；先露出完整属性视口，再测卡片，不能只滚到数字边缘。
      scroll.scrollIntoView({block:'nearest',inline:'nearest'});
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const reachable=[];
      for(const value of card.querySelectorAll('[data-statistic-total],.statistics-card-value')) {
        value.scrollIntoView({block:'center'});
        await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
        const v=value.getBoundingClientRect(), s=scroll.getBoundingClientRect();
        const left=Math.max(v.left,s.left,0),right=Math.min(v.right,s.right,innerWidth),top=Math.max(v.top,s.top,0),bottom=Math.min(v.bottom,s.bottom,innerHeight);
        if(right<=left || bottom<=top || getComputedStyle(value).visibility!=='visible' || Number(getComputedStyle(value).opacity)===0) throw new Error('Statistics value is not reachable');
        const hit=document.elementFromPoint((left+right)/2,(top+bottom)/2);
        if(!hit || !(value===hit || value.contains(hit))) throw new Error('Statistics value is covered');
        reachable.push(value.textContent);
      }
      card.scrollIntoView({block:'nearest'});
      const r=card.getBoundingClientRect(), s=scroll.getBoundingClientRect();
      const ancestors=[...document.querySelectorAll('.finance-workspace,.workspace-main')].map(e=>({className:e.className,bounds:e.getBoundingClientRect().toJSON(),scrollLeft:e.scrollLeft,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflowX:getComputedStyle(e).overflowX}));
      if(r.width<=0 || r.height<=0 || scroll.clientHeight<=0 || s.left< -1 || s.right>innerWidth+1 || r.left<s.left-1 || r.right>s.right+1 || scroll.scrollWidth>scroll.clientWidth+1) throw new Error('Statistics overflow horizontally: '+JSON.stringify({module:${JSON.stringify(module)},position:${JSON.stringify(position)},card:r.toJSON(),scroll:s.toJSON(),viewport:{width:innerWidth,height:innerHeight},scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,ancestors}));
      if(scroll.scrollHeight>scroll.clientHeight+1 && !['auto','scroll'].includes(getComputedStyle(scroll).overflowY)) throw new Error('Statistics is clipped without scrolling');
      const ai=scroll.closest('.inspector-split').querySelector('.inspector-ai-region').getBoundingClientRect();
      if(s.bottom>ai.top+1) throw new Error('Statistics area overlaps AI');
      return {module:${JSON.stringify(module)},position:${JSON.stringify(position)},values:reachable,viewport:{width:innerWidth,height:innerHeight},card:r.toJSON(),scroll:s.toJSON(),ai:ai.toJSON(),scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,ancestors};
    })()`);
  };
  const measurements: unknown[] = [];
  const original = window.getBounds();
  let firstError: unknown;
  let cleanupError: unknown;
  let savedPreferences: unknown;
  try {
    await evaluate(`(async () => {
      const result=await window.caselite.task({protocol_version:1,operation:'list'});
      if(!result.ok || result.tasks.length!==4 || result.tasks.some(t=>!t.title.startsWith('合成重要事项 ') || (t.status && t.status!=='todo'))) throw new Error('Unexpected synthetic task baseline');
      const catalog=await window.caselite.catalog({protocol_version:1,operation:'list'});
      if(!catalog.ok || catalog.projects.length!==23 || catalog.projects.filter(p=>p.title.startsWith('合成项目 ')).length!==22) throw new Error('Unexpected synthetic project baseline');
    })()`);
    if (phase === 'write') {
      await evaluate(`(async () => {
        const catalog=await window.caselite.catalog({protocol_version:1,operation:'list'});
        const project=catalog.ok && catalog.projects.find(p=>p.title==='项目创建与重启验收');
        if(!project) throw new Error('Missing synthetic statistics project');
        const mutation=()=>({protocol_version:1,request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),project_id:project.id});
        const commit=async(request)=>{const r=await window.caselite.finance(request);if(!r.ok || r.receipt!==request.idempotency_key)throw new Error('Synthetic finance receipt failed');return r;};
        const ledger=await commit({...mutation(),operation:'register_contract',number:'SYNTH-STATISTICS',amount_cents:100000,installments:[{amount_cents:100000,due_date:'2026-12-31'}]});
        const installment=ledger.ledger.installments[0].id;
        await commit({...mutation(),operation:'record_payment',installment_id:installment,amount_cents:60000});
        const invoiced=await commit({...mutation(),operation:'m_record_invoice',installment_id:installment,invoice_number:'SYNTH-INVOICE',amount_cents:80000,occurred_on:'2026-11-10',note:''});
        const invoice=invoiced.state.invoices.find(i=>i.project_id===project.id && i.kind==='invoice');
        await commit({...mutation(),operation:'m_red_invoice',installment_id:installment,invoice_number:'SYNTH-RED',amount_cents:10000,occurred_on:'2026-11-10',note:'',original_invoice_id:invoice.id});
      })()`);
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          window.webContents.removeListener('did-fail-load', fail);
          resolve();
        };
        const fail = () => {
          clearTimeout(timer);
          window.webContents.removeListener('did-finish-load', finish);
          reject(new Error('Statistics reload failed'));
        };
        const timer = setTimeout(() => {
          window.webContents.removeListener('did-finish-load', finish);
          window.webContents.removeListener('did-fail-load', fail);
          reject(new Error('Statistics reload timed out'));
        }, 10000);
        window.webContents.once('did-finish-load', finish);
        window.webContents.once('did-fail-load', fail);
        window.webContents.reload();
      });
      await wait("document.querySelector('[data-nav=settings]')");
      for (const [module, label] of [
        ['tasks', '任务'],
        ['projects', '项目'],
        ['finance', '财务'],
      ]) {
        for (const position of ['top', 'middle', 'bottom']) {
          await openSettings();
          if (await configure(label, position, true)) await save();
          measurements.push(await inspect(module, position));
          await capture(`statistics-${module}-${position}.png`);
        }
        await openSettings();
        await configure(label, 'bottom', false);
        await save();
        await click(`[data-nav=${module}]`);
        await wait(`document.querySelector(${JSON.stringify(pages[module])})`);
        await wait(`!document.querySelector('[data-statistics-module=${module}]')`);
        if (
          !(await evaluate(
            `(async()=>{const r=await window.caselite.preferences({protocol_version:1,operation:'read'});return r.ok && r.preferences.statistics_cards?.${module}.enabled===false;})()`,
          ))
        )
          throw new Error('Disabled statistics preference was not saved');
      }
      await openSettings();
      await configure('任务', 'bottom', true);
      await configure('项目', 'middle', true);
      await configure('财务', 'bottom', true);
      await save();
      if (
        !(await evaluate(
          "document.querySelector('[aria-label=启用联系人统计]').disabled && !document.querySelector('[aria-label=启用联系人统计]').checked",
        ))
      )
        throw new Error('Contacts capability is not disabled');
      await capture('statistics-settings-final.png');
    }
    const preferences = await evaluate(
      "window.caselite.preferences({protocol_version:1,operation:'read'})",
    );
    savedPreferences = preferences.preferences?.statistics_cards;
    if (
      !preferences.ok ||
      preferences.preferences.statistics_cards?.tasks.position !== 'bottom' ||
      preferences.preferences.statistics_cards?.projects.position !== 'middle' ||
      preferences.preferences.statistics_cards?.finance.position !== 'bottom' ||
      !['tasks', 'projects', 'finance'].every(
        (module) => preferences.preferences.statistics_cards?.[module].enabled === true,
      )
    )
      throw new Error('Statistics preference readback mismatch');
    for (const [module, position] of [
      ['tasks', 'bottom'],
      ['projects', 'middle'],
      ['finance', 'bottom'],
    ]) {
      const result = await inspect(module, position);
      measurements.push(result);
    }
    for (const [width, height] of [
      [1440, 800],
      [1100, 600],
      [640, 500],
    ]) {
      window.setContentSize(width, height);
      await wait(`innerWidth===${width} && innerHeight===${height}`);
      measurements.push({
        requested: { width, height },
        result: await inspect('finance', 'bottom'),
      });
      await capture(`statistics-${phase}-${width}x${height}.png`);
    }
  } catch (error) {
    firstError = error;
    try {
      await capture(`statistics-${phase}-failed.png`);
    } catch {
      /* 原错误优先保留。 */
    }
  } finally {
    try {
      window.setBounds(original);
      await click('[data-nav=projects]');
      await wait("document.querySelector('[aria-label=搜索项目]')");
      await evaluate(
        "(() => {const e=document.querySelector('[aria-label=搜索项目]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'项目创建与重启验收');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
      );
    } catch (error) {
      cleanupError = error;
    }
  }
  // 必要收尾完成后才写通过，清理失败也不能覆盖首个断言错误。
  writeFileSync(
    join(root, `statistics-${phase}.json`),
    JSON.stringify(
      {
        status: firstError || cleanupError ? 'FAIL' : 'PASS_REAL',
        isolation,
        phase,
        measurements,
        preferences: savedPreferences,
        error:
          firstError instanceof Error ? firstError.message : firstError ? String(firstError) : null,
        cleanupError:
          cleanupError instanceof Error
            ? cleanupError.message
            : cleanupError
              ? String(cleanupError)
              : null,
        unverified: [
          'Physical Chinese IME',
          'Screen reader reading order',
          'Real Provider',
          'Lawyer acceptance',
          'Native multi-card combination and in-place position change while editing properties',
          'Real attachment and active Agent run identity preservation',
          'Statistics reachability while AI occupies 85% (compact AI measured here)',
        ],
      },
      null,
      2,
    ),
  );
  if (firstError || cleanupError) throw firstError ?? cleanupError;
}
