import { app, session, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { openToolchainProbe } from '@caselite/local-db';
import type { TaskResponse } from '@caselite/contracts';

export async function runTaskStatusDemo(
  create: () => Promise<BrowserWindow>,
  root: string,
  phase: 'task-status-write' | 'task-status-read',
) {
  const isolation = {
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    storage: session.defaultSession.storagePath,
  };
  if (Object.values(isolation).some((path) => !path?.startsWith(root + sep)))
    throw new Error('Status probe escaped its isolated directory');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await create();
  window.webContents.setBackgroundThrottling(false);
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Task status probe timed out: ' + predicate);
  };
  const capture = async (name: string) =>
    writeFileSync(join(root, name), (await window.webContents.capturePage()).toPNG());
  const click = async (label: string) => {
    await wait(
      `Array.from(document.querySelectorAll('button')).some((b)=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('button')).find((b)=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled).click()`,
    );
  };
  const status = async (value: string) =>
    evaluate(
      `(()=>{const input=document.querySelector('[aria-label=任务状态]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
  const read = async (id: string) => {
    const r: TaskResponse = await evaluate(
      `window.caselite.task({protocol_version:1,operation:'read',task_id:${JSON.stringify(id)}})`,
    );
    if (!r.ok) throw new Error('Status probe Task read failed');
    return r;
  };
  const digest = (value: number[] | null | undefined) =>
    createHash('sha256')
      .update(Uint8Array.from(value ?? []))
      .digest('hex');
  try {
    await wait("document.querySelector('[data-nav=tasks]')");
    await evaluate("document.querySelector('[data-nav=tasks]').click()");
    await wait("document.querySelector('[data-testid=new-task]')");
    const displayTimezone: string = await evaluate(
      'Intl.DateTimeFormat().resolvedOptions().timeZone',
    );
    let id: string;
    let readResult: Record<string, unknown> | undefined;
    if (phase === 'task-status-write') {
      await evaluate("document.querySelector('[data-testid=new-task]').click()");
      await wait("document.querySelector('[data-testid=task-title]')");
      await evaluate(
        "(()=>{const e=document.querySelector('[data-testid=task-title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'状态与重启验收');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
      );
      await evaluate("document.querySelector('[data-testid=create-task]').click()");
      await wait(
        "document.querySelector('[data-active-task]') && document.querySelector('[data-testid=body-editor]')",
      );
      id = await evaluate("document.querySelector('[data-active-task]').dataset.activeTask");
      await evaluate(
        "document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,'状态修改不得清空本段正文。')",
      );
      await wait("document.querySelector('[data-testid=save-body]')?.disabled===false");
      await evaluate("document.querySelector('[data-testid=save-body]').click()");
      await wait(
        "document.querySelector('[data-testid=revision]')?.textContent==='1' && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
      );
      await evaluate(
        "document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,'未保存尾段。')",
      );
      await wait("document.querySelector('[data-testid=save-body]')?.disabled===false");
      if (!(await evaluate("document.querySelector('[aria-label=任务状态]').disabled")))
        throw new Error('Unsaved body does not guard status changes');
      await capture('status-unsaved-body.png');
      await evaluate("document.querySelector('[data-testid=save-body]').click()");
      await wait(
        "document.querySelector('[data-testid=revision]')?.textContent==='2' && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备'",
      );
      const bodyHash = digest((await read(id)).state);
      await status('in_progress');
      await wait("document.body.innerText.includes('状态尚未保存')");
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.isContentEditable===false && document.querySelector('[data-testid=save-body]')?.disabled===true",
      );
      const connection = openToolchainProbe(
        join(isolation.userData, 'caselite.sqlite'),
        join(process.resourcesPath, 'migrations'),
      );
      try {
        connection.sqlite.exec(
          "CREATE TRIGGER reject_status BEFORE INSERT ON task_activity WHEN NEW.operation='change_status' BEGIN SELECT RAISE(ABORT,'synthetic status failure'); END",
        );
        await click('保存任务状态');
        await wait("document.querySelector('.task-properties-editor [role=alert]')");
        if ((await read(id)).tasks[0].status !== 'todo')
          throw new Error('Failed status write changed the Task');
        await capture('status-write-failed.png');
      } finally {
        connection.sqlite.exec('DROP TRIGGER reject_status');
        connection.sqlite.close();
      }
      await click('保存任务状态');
      await wait(
        "document.querySelector('.task-properties-editor')?.textContent.includes('当前已保存：进行中')",
      );
      await status('done');
      await click('保存任务状态');
      await wait(
        "document.querySelector('.task-properties-editor')?.textContent.includes('当前已保存：已完成')",
      );
      if (digest((await read(id)).state) !== bodyHash)
        throw new Error('Status changed the saved body bytes');
      await click('任务目标');
      await wait("document.querySelector('[data-testid=task-content-editor]')");
      await evaluate(
        "document.querySelector('[data-testid=task-content-editor]').focus();document.execCommand('insertText',false,'人工确认的说明。')",
      );
      await wait("document.querySelector('[data-testid=save-task-content]')?.disabled===false");
      await evaluate("document.querySelector('[data-testid=save-task-content]').click()");
      await wait(
        "document.querySelector('[data-testid=save-task-content]')?.disabled===true && document.querySelector('[data-testid=task-content-status]')?.textContent==='任务内容已保存'",
      );
      await status('todo');
      await click('保存任务状态');
      await wait(
        "document.querySelector('.task-properties-editor')?.textContent.includes('当前已保存：待办')",
      );
      await evaluate(
        "document.querySelector('[data-testid=task-content-editor]').focus();document.execCommand('insertText',false,'追加说明。')",
      );
      await wait("document.querySelector('[data-testid=save-task-content]')?.disabled===false");
      await evaluate("document.querySelector('[data-testid=save-task-content]').click()");
      await wait(
        "document.querySelector('[data-testid=save-task-content]')?.disabled===true && document.querySelector('[data-testid=task-content-status]')?.textContent==='任务内容已保存'",
      );
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait(`document.querySelector('[data-row-task="${id}"]')`);
      await status('done');
      await click('保存任务状态');
      await wait(`document.querySelector('[data-row-task="${id}"] [data-status=done]')`);
      const attributes = async (date: string, priority: number) => {
        await evaluate(
          `(()=>{const p=document.querySelector('[aria-label=任务优先级]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(p,${JSON.stringify(String(priority))});p.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await evaluate(
          `(()=>{const d=document.querySelector('[aria-label=普通截止日期]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(d,${JSON.stringify(date)});d.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await click('保存任务属性');
        await wait(
          `document.querySelector('[data-testid=saved-task-attributes]')?.textContent.includes(${JSON.stringify(date || '无截止日期')}) && !document.body.innerText.includes('属性尚未保存')`,
        );
        const t = (await read(id)).tasks[0];
        if (t.due_date !== (date || null) || t.priority !== priority || t.status !== 'done')
          throw new Error('Task attributes literal/clear/status preservation failed');
      };
      await attributes('2024-02-29', 1);
      await attributes('', 0);
      await attributes('2026-01-01', 2);
      await evaluate("document.querySelector('[aria-label=普通截止日期]').focus()");
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
      await wait(
        "document.querySelector('[aria-label=普通截止日期]')?.getAttribute('aria-invalid')==='true'",
      );
      if (
        !(await evaluate(
          "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存任务属性')?.disabled",
        )) ||
        (await read(id)).tasks[0].due_date !== '2026-01-01'
      )
        throw new Error('Native incomplete date can silently clear saved date');
      await capture('attributes-incomplete-date.png');
      await evaluate(
        "(()=>{const d=document.querySelector('[aria-label=普通截止日期]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(d,'2026-01-01');d.dispatchEvent(new Event('input',{bubbles:true}));})()",
      );
      await wait(
        "document.querySelector('[aria-label=普通截止日期]')?.getAttribute('aria-invalid')==='false'",
      );
      const filter = async (label: string, value: string) =>
        evaluate(
          `(()=>{const p=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(p,${JSON.stringify(value)});p.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
      await filter('筛选任务状态', 'todo');
      await wait("document.querySelector('.task-query-list .table-empty')");
      await filter('筛选任务状态', 'done');
      await wait(`document.querySelector('[data-row-task="${id}"]')`);
      await filter('筛选任务优先级', '1');
      await wait("document.querySelector('.task-query-list .table-empty')");
      await filter('筛选任务优先级', '2');
      await wait(`document.querySelector('[data-row-task="${id}"]')`);
      await filter('筛选普通日期', 'undated');
      await wait("document.querySelector('.task-query-list .table-empty')");
      await filter('筛选普通日期', 'dated');
      await wait(`document.querySelector('[data-row-task="${id}"]')`);
      await evaluate(
        "(()=>{const p=document.querySelector('[aria-label=搜索任务]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(p,'状态');p.dispatchEvent(new Event('input',{bubbles:true}));})()",
      );
      await wait(`document.querySelector('[data-row-task="${id}"]')`);
      await evaluate(`document.querySelector('[data-row-task="${id}"]').focus()`);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await wait(
        `document.querySelector('[data-active-task]')?.dataset.activeTask===${JSON.stringify(id)}`,
      );
      await evaluate("document.querySelector('[data-testid=back-to-tasks]').click()");
      await wait(`document.querySelector('[data-row-task="${id}"][aria-current=true]')`);
      if (
        !(await evaluate(
          "document.querySelector('[aria-label=搜索任务]').value==='状态' && document.querySelector('[aria-label=筛选任务优先级]').value==='2'",
        ))
      )
        throw new Error('Task list return lost its filters');
      for (const width of [640, 1440]) {
        window.setSize(width, 900);
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (
          !(await evaluate(
            "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.task-query-list').getBoundingClientRect().right<=innerWidth+1",
          ))
        )
          throw new Error('Task list overflow at ' + width);
        await capture(`task-list-${width}.png`);
      }
      const final = await read(id),
        task = final.tasks[0];
      if (
        !task.objective.includes('人工确认的说明。') ||
        !task.objective.includes('追加说明。') ||
        digest(final.state) !== bodyHash
      )
        throw new Error('Description edit after status change lost data or used a stale version');
      writeFileSync(
        join(root, 'task-status-expected.json'),
        JSON.stringify(
          { task, bodyHash, goalHash: digest(final.objective_state), isolation, displayTimezone },
          null,
          2,
        ),
      );
      await capture('status-list-saved.png');
    } else {
      const expected = JSON.parse(readFileSync(join(root, 'task-status-expected.json'), 'utf8'));
      id = expected.task.id;
      await wait(`document.querySelector('[data-row-task="${id}"] [data-status=done]')`);
      await evaluate(
        `document.querySelector('[data-row-task="${id}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
      );
      await wait(
        `document.querySelector('[data-active-task]')?.dataset.activeTask===${JSON.stringify(id)}`,
      );
      const restored = await read(id);
      if (displayTimezone === expected.displayTimezone)
        throw new Error('Cross-process timezone did not change');
      if (
        JSON.stringify(restored.tasks[0]) !== JSON.stringify(expected.task) ||
        digest(restored.state) !== expected.bodyHash ||
        digest(restored.objective_state) !== expected.goalHash
      )
        throw new Error('Restart changed committed Task status, identity or body');
      await wait(
        "document.querySelector('[data-testid=body-editor]')?.textContent.includes('未保存尾段。')",
      );
      await capture('status-reopened.png');
      readResult = {
        status: 'PASS_REAL',
        task: restored.tasks[0],
        bodyHash: expected.bodyHash,
        goalHash: expected.goalHash,
        displayTimezone,
        writeTimezone: expected.displayTimezone,
        realProviderDispatches: 0,
        isolation,
      };
    }
    const agent = await evaluate(
      `window.caselite.agent({protocol_version:1,operation:'read',scope:${JSON.stringify(id)}})`,
    );
    if (!agent.ok || agent.runs.length || existsSync(join(root, 'unexpected-runtime.txt')))
      throw new Error('Task status probe dispatched an Agent');
    if (phase === 'task-status-write') {
      writeFileSync(
        join(root, 'task-status-crash-ready.json'),
        JSON.stringify({
          taskId: id,
          pid: process.pid,
          expectedSha256: createHash('sha256')
            .update(readFileSync(join(root, 'task-status-expected.json')))
            .digest('hex'),
        }),
      );
      process.kill(process.pid, 'SIGKILL');
    } else
      writeFileSync(join(root, 'task-status-result.json'), JSON.stringify(readResult, null, 2));
  } catch (error) {
    writeFileSync(join(root, 'task-status-failure.txt'), String(error));
    await capture('status-failure.png');
    throw error;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
