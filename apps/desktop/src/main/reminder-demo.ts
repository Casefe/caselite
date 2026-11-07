import { app, Notification, session, type BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { openToolchainProbe } from '@caselite/local-db';
import type { Reminder, ReminderResponse } from '@caselite/contracts';

// 合成验收复用正式界面/IPC/SQLite/OS通知，不替换提醒Port或Notification，不读取正式资料。
export async function runReminderDemo(
  create: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  const isolation = {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    storage: session.defaultSession.storagePath,
  };
  if (Object.values(isolation).some((p) => !p?.startsWith(root + sep)))
    throw new Error('Reminder isolation failed');
  session.defaultSession.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await create();
  window.webContents.setBackgroundThrottling(false);
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Reminder probe timed out: ' + predicate);
  };
  const click = async (label: string) => {
    const find = `[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.querySelector('strong')?.textContent===${JSON.stringify(label)})&&!b.disabled)`;
    await wait(find);
    await evaluate(`${find}.click()`);
  };
  const input = async (label: string, value: string) =>
    evaluate(
      `(()=>{const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  const list = async (): Promise<Reminder[]> => {
    const r: ReminderResponse = await evaluate(
      "window.caselite.reminder({protocol_version:1,operation:'list'})",
    );
    if (!r.ok) throw new Error('Reminder read failed');
    return r.reminders;
  };
  const capture = async (name: string) =>
    writeFileSync(join(root, name), (await window.webContents.capturePage()).toPNG());
  const zeroDispatch = () => {
    if (existsSync(join(root, 'unexpected-runtime.txt')))
      throw new Error('Unexpected provider dispatch marker');
    const db = openToolchainProbe(
      join(isolation.userData, 'caselite.sqlite'),
      join(process.resourcesPath, 'migrations'),
    ).sqlite;
    const runs = (db.prepare('SELECT count(*) AS n FROM agent_runs').get() as { n: number }).n;
    db.close();
    if (runs !== 0) throw new Error('Reminder verification created Agent runs');
    return { agentRuns: runs, unexpectedRuntimeMarker: false, realProviderDispatches: 0 };
  };
  let stage = 'initial';
  try {
    await wait("document.querySelector('[data-nav=reminders]')");
    if (phase === 'reminder-read') {
      const expected = JSON.parse(readFileSync(join(root, 'reminder-expected.json'), 'utf8'));
      await evaluate("document.querySelector('[data-nav=reminders]').click()");
      await wait("document.querySelector('.reminder-row')");
      const r = (await list())[0];
      if (
        r.id !== expected.reminder.id ||
        r.plan_revision !== 4 ||
        r.instant !== expected.reminder.instant ||
        !r.attempt ||
        r.read_at
      )
        throw new Error('Restart catchup mismatch');
      await click('合成提醒验收');
      await wait("document.querySelector('[data-testid=saved-reminder]')");
      await capture('reminder-reopened.png');
      await click('标为已读');
      await wait("document.body.innerText.includes('没有未读提醒')");
      await click('已读');
      await click('合成提醒验收');
      await click('标为未读');
      await wait("document.body.innerText.includes('没有已读提醒')");
      await click('未读');
      await click('合成提醒验收');
      await click('返回原任务');
      await wait("document.querySelector('[data-active-task]')");
      if (
        (await evaluate("document.querySelector('[data-active-task]').dataset.activeTask")) !==
        expected.taskId
      )
        throw new Error('Wrong Task returned');
      await new Promise((done) => setTimeout(done, 5500));
      const db = openToolchainProbe(
        join(isolation.userData, 'caselite.sqlite'),
        join(process.resourcesPath, 'migrations'),
      ).sqlite;
      const attempts = db.prepare('SELECT * FROM reminder_attempts ORDER BY plan_revision').all();
      const receipts = db.prepare('SELECT count(*) AS n FROM reminder_receipts').get();
      db.close();
      if (attempts.length !== 2) throw new Error('Restart duplicated or canceled plan attempted');
      await capture('reminder-return-task.png');
      writeFileSync(
        join(root, 'reminder-result.json'),
        JSON.stringify(
          {
            status: 'PASS_REAL',
            isolation,
            taskId: expected.taskId,
            reminder: (await list())[0],
            attempts,
            receipts,
            zeroDispatch: zeroDispatch(),
            displayTimezone: await evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone'),
            realProviderDispatches: 0,
            notRun: [
              'physical suspend/resume',
              'system permission denial',
              'notification center retained history cleanup',
              'human experience acceptance',
            ],
          },
          null,
          2,
        ),
      );
      return;
    }
    stage = 'create-task';
    await evaluate("document.querySelector('[data-nav=tasks]').click()");
    await wait("document.querySelector('[data-testid=new-task]')");
    await evaluate("document.querySelector('[data-testid=new-task]').click()");
    await wait("document.querySelector('[data-testid=task-title]')");
    await evaluate(
      "(()=>{const e=document.querySelector('[data-testid=task-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'合成提醒验收');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await evaluate("document.querySelector('[data-testid=create-task]').click()");
    await wait("document.querySelector('[data-active-task]')");
    const taskId = await evaluate(
      "document.querySelector('[data-active-task]').dataset.activeTask",
    );
    await click('本机提醒');
    const schedule = async (instant: string) => {
      await click((await list()).length ? '改期 / 重新设定' : '设置提醒');
      await input('提醒日期', instant.slice(0, 10));
      await input('提醒时刻', instant.slice(11, 16));
      await input('提醒时区', 'UTC');
      // 提醒草稿同样阻止导航和正文覆盖，必须明确确认后保存。
      await evaluate("document.querySelector('[data-nav=reminders]').click()");
      if (!(await evaluate("Boolean(document.querySelector('[data-active-task]'))")))
        throw new Error('Reminder dirty navigation escaped');
      await click('验证日期与时区');
      await wait("document.querySelector('.reminder-confirm input')");
      await evaluate("document.querySelector('.reminder-confirm input').click()");
      await click('确认保存提醒');
      await wait(
        "!document.querySelector('[aria-label=提醒日期]') && document.querySelector('[data-testid=saved-reminder]')",
      );
    };
    if (phase === 'reminder-preview') {
      await schedule(new Date(Math.ceil((Date.now() + 900000) / 60000) * 60000).toISOString());
      await evaluate("document.querySelector('[data-nav=reminders]').click()");
      await click('当前计划');
      await click('合成提醒验收');
      zeroDispatch();
      return;
    }
    stage = 'normal-notification';
    const normalAt = new Date(Math.ceil((Date.now() + 3000) / 60000) * 60000).toISOString();
    await schedule(normalAt);
    for (let i = 0; i < 280; i++) {
      const candidate = (await list())[0];
      if (candidate.attempt && candidate.attempt !== 'unknown') break;
      await new Promise((done) => setTimeout(done, 250));
    }
    const normal = (await list())[0];
    if (
      !normal.attempt ||
      normal.read_at ||
      !normal.attempted_at ||
      normal.updated_at >= normal.instant ||
      normal.attempted_at < normal.instant ||
      Date.parse(normal.attempted_at) - Date.parse(normal.instant) > 10000
    )
      throw new Error('No real OS attempt or implicit read');
    await capture('reminder-normal.png');
    stage = 'reschedule-cancel';
    const future = new Date(Math.ceil((Date.now() + 3600000) / 60000) * 60000).toISOString();
    await schedule(future);
    const changed = (await list())[0];
    if (changed.plan_revision !== 2 || changed.attempt)
      throw new Error('Reschedule did not invalidate old attempt');
    await click('取消提醒');
    await wait(
      "document.querySelector('[data-testid=saved-reminder]')?.textContent.includes('已取消')",
    );
    if ((await list())[0].plan_revision !== 3) throw new Error('Cancel mismatch');
    await capture('reminder-canceled.png');
    const restartAt = new Date(Math.ceil((Date.now() + 15000) / 60000) * 60000).toISOString();
    stage = 'restart-plan';
    await schedule(restartAt);
    const final = (await list())[0];
    if (final.plan_revision !== 4 || final.attempt) throw new Error('Restart future plan mismatch');
    const task = await evaluate(
      `window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(taskId)}})`,
    );
    if (!task.ok || task.tasks[0].due_date !== null || task.tasks[0].version !== 1)
      throw new Error('Reminder changed Task attributes');
    const prefix =
      'caselite-reminder:' +
      createHash('sha256').update(isolation.userData).digest('hex').slice(0, 24) +
      ':';
    let ownHistory: number | null = null;
    try {
      ownHistory = (await Notification.getHistory()).filter((n) => n.id.startsWith(prefix)).length;
    } catch {
      /* OS能力未知单列，不冒称真实历史清理通过。 */
    }
    writeFileSync(
      join(root, 'reminder-expected.json'),
      JSON.stringify(
        {
          isolation,
          taskId,
          reminder: final,
          normal,
          ownHistory,
          restartAt,
          zeroDispatch: zeroDispatch(),
          realProviderDispatches: 0,
          displayTimezone: await evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone'),
        },
        null,
        2,
      ),
    );
    await evaluate("document.querySelector('[data-nav=reminders]').click()");
    await click('当前计划');
    await click('合成提醒验收');
    await capture('reminder-plan.png');
    await click('改期 / 重新设定');
    const layouts = [];
    window.webContents.debugger.attach('1.3');
    try {
      for (const width of [640, 1440])
        for (const theme of ['light', 'dark']) {
          await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
          await new Promise((done) => setTimeout(done, 150));
          const geometry = await evaluate(
            `(()=>{const e=document.querySelector('.reminder-inbox'),s=getComputedStyle(e);return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,foreground:s.color,background:s.backgroundColor,inputs:[...document.querySelectorAll('.reminder-editor input:not([type=checkbox])')].map(i=>({left:i.getBoundingClientRect().left,right:i.getBoundingClientRect().right}))};})()`,
          );
          if (
            geometry.scrollWidth > width + 1 ||
            geometry.foreground === geometry.background ||
            geometry.inputs.some(
              (i: { left: number; right: number }) => i.left < 0 || i.right > width + 1,
            )
          )
            throw new Error('Reminder layout overflow/contrast');
          layouts.push({ theme, ...geometry });
          const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height: 900, scale: 1 },
          });
          writeFileSync(
            join(root, `reminder-${theme}-${width}.png`),
            Buffer.from(shot.data, 'base64'),
          );
        }
    } finally {
      window.webContents.debugger.detach();
    }
    writeFileSync(join(root, 'reminder-layout.json'), JSON.stringify(layouts, null, 2));
    await click('取消编辑');

    if (phase === 'reminder-preview') return;
  } catch (e) {
    writeFileSync(
      join(root, 'reminder-failure.json'),
      JSON.stringify({ stage, error: String(e) }, null, 2),
    );
    await capture('reminder-failure.png');
    throw e;
  }
}
