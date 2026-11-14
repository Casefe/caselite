import { app, session, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { createMaterialApplication } from '@caselite/application';
import type { TaskResponse } from '@caselite/contracts';
import { runCreationDemo } from './creation-demo';

// 只从宿主已验证的合成目录进入；不访问普通工作区、系统凭据或真实 Provider。
export async function runTaskViewsDemo(
  create: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  materials: ReturnType<typeof createMaterialApplication>,
) {
  if (phase.startsWith('task-views-creation-')) return runCreationDemo(create, root, phase);
  for (const path of [app.getPath('userData'), app.getPath('sessionData')])
    if (!path.startsWith(root + sep)) throw Error('Task views isolation failed');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await create();
  window.webContents.setBackgroundThrottling(false);
  window.webContents.debugger.attach('1.3');
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  let stage = 'startup';
  const capture = async (name: string) => {
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
    });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const wait = async (code: string) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${code})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    writeFileSync(join(root, 'task-views-failure.txt'), await evaluate('document.body.innerText'));
    await capture('task-views-failure.png');
    throw Error('Task views assertion failed: ' + code);
  };
  const click = (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = (name: string) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`,
    );
  const input = (selector: string, value: string) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(e.isContentEditable){e.focus();const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,${JSON.stringify(value)});}else{const setter=Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));}})()`,
    );
  const identity = () => ({
    protocol_version: 1,
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
  });
  const task = async (request: object) => {
    const r: TaskResponse = await evaluate(`window.caselite.task(${JSON.stringify(request)})`);
    if (!r.ok) throw Error(r.message);
    return r;
  };
  const viewport = async (width: number) => {
    window.setContentSize(width, 1080);
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 300));
  };
  try {
    await viewport(1920);
    await wait("document.querySelector('[data-nav=tasks]')");
    if (phase === 'task-views-read' || phase === 'task-views-preview') {
      const expected = JSON.parse(readFileSync(join(root, 'task-views-expected.json'), 'utf8'));
      const saved = (await task({ protocol_version: 1, operation: 'read', task_id: expected.id }))
        .tasks[0]!;
      if (phase === 'task-views-preview') {
        await click('[data-nav=tasks]');
        await wait(`document.querySelector('[data-row-task="${saved.id}"]')`);
        await click(`[data-row-task="${saved.id}"]`);
        await wait("document.querySelector('[aria-label=任务标题]')");
        window.show();
        return;
      }
      if (
        saved.title !== expected.title ||
        saved.start_date !== expected.start ||
        saved.due_date !== expected.due ||
        saved.objective !== expected.objective
      )
        throw Error('Task view restart data mismatch');
      const reminders = await evaluate(
        `window.caselite.reminder({protocol_version:1,operation:'list',task_id:${JSON.stringify(saved.id)}})`,
      );
      if (
        !reminders.ok ||
        reminders.reminders[0]?.date !== expected.reminderDate ||
        reminders.reminders[0]?.time !== '09:30' ||
        reminders.reminders[0]?.instant !== expected.reminderInstant ||
        reminders.reminders[0]?.timezone !== expected.reminderTimezone
      )
        throw Error('Reminder restart mismatch');
      if ((await task({ protocol_version: 1, operation: 'list' })).tasks.length !== expected.count)
        throw Error('Task was duplicated across restart');
      const discussion = await evaluate(
        `window.caselite.catalog({protocol_version:1,operation:'list_discussion',scope:{kind:'task_comment',task_id:${JSON.stringify(saved.id)}}})`,
      );
      if (!discussion.ok || !discussion.discussion?.entries.length)
        throw Error('Comment did not survive restart');
      await click('[data-nav=tasks]');
      await wait(`document.querySelector('[data-row-task="${saved.id}"]')`);
      await click(`[data-row-task="${saved.id}"]`);
      await wait("document.querySelector('[aria-label=任务标题]')");
      writeFileSync(
        join(root, 'task-views-read.json'),
        JSON.stringify(
          {
            status: 'PASS_REAL',
            task: saved.id,
            reminder: true,
            comment: true,
            initialTaskCount: expected.count,
            providerCalls: 0,
            physicalIme: 'NOT_RUN',
          },
          null,
          2,
        ),
      );
      return;
    }
    stage = 'seed';
    const names = [
      '准备答辩意见',
      '与客户确认材料清单',
      '提交证据目录',
      '审核补充材料',
      '起草和解方案',
      '整理庭前会议纪要',
      '准备庭审提纲',
    ];
    const now = new Date();
    const date = (offset: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    for (let i = 0; i < names.length; i++)
      await task({
        ...identity(),
        operation: 'create',
        title: `示例 · ${names[i]}`,
        objective: '合成界面验收任务，不含真实案件资料。',
        priority: (i % 4) + 1,
        status: i === 5 ? 'done' : i % 2 ? 'in_progress' : 'todo',
        due_date: date(i - 2),
      });
    await evaluate(
      "window.caselite.appearance({protocol_version:1,operation:'set',theme:'light'})",
    );
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve());
      window.webContents.reload();
    });
    await wait("document.querySelector('[data-nav=tasks]')");
    await click('[data-nav=tasks]');
    await wait("document.querySelectorAll('[data-row-task]').length===7");
    await wait(
      "(()=>{const list=document.querySelector('.compact-task-list');const e=list?.querySelector('.table-head');const r=e?.getBoundingClientRect();return list?.getAttribute('data-layout')==='list'&&r&&r.width<=1&&r.height<=1&&!list.querySelector('[data-statistics-module]')&&document.querySelector('#task-list-filters').hidden&&getComputedStyle(document.querySelector('#task-list-filters')).display==='none';})()",
    );
    await capture('01-task-summary.png');
    await click('[data-nav=settings]');
    await wait("document.querySelector('.theme-options')");
    await evaluate(
      "[...document.querySelectorAll('.theme-options button')].find(e=>e.textContent.includes('深色')).click()",
    );
    await wait("document.documentElement.dataset.theme==='dark'");
    await click('[data-nav=tasks]');
    await wait("document.querySelector('[data-testid=new-task]')");
    stage = 'create-dialog';
    await click('[data-testid=new-task]');
    await wait("document.querySelector('.task-create-dialog[open]')");
    await capture('02-task-create.png');
    await input('[data-testid=task-title]', '示例 · 三页真实验收');
    await input(
      '[data-testid=task-objective]',
      '整理合同履行时间与材料缺口，形成供人工审阅的初稿。',
    );
    await input('[aria-label=任务负责人]', '');
    await click('[aria-label=设置任务日期]');
    await wait("document.querySelector('[aria-label=任务日期][open]')");
    await input('[aria-label=开始日期]', '2030-11-10');
    await input('[aria-label=截止日期]', '2030-11-12');
    await capture('04-task-dates.png');
    await button('确定日期');
    await click('[aria-label=设置新任务提醒]');
    await input('[aria-label=新任务提醒日期]', '2030-11-12');
    await input('[aria-label=新任务提醒时间]', '09:30');
    await capture('05-task-reminder.png');
    await button('确定提醒');
    await wait("!document.querySelector('[aria-label=新任务提醒][open]')");
    await click('[data-testid=create-task]');
    await wait(
      "document.querySelector('.task-detail') && !document.querySelector('.task-create-dialog')",
    );
    const created = (await task({ protocol_version: 1, operation: 'list' })).tasks.find(
      (t) => t.title === '示例 · 三页真实验收',
    );
    if (
      !created ||
      created.assignee !== null ||
      created.start_date !== '2030-11-10' ||
      created.due_date !== '2030-11-12'
    )
      throw Error('Created date range did not persist');
    const r = await evaluate(
      `window.caselite.reminder({protocol_version:1,operation:'list',task_id:${JSON.stringify(created.id)}})`,
    );
    if (!r.ok || r.reminders[0]?.time !== '09:30') throw Error('Initial reminder missing');
    stage = 'attachments';
    for (const name of ['合同示例.pdf', '沟通记录示例.docx']) {
      const staged = await materials.stage(join(root, name), created.id);
      if (!staged.ok || !staged.staged) throw Error('Attachment staging failed');
      const committed = await evaluate(
        `window.caselite.material({protocol_version:1,operation:'commit',scope:${JSON.stringify(created.id)},token:${JSON.stringify(staged.staged.token)}})`,
      );
      if (!committed.ok) throw Error('Attachment commit failed');
    }
    // 重开同一Task，材料仍由受控读取呈现，不注入卡片或伪造持久化。
    await click('[data-nav=tasks]');
    await wait(`document.querySelector('[data-row-task="${created.id}"]')`);
    await click(`[data-row-task="${created.id}"]`);
    await wait(
      "document.querySelectorAll('.task-work-area .task-attachments [aria-label=已保存任务附件] li').length===2",
    );
    if (
      await evaluate(
        "Boolean(document.querySelector('.task-inspector .task-attachments,.task-inspector .task-calendar-editor'))",
      )
    )
      throw Error('Attachment or calendar card remained in detail sidebar');
    stage = 'edit';
    await input('[aria-label=任务标题]', '示例 · 三页真实验收（已修改）');
    await input('[data-testid=task-content-editor]', '已核对合同履行时间，材料缺口已整理。');
    await click('[data-testid=save-task-content]');
    await wait(
      "document.querySelector('[data-testid=save-task-content]').disabled && document.querySelector('[data-testid=task-content-status]').textContent==='任务内容已保存'",
    );
    stage = 'comment';
    await input(
      '.project-discussion-compose [contenteditable=true]',
      '已补充合成合同与沟通记录，请先核对履行时间。',
    );
    await button('发布任务评论');
    await wait("document.querySelector('.project-discussion-entry')");
    await capture('03-task-detail.png');
    const actual = (await task({ protocol_version: 1, operation: 'read', task_id: created.id }))
      .tasks[0]!;
    const count = (await task({ protocol_version: 1, operation: 'list' })).tasks.length;
    writeFileSync(
      join(root, 'task-views-expected.json'),
      JSON.stringify(
        {
          id: actual.id,
          title: actual.title,
          objective: actual.objective,
          start: actual.start_date,
          due: actual.due_date,
          reminderDate: '2030-11-12',
          reminderInstant: r.reminders[0].instant,
          reminderTimezone: r.reminders[0].timezone,
          count,
        },
        null,
        2,
      ),
    );
    stage = 'narrow';
    await viewport(960);
    await capture('06-task-detail-narrow.png');
    writeFileSync(
      join(root, 'task-views-write.json'),
      JSON.stringify(
        {
          status: 'PASS_REAL',
          root,
          dateRange: true,
          initialReminder: true,
          contentSaved: true,
          commentSaved: true,
          attachments: 2,
          providerCalls: 0,
          physicalIme: 'NOT_RUN',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    writeFileSync(
      join(root, 'task-views-diagnostic.json'),
      JSON.stringify({ stage, error: String(error) }, null, 2),
    );
    await capture('task-views-failure.png').catch(() => {});
    throw error;
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
  }
}
