import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { app, session, type BrowserWindow } from 'electron';
import type { createTaskApplication } from '@caselite/application';

type Counts = { full: number; page: number; write: number; other: number };
type Tasks = ReturnType<typeof createTaskApplication>;

export function createTaskQueryProbe(tasks: Tasks) {
  const counts: Counts = { full: 0, page: 0, write: 0, other: 0 };
  return {
    counts,
    application: {
      execute(input: unknown) {
        // 仅隔离演练统计已通过 sender 校验的任务 IPC，不记录内容。
        const request = input as { operation?: unknown; query?: unknown } | null;
        if (request?.operation === 'list') counts[request.query ? 'page' : 'full']++;
        else if (request?.operation === 'change_status') counts.write++;
        else counts.other++;
        return tasks.execute(input);
      },
    },
  };
}

export async function runTaskQueryProbe(
  create: () => Promise<BrowserWindow>,
  root: string,
  tasks: Tasks,
  counts: Counts,
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + sep),
    )
  )
    throw new Error('Task query probe requires an isolated workspace');
  session.defaultSession.webRequest.onBeforeRequest((request, done) =>
    done({ cancel: /^https?:/i.test(request.url) }),
  );
  for (let i = 0; i < 42; i++) {
    const key = randomUUID();
    const created = tasks.execute({
      protocol_version: 1,
      operation: 'create',
      request_id: key,
      idempotency_key: key,
      title: `查询合成${i < 21 ? '甲' : '乙'}${i}`,
      objective: '',
    });
    if (!created.ok) throw new Error('Task query seed failed');
    if (i >= 21) {
      const change = randomUUID();
      const saved = tasks.execute({
        protocol_version: 1,
        operation: 'change_status',
        request_id: change,
        idempotency_key: change,
        task_id: created.tasks[0].id,
        expected_version: created.tasks[0].version,
        status: 'done',
      });
      if (!saved.ok) throw new Error('Task query status seed failed: ' + saved.code);
    }
  }
  const window = await create();
  const wc = window.webContents;
  wc.setBackgroundThrottling(false);
  const evaluate = (code: string) => wc.executeJavaScript(code);
  const wait = async (condition: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('Task query probe timed out: ' + condition);
  };
  const select = (label: string, value: string) =>
    evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')});
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  const footer = 'document.querySelector(".collection-footer")?.innerText';
  const page = (text: string, family?: string) =>
    wait(
      `${footer}?.includes(${JSON.stringify(text)})${family ? ` && [...document.querySelectorAll('[data-row-task]')].every(row=>row.textContent.includes(${JSON.stringify(family)}))` : ''}`,
    );
  const click = (label: string) =>
    evaluate(
      `[...document.querySelectorAll('.collection-footer button')].find(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled).click()`,
    );
  wc.debugger.attach('1.3');
  try {
    await wc.debugger.sendCommand('Network.enable');
    await wc.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await wait('navigator.onLine === false');
    await evaluate("document.querySelector('[data-nav=tasks]').click()");
    await page('1—20');
    const start = { ...counts };
    await select('筛选任务状态', 'todo');
    await page('1—20', '查询合成甲');
    await click('下一页');
    await page('21—21', '查询合成甲');
    await click('上一页');
    await page('1—20', '查询合成甲');
    await click('下一页');
    await page('21—21', '查询合成甲');
    const afterPaging = { ...counts };
    await select('筛选任务状态', 'done');
    await select('筛选任务状态', 'todo');
    await page('1—20', '查询合成甲');
    const beforeSave = { ...counts };
    await select('任务状态', 'done');
    await page('20 个任务', '查询合成甲');
    await wait("!document.querySelector('[aria-label=任务状态]')?.disabled");
    const afterSave = { ...counts };
    if (afterSave.write - beforeSave.write !== 1) throw new Error('Expected one status write');
    writeFileSync(
      join(root, 'task-query-result.json'),
      JSON.stringify(
        {
          offline: true,
          httpBlocked: true,
          start,
          afterPaging,
          beforeSave,
          afterSave,
        },
        null,
        2,
      ),
    );
  } finally {
    wc.debugger.detach();
  }
}
