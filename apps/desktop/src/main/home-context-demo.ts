import { app, session, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// 沿既有临时目录门禁进入；仅合成 Provider 和内存凭据，不读取正式工作区。
export async function runHomeContextDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  for (const path of [app.getPath('userData'), app.getPath('sessionData')])
    if (!path.startsWith(root + sep)) throw new Error('Home context isolation failed');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow();
  window.webContents.setBackgroundThrottling(false);
  window.webContents.debugger.attach('1.3');
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const capture = async (name: string) => {
    const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
    });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const wait = async (code: string) => {
    const observations: unknown[] = [];
    for (let i = 0; i < 150; i++) {
      const observation = await evaluate(
        `({matched:Boolean(${code}), detail:document.querySelector('.home-agent-detail')?.outerHTML, card:document.querySelector('.home-agents')?.textContent})`,
      );
      if (observation.matched) return;
      observations.push(observation);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    writeFileSync(
      join(root, 'home-context-observations.json'),
      JSON.stringify(observations, null, 2),
    );
    await capture('home-context-failure.png');
    writeFileSync(
      join(root, 'home-context-failure.txt'),
      await evaluate('document.body.innerText'),
    );
    throw new Error('Home context assertion failed: ' + code);
  };
  const viewport = async (width: number) => {
    window.setContentSize(width, 960);
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  try {
    await viewport(1440);
    await wait(
      "document.querySelector('.home-agents')?.textContent.includes('暂无运行中的智能体')",
    );
    const headings = await evaluate(
      "[...document.querySelectorAll('.home-v3-directory > h2, .home-v3-running h3')].map(e=>e.textContent.trim())",
    );
    if (headings.length !== 2 || headings[0] !== 'Agent' || !headings[1].includes('进行中的智能体'))
      throw new Error('Home directory or running panel is missing');
    if (
      await evaluate(
        "Boolean(document.querySelector('.home-conversation-toolbar, .home-topbar, .workspace-navigation-toggle'))",
      )
    )
      throw new Error('Legacy home toolbar remains');
    if (await evaluate("Boolean(document.querySelector('[data-nav=tasks] small'))"))
      throw new Error('Task navigation count remains');
    // 直接验证可见入口与命中；保留原导航、草稿和运行组件，不用隐藏测试节点代替。
    for (const width of [1440, 1180, 520]) {
      await viewport(width);
      await wait(
        "document.querySelector('.home-v3')?.dataset.compact === '" + String(width <= 850) + "'",
      );
      const entrance = await evaluate(`(()=>{
        const visible=e=>Boolean(e && e.getClientRects().length && !e.closest('[hidden],[inert]'));
        const rail=document.querySelector('.primary-sidebar');
        const nav=[...document.querySelectorAll('.primary-navigation button')];
        const controls=[...document.querySelectorAll('.workspace-titlebar .home-directory-toggle')];
        if(!visible(rail) || Math.abs(rail.getBoundingClientRect().width-64)>1 || nav.length!==7 || controls.length!==1) return false;
        if(controls[0].getAttribute('aria-expanded')!=='true') controls[0].click();
        return nav.every(b=>{
          const r=b.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return visible(b) && b.querySelector('span')?.textContent.trim() && b.contains(hit);
        });
      })()`);
      if (!entrance)
        throw new Error('Home navigation entrance is not visible or clickable at ' + width);
      await wait(
        "document.querySelector('.home-directory-toggle')?.getAttribute('aria-expanded')==='true' && document.querySelector('.home-v3-directory')?.getClientRects().length",
      );
      const originalRunVisibility = await evaluate(
        "document.querySelector('.home-topbar-actions button[aria-controls=home-active-runs]').getAttribute('aria-expanded')",
      );
      await evaluate(
        "document.querySelector('.home-topbar-actions button[aria-controls=home-active-runs]').click()",
      );
      await wait(
        "document.querySelector('.home-topbar-actions button[aria-controls=home-active-runs]')?.getAttribute('aria-expanded')==='" +
          (originalRunVisibility === 'true' ? 'false' : 'true') +
          "'",
      );
      await evaluate(
        "document.querySelector('.home-topbar-actions button[aria-controls=home-active-runs]').click()",
      );
      await wait(
        "document.querySelector('.home-topbar-actions button[aria-controls=home-active-runs]')?.getAttribute('aria-expanded')==='" +
          originalRunVisibility +
          "'",
      );
      await evaluate("document.querySelector('.home-v3-rail button[title=本轮材料]').click()");
      await wait("document.querySelector('.home-v3-auxiliary')?.getClientRects().length");
      const geometry = await evaluate(`(()=>{
        const dir=document.querySelector('.home-v3-directory').getBoundingClientRect();
        const aux=document.querySelector('.home-v3-auxiliary').getBoundingClientRect();
        const compact=document.querySelector('.home-v3').dataset.compact==='true';
        if(dir.left<63 || !document.querySelector('.home-live-panel').contains(document.querySelector('[data-testid=agent-input]')))return false;
        const x=Math.max(dir.left,aux.left)+8,y=Math.max(dir.top,aux.top)+120;
        return !compact || x>=Math.min(dir.right,aux.right) || document.querySelector('.home-v3-directory').contains(document.elementFromPoint(x,y));
      })()`);
      if (!geometry)
        throw new Error('Home overlay covers navigation or has wrong stacking at ' + width);
      await capture('home-v3-entrances-' + width + '.png');
      await evaluate(
        "document.querySelector('.home-topbar-actions button[aria-label=收起辅助面板]').click()",
      );
      await evaluate("document.querySelector('.home-directory-toggle').click()");
      await wait(
        "document.querySelector('.home-v3-directory')?.hidden && !document.querySelector('.primary-sidebar').hasAttribute('inert')",
      );
      await evaluate("document.querySelector('.home-directory-toggle').click()");
    }
    await viewport(1440);
    if (phase === 'agent-home-check') {
      await wait("document.querySelector('[data-nav=calendar] small')?.textContent === '0'");
      await capture('home-calendar-count-empty.png');
      const seeded = await evaluate(`(async()=>{
        for(let i=1;i<=6;i++){
          const title='合成重要日期'+i;
          const created=await window.caselite.task({protocol_version:1,operation:'create',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),title,objective:''});
          if(!created.ok) return false;
          const task=created.tasks.find(t=>t.title===title);
          if(!task) return false;
          const saved=await window.caselite.task({protocol_version:1,operation:'update_calendar',request_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID(),task_id:task.id,expected_version:task.version,
            calendar:{planned_date:null,schedule:null,important:true,type_id:'hearing',attention_source:'custom',attention_date:'2026-11-10',attention_time:null}});
          if(!saved.ok) return false;
        }
        window.dispatchEvent(new Event('caselite:material-task-saved'));
        return true;
      })()`);
      if (!seeded) throw new Error('Important date fixtures could not be saved');
    }
    await wait("document.querySelector('[data-nav=calendar] small')?.textContent === '6'");
    await evaluate("document.querySelector('.home-v3-rail button[title=重要日程]').click()");
    await wait(
      "document.querySelector('.home-v3-auxiliary .important-schedules h3 button')?.getClientRects().length",
    );
    await evaluate(
      "document.querySelector('.home-v3-auxiliary .important-schedules h3 button').click()",
    );
    await wait(
      "document.querySelector('[data-nav=calendar][aria-current=page]') && document.querySelector('.calendar-workbench')",
    );
    await capture('home-calendar-navigation.png');
    await evaluate("document.querySelector('[data-nav=home]').click()");
    await wait(
      "document.querySelector('.home-agents')?.textContent.includes('暂无运行中的智能体')",
    );
    if (phase === 'agent-home-read') {
      await wait(
        "[...document.querySelectorAll('.home-history-open')].some(e=>e.getClientRects().length && e.textContent.includes('首页智能体验收'))",
      );
      await evaluate(
        "[...document.querySelectorAll('.home-history-open')].find(e=>e.textContent.includes('首页智能体验收')).click()",
      );
      await wait(
        "document.querySelector('.home-history-detail .home-readonly-run')?.getClientRects().length",
      );
      if (
        await evaluate(
          "Boolean(document.querySelector('.home-history-detail form, .home-history-detail [data-testid=agent-input]'))",
        )
      )
        throw new Error('Reopened history unexpectedly has a sending composer');
      await capture('home-context-reopened.png');
    } else {
      for (const theme of ['light', 'dark']) {
        await evaluate("document.querySelector('[data-nav=settings]').click()");
        await wait(
          "document.querySelector('.settings-nav-group[aria-label=个人] button:first-of-type')",
        );
        await evaluate(
          "[...document.querySelectorAll('.settings-nav-group[aria-label=个人] button')].find(b=>b.textContent.trim()==='偏好设置').click()",
        );
        await wait("document.querySelector('.theme-option:not(:disabled)')");
        await evaluate(
          `document.querySelector('.theme-option:nth-child(${theme === 'light' ? 1 : 2})').click()`,
        );
        await wait(`document.documentElement.dataset.theme==='${theme}'`);
        await evaluate("document.querySelector('.settings-back').click()");
        await wait(`document.documentElement.dataset.theme==='${theme}'`);
        await capture(`home-context-${theme}.png`);
      }
      await viewport(1180);
      await capture('home-context-narrow.png');
      await viewport(1440);
      for (const stop of [false, true]) {
        const id = randomUUID();
        const result = await evaluate(
          `window.caselite.agent({protocol_version:1,operation:'start',scope:'home',run_id:'${id}',prompt:'首页智能体验收 · 合成合同审查',confirmed:true})`,
        );
        if (!result.ok) throw new Error('Synthetic Run start failed');
        await wait(
          "document.querySelector('.home-agent-row') && document.querySelector('.home-agent-progress')?.textContent",
        );
        await evaluate("document.querySelector('.home-agent-row').click()");
        await wait(
          "document.querySelector('.home-agent-detail')?.textContent.includes('gpt-4.1-mini')",
        );
        if (!stop) {
          await wait(
            "document.querySelector('.home-agent-detail p:last-of-type')?.textContent && document.querySelector('.home-agent-detail p:last-of-type').textContent !== '等待模型响应…'",
          );
          const proof = await evaluate(`(async()=>{
            const text=document.querySelector('.home-agent-detail p:last-of-type').textContent;
            const state=await window.caselite.agent({protocol_version:1,operation:'active_runs'});
            return {matches:Boolean(state.ok && state.runs.some(run=>run.id==='${id}' && run.status==='running' && run.output.includes(text))), text};
          })()`);
          if (!proof.matches) throw new Error('Rendered progress does not match active Run');
          writeFileSync(join(root, 'home-agent-live-proof.json'), JSON.stringify(proof, null, 2));
          await capture('home-agent-running.png');
          await evaluate("document.querySelector('[data-nav=calendar]').click()");
          await evaluate("document.querySelector('[data-nav=home]').click()");
          await wait("document.querySelector('.home-agent-row')");
        } else {
          await evaluate(
            `window.caselite.agent({protocol_version:1,operation:'cancel',scope:'home',run_id:'${id}'})`,
          );
        }
        await wait(
          "document.querySelector('.home-agents')?.textContent.includes('暂无运行中的智能体')",
        );
        const ended = await evaluate(
          "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
        );
        if (
          !ended.ok ||
          ended.runs.find((run: { id: string }) => run.id === id)?.status !==
            (stop ? 'cancelled' : 'succeeded')
        )
          throw new Error('Terminal Run state mismatch');
      }
      await capture('home-agent-ended.png');
    }
    writeFileSync(
      join(root, `${phase}.json`),
      JSON.stringify(
        {
          status: 'MOCK_ONLY',
          desktop: 'PASS_REAL',
          phase,
          headings,
          userData: app.getPath('userData'),
          network: 'HTTP(S) blocked; synthetic Provider; memory credentials',
        },
        null,
        2,
      ),
    );
  } finally {
    if (!window.isDestroyed()) {
      window.webContents.debugger.detach();
      window.destroy();
    }
  }
}
