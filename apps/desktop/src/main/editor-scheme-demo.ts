import type { createTaskApplication } from '@caselite/application';
import type { AgentRun } from '@caselite/contracts';
import { app, clipboard, session, type BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { recoveryDigest, type createEditorRecoveryFixture } from './editor-recovery-fixture';

// 沿既有临时目录门禁和合成 Provider；通过真实界面保存，禁止访问正式工作区。
export async function runEditorSchemeDemo(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  tasks: ReturnType<typeof createTaskApplication>,
  runs: () => AgentRun[],
  recovery?: ReturnType<typeof createEditorRecoveryFixture>,
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + '/'),
    )
  )
    throw new Error('Editor scheme isolation failed');
  const window = await createWindow();
  window.setContentSize(1440, 960);
  window.webContents.setBackgroundThrottling(false);
  const wc = window.webContents;
  wc.debugger.attach('1.3');
  const command = (method: string, params?: Record<string, unknown>) =>
    wc.debugger.sendCommand(method, params);
  const evaluate = (source: string) => wc.executeJavaScript(source);
  const capture = async (name: string) => {
    await evaluate('document.fonts.ready');
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot = await command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const wait = async (condition: string) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await capture('editor-scheme-failure.png');
    throw new Error('Editor scheme condition failed: ' + condition);
  };
  const click = async (selector: string) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const named = (label: string) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled)`;
  const button = async (label: string) => {
    await wait(named(label));
    await evaluate(`${named(label)}.click()`);
  };
  const list = tasks.execute({ protocol_version: 1, operation: 'list' });
  if (!list.ok || list.tasks.length !== 2) throw new Error('Missing scheme samples');
  const task = list.tasks.find((item) => item.title.includes('合成文档甲'));
  if (!task) throw new Error('Missing target scheme document');
  const taskScope = `.task-detail[data-active-task="${task.id}"][data-task-tab=result]`;
  const body = `document.querySelector(${JSON.stringify(taskScope + ' [data-testid=body-editor]')})`;
  const surface = `document.querySelector(${JSON.stringify(taskScope + ' .document .rich-editor[data-editor-scheme]')})`;
  const selectionMenu = "document.querySelector('.selection-tools')";
  const readTarget = () => {
    const result = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
    const saved = result.ok && result.tasks[0];
    if (
      !result.ok ||
      !saved ||
      saved.id !== task.id ||
      saved.document_id !== task.document_id ||
      saved.body_id !== task.body_id
    )
      throw new Error('Cannot read the original scheme document');
    return result;
  };
  const waitSaved = async (previousRevision: number, expected: string[]) => {
    for (let i = 0; i < 150; i++) {
      const result = readTarget();
      if (result.state && result.tasks[0].body_revision > previousRevision) {
        const doc = new Y.Doc();
        try {
          Y.applyUpdate(doc, Uint8Array.from(result.state));
          const xml = doc.getXmlFragment('default').toString();
          // 同时核对原任务身份、落盘正文和全文编辑器回执，不把内联 Word 入口当成双方案消费者。
          if (
            expected.every((text) => xml.includes(text)) &&
            (await evaluate(
              `document.querySelector(${JSON.stringify(taskScope + ' [data-testid=save-status]')})?.textContent.trim()==='已保存到此设备'`,
            ))
          )
            return result;
        } finally {
          doc.destroy();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await capture('editor-scheme-failure.png');
    throw new Error('Current full editor save was not confirmed');
  };
  const selectParagraph = async () => {
    app.focus({ steal: true });
    window.focus();
    wc.focus();
    await wait('document.hasFocus()');
    await evaluate(
      `(()=>{${body}.parentElement.scrollTop=0;const p=${body}.querySelector('p');${body}.focus();const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`,
    );
    await wait(`${selectionMenu} && getComputedStyle(${selectionMenu}).visibility==='visible'`);
    await wait(
      `(()=>{const r=${selectionMenu}.getBoundingClientRect();return r.width>0 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()`,
    );
  };
  const open = async (result = true, id = task.id) => {
    await click('[data-nav=tasks]');
    // 任务标题沿现有 onOpen 进入详情，避免任务预览开关只改变列表选择而未打开正文。
    await click(`.task-row[data-row-task="${id}"] .task-row-title`);
    await wait(
      `document.querySelector('.task-detail')?.getAttribute('data-active-task')===${JSON.stringify(id)}`,
    );
    if (!result) return;
    await click(
      `.task-detail[data-active-task="${task.id}"] [data-testid=task-result-tab]:not(:disabled)`,
    );
    await wait(body);
  };
  const scheme = async (value: 'markdown' | 'word') => {
    await click('[data-nav=settings]');
    await button('编辑器');
    await wait("document.querySelector('.editor-settings fieldset:not(:disabled)')");
    const radio = `input[name=editor-scheme][value=${value}]`;
    await wait(`document.querySelector(${JSON.stringify(radio)})`);
    if (!(await evaluate(`document.querySelector(${JSON.stringify(radio)}).checked`))) {
      await click(radio);
      await button('保存编辑器设置');
      await wait(
        "document.querySelector('.editor-settings [role=status]')?.textContent.includes('已保存到此工作区')",
      );
    }
    await capture(`settings-${value}.png`);
    await click('.settings-back');
    await wait(`${surface}?.dataset.editorScheme===${JSON.stringify(value)}`);
  };
  const recoveryPhase = phase.startsWith('editor-scheme-recovery-');
  const runRecovery = async () => {
    if (!recovery) throw new Error('Missing guarded recovery fixture');
    const started = Date.now();
    const firstEvent = recovery.snapshot().events.length;
    const events = (type: string) =>
      recovery
        .snapshot()
        .events.slice(firstEvent)
        .filter((event) => event.type === type);
    const assertRecovery = (condition: unknown, message: string) => {
      if (!condition) throw new Error(message);
    };
    // 仅此新用例观察真实15秒桥接超时；不改原12秒wait或runner的60秒总预算。
    const observe = async (condition: () => boolean | Promise<boolean>) => {
      while (Date.now() - started < 45_000) {
        assertRecovery(!events('violation').length, 'Recovery fixture scope/concurrency violation');
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      throw new Error('Recovery observation exceeded the existing stage budget');
    };
    const savedStatus = `document.querySelector(${JSON.stringify(taskScope + ' [data-testid=save-status]')})?.textContent`;
    const isSaved = () => evaluate(`${savedStatus}==='已保存到此设备'`);
    const textOf = (state: number[] | null | undefined) => {
      assertRecovery(state, 'Missing durable Yjs state');
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, Uint8Array.from(state!));
        return doc.getXmlFragment('default').toString();
      } finally {
        doc.destroy();
      }
    };
    const appendBody = async (text: string) => {
      await evaluate(
        `(()=>{${body}.focus();const r=document.createRange();r.selectNodeContents(${body});r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);})()`,
      );
      await command('Input.insertText', { text });
      await wait(`${body}.textContent.includes(${JSON.stringify(text)})`);
    };
    const save = () => click(`${taskScope} [data-testid=save-body]:not(:disabled)`);
    const before = readTarget();
    const initialRuns = runs().map((run) => run.id);
    let consumer = 'nonembedded BodyEditor; manual save';
    let objectSwitch = 'NOT_RUN';
    let transportUnknown = 'NOT_RUN';
    let lateAckReleaseMs: number | null = null;
    const target = { taskId: task.id, documentId: task.document_id, bodyId: task.body_id };
    if (phase === 'editor-scheme-recovery-read') {
      for (const suffix of ['save-r1', 'unknown-r1', 'unknown-r2', 'late-r1', 'late-r2'])
        assertRecovery(
          textOf(before.state).includes(`[RECOVERY-${suffix}]`),
          'Missing reopened recovery body',
        );
      const prior = JSON.parse(
        readFileSync(join(root, 'editor-scheme-recovery-agent.json'), 'utf8'),
      );
      assertRecovery(
        prior.taskId === task.id &&
          prior.revision === before.tasks[0].body_revision &&
          prior.stateSha256 === recoveryDigest(Uint8Array.from(before.state!)) &&
          JSON.stringify(prior.runs) ===
            JSON.stringify(
              runs().map((run) => ({
                id: run.id,
                scope: run.scope,
                status: run.status,
                outputSha256: recoveryDigest(run.output),
              })),
            ),
        'Recovery reopen changed the original body or Run identities',
      );
      await wait(`${body}.textContent.includes('[RECOVERY-late-r2]')`);
    } else if (
      phase === 'editor-scheme-recovery-copy' ||
      phase === 'editor-scheme-recovery-agent'
    ) {
      consumer = 'task content SidebarAgent / AgentPanel';
      const ai = "document.querySelector('.sidebar-agent textarea[data-testid=assistant-input]')";
      const ensureAi = async () => {
        for (const label of ['展开右侧属性栏', '打开 AI 对话', '展开 AI 对话']) {
          const selector = `[aria-label="${label}"]:not(:disabled)`;
          if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))
            await click(selector);
        }
        await wait(`${ai} && !${ai}.disabled && ${ai}.getBoundingClientRect().height>0`);
      };
      const typeAi = async (text: string) => {
        await evaluate(`${ai}.focus()`);
        await command('Input.insertText', { text });
        await wait(`${ai}.value===${JSON.stringify(text)}`);
      };
      const clearAi = async () => {
        await evaluate(`${ai}.focus();${ai}.select()`);
        await command('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        await command('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        await wait(`${ai}.value===''`);
      };
      await ensureAi();
      const stopCase = phase.endsWith('-agent');
      if (stopCase) recovery.armAgent({ owner: String(wc.id), scope: task.id });
      await typeAi(stopCase ? '伸缩流式测试：核对原发送与停止迟到。' : '合成复制失败恢复验证。');
      const sentAt = Date.now();
      await click('.sidebar-agent .assistant-submit:not(:disabled)');
      await observe(() => runs().filter((run) => !initialRuns.includes(run.id)).length === 1);
      const current = () => runs().find((run) => !initialRuns.includes(run.id))!;
      assertRecovery(current().scope === task.id, 'Agent used another task scope');
      if (stopCase) {
        await observe(() => recovery.snapshot().held === 1 && Boolean(current().output));
        await click('.sidebar-agent [aria-label=停止生成]');
        await observe(() => current().status === 'cancelled');
        const original = { id: current().id, output: current().output };
        const b = list.tasks.find((item) => item.id !== task.id)!;
        await open(false, b.id);
        await ensureAi();
        await typeAi('合成乙对象独立草稿');
        await observe(
          async () =>
            Date.now() - sentAt >= 15_000 && (await evaluate(`${ai}.value==='合成乙对象独立草稿'`)),
        );
        recovery.releaseHeld();
        await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        assertRecovery(
          current().id === original.id &&
            current().status === 'cancelled' &&
            current().output === original.output &&
            runs().length === initialRuns.length + 1,
          'Late start/stream changed the stopped Run',
        );
        assertRecovery(
          await evaluate(
            `${ai}.value==='合成乙对象独立草稿' && !document.querySelector('.sidebar-agent .assistant-message--assistant')`,
          ),
          'Late original response changed task B',
        );
        objectSwitch = 'PASS_REAL: stopped task A to B; B draft retained';
        transportUnknown =
          'held original start ACK across existing 15s budget; read/stop remained available';
        await capture(`${phase}-object-b.png`);
        await clearAi();
        await open(false);
        await ensureAi();
        assertRecovery(
          events('agent-start-arrival').length === 1 &&
            events('synthetic-stream-start').length === 1,
          'Unknown start dispatched more than one Run',
        );
      } else {
        assertRecovery(
          process.env.CASELITE_EDITOR_RECOVERY_CLIPBOARD === 'synthetic',
          'Successful copy requires Root synthetic clipboard handoff',
        );
        await observe(() => current().status === 'succeeded');
        const original = JSON.stringify(runs());
        const output = current().output;
        const draft = '合成未发送复制恢复草稿';
        await typeAi(draft);
        recovery.armCopy({
          owner: String(wc.id),
          scope: task.id,
          runId: current().id,
          outputSha256: recoveryDigest(output),
        });
        const copy = '.sidebar-agent .assistant-message-footer button';
        await click(copy);
        await wait(
          `document.querySelector(${JSON.stringify(copy)})?.textContent.includes('复制失败')`,
        );
        assertRecovery(
          events('copy-failed').length === 1 &&
            !events('copy-output-delegate').length &&
            JSON.stringify(runs()) === original &&
            (await evaluate(`${ai}.value===${JSON.stringify(draft)}`)),
          'Copy failure lost the answer/draft or wrote to clipboard',
        );
        await capture(`${phase}-failed.png`);
        await click(copy);
        await wait(`document.querySelector(${JSON.stringify(copy)})?.textContent==='已复制'`);
        assertRecovery(
          events('copy-output-delegate').length === 1 &&
            (await clipboard.readText()) === output &&
            events('synthetic-stream-start').length === 1 &&
            JSON.stringify(runs()) === original &&
            (await evaluate(`${ai}.value===${JSON.stringify(draft)}`)),
          'Copy retry changed the Run or draft',
        );
        await clearAi();
      }
    } else {
      const kind = phase.slice('editor-scheme-recovery-'.length);
      assertRecovery(['save', 'unknown', 'late'].includes(kind), 'Invalid recovery save case');
      const r1 = `[RECOVERY-${kind}-r1]`;
      const r2 = `[RECOVERY-${kind}-r2]`;
      await appendBody(r1);
      recovery.armSave(target, kind === 'save' ? 'fail' : 'hold');
      const submittedAt = Date.now();
      await save();
      if (kind === 'save') {
        await observe(() => events('save-port-failed').length === 1);
        await wait(`${savedStatus}?.includes('本地操作失败')`);
        const failed = readTarget();
        assertRecovery(
          failed.tasks[0].body_revision === before.tasks[0].body_revision &&
            JSON.stringify(failed.state) === JSON.stringify(before.state) &&
            !events('save-port-delegate').length &&
            (await evaluate(`${body}.textContent.includes(${JSON.stringify(r1)})`)),
          'Failed save changed durable body or lost input',
        );
        await capture(`${phase}-failed.png`);
        await save();
        await observe(isSaved);
        const arrivals = events('save-arrival');
        assertRecovery(
          arrivals.length === 2 &&
            arrivals[0].requestSha256 === arrivals[1].requestSha256 &&
            events('status-arrival').length === 1 &&
            events('status-arrival')[0].idempotencyKey === arrivals[0].idempotencyKey &&
            events('task-result').some((e) => e.operation === 'status' && e.code === 'NOT_FOUND') &&
            events('save-port-delegate').length === 1,
          'Save retry did not reconcile and replay the original request',
        );
      } else {
        await observe(() => recovery.snapshot().held === 1);
        if (kind === 'late') {
          await appendBody(r2);
          await click('[data-nav=tasks]');
          await wait(
            `document.querySelector('.task-detail')?.dataset.activeTask===${JSON.stringify(task.id)}`,
          );
          assertRecovery(
            await evaluate("document.body.innerText.includes('请先保存当前内容或核对提交结果')"),
            'Dirty navigation guard was bypassed',
          );
          const stillSaving = await evaluate(
            `(()=>{const b=document.querySelector(${JSON.stringify(taskScope + ' [data-testid=save-body]')});return b?.disabled && b.textContent.trim()==='保存中…';})()`,
          );
          lateAckReleaseMs = Date.now() - submittedAt;
          assertRecovery(
            lateAckReleaseMs < 15_000 &&
              stillSaving &&
              recovery.snapshot().held === 1 &&
              events('status-arrival').length === 0,
            'Late-save case crossed the original bridge timeout; cannot claim pre-timeout ACK',
          );
          objectSwitch = 'PASS_REAL: pending body blocked leaving; late unmount NOT_RUN';
          recovery.releaseHeld();
          await wait(`${savedStatus}==='较早修订已保存，仍有未保存修改'`);
        } else {
          await observe(() =>
            events('task-result').some((e) => e.operation === 'status' && e.ok === true),
          );
          assertRecovery(
            recovery.snapshot().held === 1 &&
              events('save-arrival').length === 1 &&
              events('status-arrival')[0]?.idempotencyKey ===
                events('save-arrival')[0]?.idempotencyKey,
            'Unknown save did not query original committed receipt',
          );
          await observe(isSaved);
          transportUnknown =
            'PASS_REAL: original ACK still held; existing preload timeout followed by original-key status';
          await appendBody(r2);
          recovery.releaseHeld();
          await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          assertRecovery(!(await isSaved()), 'Expired ACK cleared newer unsaved input');
        }
        assertRecovery(
          !textOf(readTarget().state).includes(r2),
          'Newer input saved before explicit manual save',
        );
        await save();
        await observe(isSaved);
        assertRecovery(
          events('save-port-delegate').length === 2 && events('save-arrival').length === 2,
          'ACK recovery duplicated or dropped a body save',
        );
      }
      assertRecovery(
        textOf(readTarget().state).includes(r1) &&
          (kind === 'save' || textOf(readTarget().state).includes(r2)),
        'Recovered durable body is incomplete',
      );
    }
    assertRecovery(
      !events('violation').length && recovery.snapshot().held === 0,
      'Unresolved fixture or scope violation',
    );
    const after = readTarget();
    await capture(`${phase}.png`);
    writeFileSync(
      join(root, `${phase}.json`),
      JSON.stringify(
        {
          status: 'PASS_REAL',
          phase,
          consumer,
          taskId: task.id,
          documentId: task.document_id,
          bodyId: task.body_id,
          revision: after.tasks[0].body_revision,
          stateSha256: recoveryDigest(Uint8Array.from(after.state!)),
          runs: runs().map((run) => ({
            id: run.id,
            scope: run.scope,
            status: run.status,
            outputSha256: recoveryDigest(run.output),
          })),
          initialRunIds: initialRuns,
          objectSwitch,
          transportUnknown,
          lateAckReleaseMs,
          realProviderCalls: 0,
          provider: 'MOCK_ONLY: existing syntheticReviewStream',
          systemChineseIme: 'NOT_RUN',
          coldDatabaseAudit: 'NOT_RUN_ROOT_REQUIRED',
          elapsedMs: Date.now() - started,
          firstEvent,
          fixture: recovery.snapshot(),
        },
        null,
        2,
      ),
    );
  };
  try {
    await open(!(phase.endsWith('-copy') || phase.endsWith('-agent')));
    if (recoveryPhase) {
      await runRecovery();
      return;
    }
    if (phase === 'editor-scheme-write') {
      await scheme('markdown');
      await wait(`${surface}?.dataset.editorScheme==='markdown'`);
      const initial = readTarget();
      await capture('document-markdown.png');
      await evaluate(
        `(()=>{${body}.focus();const r=document.createRange();r.selectNodeContents(${body});r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);})()`,
      );
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.insertText', { text: '#' });
      await command('Input.insertText', { text: ' ' });
      await wait(`${body}.querySelector('h1')`);
      await command('Input.insertText', { text: '一、双方案验收' });
      await command('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await command('Input.insertText', {
        text:
          '合成验收正文：切换方案后，条款内容与已有格式应完整保留。\n' +
          Array.from(
            { length: 32 },
            (_, i) => `滚动样本${i + 1}：内部滚动不应让格式浮层脱离选区，也不应写入新修订。`,
          ).join('\n'),
      });
      await click(`${taskScope} [data-testid=save-body]:not(:disabled)`);
      const before = await waitSaved(initial.tasks[0].body_revision, [
        '一、双方案验收',
        '滚动样本32',
      ]);
      await scheme('word');
      await wait("document.querySelector('.simple-toolbar [aria-label=段落样式]')");
      await selectParagraph();
      await capture('selection-menu-wide.png');
      const menuTop = await evaluate(`${selectionMenu}.getBoundingClientRect().top`);
      await evaluate(`${body}.parentElement.scrollTop=12`);
      await wait(`Math.abs(${body}.parentElement.scrollTop-12)<1`);
      await wait(`Math.abs(${selectionMenu}.getBoundingClientRect().top-${menuTop})>4`);
      await capture('selection-menu-scrolled.png');
      await selectParagraph();
      const selected = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      if (JSON.stringify(before) !== JSON.stringify(selected))
        throw new Error('Showing selection menu changed saved body or receipt');
      await evaluate("document.querySelector('.selection-tools [aria-label=加粗]').focus()");
      await wait(`${selectionMenu} && getComputedStyle(${selectionMenu}).visibility==='visible'`);
      await click('.selection-tools [aria-label=加粗]');
      await wait(`${body}.querySelector('strong')`);
      await click('.simple-toolbar [aria-label=撤销]:not(:disabled)');
      await wait(`!${body}.querySelector('strong')`);
      await click('.simple-toolbar [aria-label=重做]:not(:disabled)');
      await wait(`${body}.querySelector('strong')`);
      await evaluate(
        `(()=>{const p=${body}.querySelector('p:last-child');${body}.focus();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`,
      );
      // 等待原生选区观察器接收光标，再操作表格，避免同一脚本帧沿用旧选区。
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await evaluate(
        "(()=>{const s=document.querySelector('.simple-toolbar [aria-label=表格操作]');s.value='insert';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
      );
      await wait(`${body}.querySelectorAll('td').length===4`);
      await wait(`${body}.querySelector('strong')?.textContent==='乙方应于验收后支付剩余款项。'`);
      await click(`${taskScope} [data-testid=save-body]:not(:disabled)`);
      const saved = await waitSaved(before.tasks[0].body_revision, [
        '一、双方案验收',
        '滚动样本32',
        '<table',
      ]);
      const html = await evaluate(`${body}.innerHTML`);
      await capture('document-word.png');
      await scheme('markdown');
      if (
        await evaluate(
          `${body}.innerHTML!==${JSON.stringify(html)} || document.querySelector('.markdown-format-menu').open`,
        )
      )
        throw new Error('Scheme switch changed content or opened Markdown toolbar');
      await capture('document-markdown-formatted.png');
      await scheme('word');
      const after = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      if (JSON.stringify(saved) !== JSON.stringify(after) || !before.ok || !saved.ok)
        throw new Error('Scheme switch changed durable body');
      window.setContentSize(900, 760);
      await command('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 760,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await selectParagraph();
      await capture('document-word-narrow.png');
      const afterSelection = tasks.execute({
        protocol_version: 1,
        operation: 'read',
        task_id: task.id,
      });
      if (JSON.stringify(saved) !== JSON.stringify(afterSelection))
        throw new Error('Narrow selection menu changed saved body or receipt');
      writeFileSync(
        join(root, 'editor-scheme-write.json'),
        JSON.stringify({
          status: 'PASS_REAL',
          taskId: task.id,
          revision: saved.tasks[0].body_revision,
          markdownShortcut: true,
          undoRedo: true,
          schemePreservesBody: true,
          selectionMenu: {
            wide: true,
            narrow: true,
            innerScroll: true,
            formatting: true,
            noSaveSideEffect: true,
          },
          modelCalls: runs().length,
        }),
      );
    } else {
      await wait(`${surface}?.dataset.editorScheme==='word'`);
      await wait(
        `${body}.querySelector('h1')?.textContent==='一、双方案验收' && ${body}.querySelector('strong') && ${body}.querySelectorAll('td').length===4`,
      );
      await capture('document-word-reopened.png');
      const result = tasks.execute({ protocol_version: 1, operation: 'read', task_id: task.id });
      if (!result.ok) throw new Error('Cannot read reopened body');
      writeFileSync(
        join(root, 'editor-scheme-read.json'),
        JSON.stringify({
          status: 'PASS_REAL',
          taskId: task.id,
          revision: result.tasks[0].body_revision,
          persistedScheme: 'word',
          modelCalls: runs().length,
        }),
      );
    }
    if (runs().length) throw new Error('Unexpected model dispatch');
  } catch (error) {
    if (recoveryPhase) await capture(`${phase}-failure.png`).catch(() => {});
    throw error;
  } finally {
    recovery?.releaseHeld();
    wc.debugger.detach();
    if (!recoveryPhase) window.destroy();
  }
}
