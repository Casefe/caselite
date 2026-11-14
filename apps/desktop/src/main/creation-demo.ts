import { app, dialog, session, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { TaskResponse, MaterialResponse } from '@caselite/contracts';

// 仅在原宿主已验证的隔离合成目录运行；选择器结果注入单独留证，产品 IPC/落盘路径不替换。
export async function runCreationDemo(
  create: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  if (
    !app.getPath('userData').startsWith(root + sep) ||
    !app.getPath('sessionData').startsWith(root + sep)
  )
    throw Error('Creation demo isolation failed');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await create();
  window.webContents.setBackgroundThrottling(false);
  window.webContents.debugger.attach('1.3');
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const capture = async (name: string) => {
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
    });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const wait = async (code: string) => {
    for (let i = 0; i < 200; i++) {
      if (await evaluate(`Boolean(${code})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    writeFileSync(join(root, 'creation-failure.txt'), await evaluate('document.body.innerText'));
    await capture('creation-failure.png');
    throw Error('Creation assertion: ' + code);
  };
  const click = (selector: string) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const input = (selector: string, value: string) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const task = async (request: object) => {
    const result: TaskResponse = await evaluate(`window.caselite.task(${JSON.stringify(request)})`);
    if (!result.ok) throw Error(result.message);
    return result;
  };
  const materials = async (id: string) => {
    const r: MaterialResponse = await evaluate(
      `window.caselite.material({protocol_version:1,operation:'list',scope:${JSON.stringify(id)}})`,
    );
    if (!r.ok) throw Error(r.message);
    return r.materials;
  };
  const viewport = async (width: number) => {
    window.setContentSize(width, 1000);
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
  };
  const expectedFile = join(root, 'creation-expected.json');
  const oldPicker = dialog.showOpenDialog;
  let choice: string | null = '合成合同.pdf';
  dialog.showOpenDialog = (async () =>
    choice
      ? { canceled: false, filePaths: [join(root, choice)] }
      : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog;
  try {
    await viewport(1600);
    await wait("document.querySelector('[data-nav=calendar]')");
    await click('[data-nav=calendar]');
    await wait("document.querySelector('.calendar-workbench .workspace-page-create')");
    if (phase.endsWith('-read') || phase.endsWith('-preview')) {
      const expected = JSON.parse(readFileSync(expectedFile, 'utf8')) as {
        id: string;
        title: string;
        attachments: number;
        schedule: boolean;
      }[];
      for (const row of expected) {
        const saved = (await task({ protocol_version: 1, operation: 'read', task_id: row.id }))
          .tasks[0];
        if (
          saved?.title !== row.title ||
          (await materials(row.id)).length !== row.attachments ||
          Boolean(saved.calendar?.schedule) !== row.schedule
        )
          throw Error('Creation restart mismatch');
      }
      const last = expected[1];
      await wait(
        `[...document.querySelectorAll('.calendar-shared-task')].some(e=>e.textContent.includes(${JSON.stringify(last.title)}))`,
      );
      await evaluate(
        `[...document.querySelectorAll('.calendar-shared-task')].find(e=>e.textContent.includes(${JSON.stringify(last.title)})).querySelector('.task-row-title').click()`,
      );
      await wait(
        `document.querySelector('.calendar-task-inspector')?.textContent.includes(${JSON.stringify(last.title)})`,
      );
      await capture('05-creation-reopened.png');
      if (phase.endsWith('-preview')) {
        window.setTitle('CaseLite · 日历创建验收 · 合成资料');
        window.show();
        return;
      }
      writeFileSync(
        join(root, 'task-views-creation-read.json'),
        JSON.stringify({ status: 'PASS_REAL', expected, realProviderCalls: 0 }),
      );
      return;
    }
    const createInCalendar = async (kind: 'task' | 'schedule') => {
      if (kind === 'schedule') {
        await click('.calendar-workbench .workspace-page-create');
      } else {
        await evaluate(
          "(()=>{const menu=document.querySelector('.calendar-workbench .workspace-page-more');if(!menu.open)menu.querySelector('summary').click();})()",
        );
        await click('.calendar-workbench .workspace-page-more button');
      }
    };
    const expected: { id: string; title: string; attachments: number; schedule: boolean }[] = [];
    for (const kind of ['task', 'schedule'] as const) {
      await createInCalendar(kind);
      await wait(
        "document.querySelector('.task-create-dialog[open]') && !document.querySelector('.file-upload-button').disabled",
      );
      const title = kind === 'task' ? '日历合成任务｜合同审阅' : '日历合成日程｜沟通会议';
      await input('[data-testid=task-title]', title);
      if (kind === 'schedule') {
        await input('[aria-label=日程开始时间]', '16:00');
        await input('[aria-label=日程结束时间]', '15:00');
        if (!(await evaluate("document.querySelector('[data-testid=create-task]').disabled")))
          throw Error('Invalid time accepted');
        await input('[aria-label=日程开始时间]', '14:00');
        await input('[aria-label=日程结束时间]', '15:00');
      }
      choice = '合成合同.pdf';
      await click('.file-upload-button');
      await wait(
        "document.querySelector('.creation-attachments li') && !document.querySelector('.file-upload-button').disabled",
      );
      if (kind === 'task') {
        choice = '合成说明.docx';
        await click('.file-upload-button');
        await wait(
          "document.querySelectorAll('.creation-attachments li').length===2 && !document.querySelector('.file-upload-button').disabled",
        );
      }
      await capture(
        kind === 'task' ? '01-native-create-task.png' : '03-native-create-schedule.png',
      );
      if (kind === 'schedule') {
        await viewport(640);
        await capture('04-native-schedule-narrow.png');
        await viewport(1600);
      }
      await click('[data-testid=create-task]');
      await wait("!document.querySelector('.task-create-dialog[open]')");
      const saved = (await task({ protocol_version: 1, operation: 'list' })).tasks.find(
        (t) => t.title === title,
      );
      if (!saved) throw Error('Created task missing');
      const files = await materials(saved.id),
        count = kind === 'task' ? 2 : 1;
      if (
        files.length !== count ||
        saved.due_date !== null ||
        saved.start_date !== null ||
        Boolean(saved.calendar?.schedule) !== (kind === 'schedule')
      )
        throw Error('Creation fields or attachments mismatch');
      expected.push({ id: saved.id, title, attachments: count, schedule: kind === 'schedule' });
      if (kind === 'task') await capture('02-native-calendar-created-task.png');
    }
    // 空选择和移除末份分别走真实创建事务，覆盖空附件草稿的保存路径。
    for (const removeLast of [false, true]) {
      await createInCalendar('task');
      await wait(
        "document.querySelector('.task-create-dialog[open]') && !document.querySelector('.file-upload-button').disabled",
      );
      choice = removeLast ? '合成合同.pdf' : null;
      await click('.file-upload-button');
      await wait("!document.querySelector('.file-upload-button').disabled");
      if (removeLast) {
        await wait("document.querySelector('.creation-attachments li button')");
        await click('.creation-attachments li button');
        await wait(
          "!document.querySelector('.creation-attachments li') && !document.querySelector('.file-upload-button').disabled",
        );
      }
      const title = removeLast ? '合成移除末份后创建' : '合成取消选择后创建';
      await input('[data-testid=task-title]', title);
      await click('[data-testid=create-task]');
      await wait("!document.querySelector('.task-create-dialog[open]')");
      const saved = (await task({ protocol_version: 1, operation: 'list' })).tasks.find(
        (t) => t.title === title,
      );
      if (!saved || (await materials(saved.id)).length) throw Error('Empty draft creation failed');
      expected.push({ id: saved.id, title, attachments: 0, schedule: false });
    }
    const beforeCancel = (await task({ protocol_version: 1, operation: 'list' })).tasks.length;
    await createInCalendar('task');
    await wait(
      "document.querySelector('.task-create-dialog[open]') && !document.querySelector('.file-upload-button').disabled",
    );
    choice = '合成合同.pdf';
    await click('.file-upload-button');
    await wait(
      "document.querySelector('.creation-attachments li') && !document.querySelector('.file-upload-button').disabled",
    );
    await evaluate('void (window.confirm=()=>true)');
    await click('[aria-label=取消新建任务]');
    await wait("!document.querySelector('.task-create-dialog[open]')");
    if ((await task({ protocol_version: 1, operation: 'list' })).tasks.length !== beforeCancel)
      throw Error('Cancel created a phantom Task');
    const pending: MaterialResponse = await evaluate(
      "window.caselite.material({protocol_version:1,operation:'creation_resume',scope:'home'})",
    );
    if (!pending.ok || pending.creation_draft) throw Error('Cancelled attachments still pending');
    writeFileSync(expectedFile, JSON.stringify(expected));
    writeFileSync(
      join(root, 'task-views-creation-write.json'),
      JSON.stringify({
        status: 'PASS_REAL',
        expected,
        filePickerSelection: 'INJECTED_SYNTHETIC_RESULT',
        realProviderCalls: 0,
        physicalFileDialog: 'NOT_RUN',
        discardConfirmation: 'INJECTED_ACCEPT',
      }),
    );
  } finally {
    dialog.showOpenDialog = oldPicker;
  }
}
