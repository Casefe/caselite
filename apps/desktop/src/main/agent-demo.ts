import { BrowserWindow, clipboard, session } from 'electron';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createAgentCredentials } from './adapters/agent-credentials';

// 仅被已校验的临时agent演示入口注入；没有网络Provider，也不读取真实凭据。
export const syntheticAgentStream: StreamFn = (_model, _context, options) => {
  const stream = createAssistantMessageEventStream();
  const response: AssistantMessage = {
    role: 'assistant',
    api: _model.api,
    provider: _model.provider,
    model: _model.id,
    content: [{ type: 'text', text: '' }],
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const parts = [
    '## 合成演示 · MOCK_ONLY\n\n非真实模型，以下为固定 UI 测试内容，不是材料分析。\n\n',
    '### 待核对事项\n\n- **事实**：两份演示材料的交付日期不同。\n',
    '- **矛盾**：一份写10月10日，另一份写10月12日。\n',
    '- **缺件**：缺少签收凭证，需人工核对。\n\n',
    '> 内部沟通初稿：建议先补齐签收材料，再核对时间线。',
  ];
  if (JSON.stringify(_context.messages).includes('长文展示测试'))
    parts[4] = Array.from(
      { length: 24 },
      (_, i) =>
        `\n\n### 展示检查 ${i + 1}\n\n这段合成文字仅验证长文滚动、Markdown 标题和底部输入位置。请逐项核对原文、日期、付款记录和缺件；此演示不证明真实模型完成分析。`,
    ).join('');
  let index = 0;
  const timer = setInterval(() => {
    if (options?.signal?.aborted) {
      clearInterval(timer);
      stream.push({
        type: 'error',
        reason: 'aborted',
        error: { ...response, stopReason: 'aborted' },
      });
      return;
    }
    const delta = parts[index++];
    if (response.content[0].type === 'text') response.content[0].text += delta;
    stream.push({ type: 'text_delta', contentIndex: 0, delta, partial: structuredClone(response) });
    if (index === parts.length) {
      clearInterval(timer);
      stream.push({ type: 'done', reason: 'stop', message: response });
    }
  }, 250);
  return stream;
};

export async function runAgentDemo(createWindow: () => Promise<BrowserWindow>, root: string) {
  const vault = await createAgentCredentials(root);
  const syntheticKey = 'synthetic-only-credential-roundtrip';
  await vault.set(syntheticKey);
  const reopenedVault = await createAgentCredentials(root);
  if (reopenedVault.get() !== syntheticKey)
    throw new Error('Credential decrypt after reopening failed');
  if (
    vault.get() !== syntheticKey ||
    readFileSync(join(root, 'openai-credential.enc')).includes(syntheticKey)
  )
    throw new Error('Credential encryption roundtrip failed');
  await vault.set('synthetic-deepseek-roundtrip', 'deepseek');
  await vault.setDefaultModel('deepseek-v4-pro');
  const twoProviders = await createAgentCredentials(root);
  if (
    twoProviders.get() !== syntheticKey ||
    twoProviders.get('deepseek') !== 'synthetic-deepseek-roundtrip' ||
    twoProviders.getDefaultModel() !== 'deepseek-v4-pro'
  )
    throw new Error('Independent provider roundtrip failed');
  if (readFileSync(join(root, 'deepseek-credential.enc')).includes('synthetic-deepseek-roundtrip'))
    throw new Error('DeepSeek key encryption failed');
  writeFileSync(join(root, 'deepseek-credential.enc'), Buffer.from('synthetic-corrupt-ciphertext'));
  const corruptProvider = await createAgentCredentials(root);
  let corruptRejected = false;
  try {
    corruptProvider.get('deepseek');
  } catch {
    corruptRejected = true;
  }
  if (!corruptRejected || corruptProvider.get() !== syntheticKey)
    throw new Error('Corrupt provider isolation failed');
  writeFileSync(
    join(root, 'agent-model.json'),
    JSON.stringify({ version: 2, model: 'gpt-4.1-mini' }),
  );
  let settingsRejected = false;
  try {
    corruptProvider.getDefaultModel();
  } catch {
    settingsRejected = true;
  }
  if (!settingsRejected) throw new Error('Unsupported settings version accepted');
  await vault.setDefaultModel('deepseek-v4-pro');
  vault.clear('deepseek');
  if (
    vault.get() !== syntheticKey ||
    vault.get('deepseek') ||
    vault.getDefaultModel() !== 'deepseek-v4-pro'
  )
    throw new Error('Deleting DeepSeek changed OpenAI or default model');
  vault.clear();
  if (vault.get() !== undefined || existsSync(join(root, 'openai-credential.enc')))
    throw new Error('Credential removal failed');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow();
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    writeFileSync(join(root, 'agent-failure.txt'), await evaluate('document.body.innerText'));
    throw new Error('Agent demonstration failed: ' + predicate);
  };
  const clickText = (text: string) =>
    evaluate(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`,
    );
  const type = (selector: string, text: string) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();document.execCommand('insertText',false,${JSON.stringify(text)});})()`,
    );
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait("document.querySelector('[data-testid=agent-input]')");
    await type('[data-testid=agent-input]', '演示：梳理两份材料中的事实、矛盾与缺件。');
    const before = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
    );
    if (!before.ok || before.runs.length) throw new Error('Typing dispatched a run');
    await clickText('发送');
    await wait(
      "document.querySelector('.assistant-message')?.textContent.includes('演示') && document.body.innerText.includes('停止生成')",
    );
    await clickText('停止生成');
    await wait("document.body.innerText.includes('已停止本地生成')");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const stopped = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
    );
    if (!stopped.ok || stopped.runs[0].status !== 'cancelled') throw new Error('Stop failed');
    await type('[data-testid=agent-input]', '重新分析：梳理事实、矛盾与缺件。');
    await clickText('发送');
    await wait("document.body.innerText.includes('生成完成，内容待人工核对。')");
    window.focus();
    await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.assistant-message-footer button')].at(-1).click()",
      true,
    );
    await wait(
      "[...document.querySelectorAll('.assistant-message-footer button')].at(-1)?.textContent.includes('已复制')",
    );
    const copied = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
    );
    const actualClipboard = await clipboard.readText();
    const expectedClipboard = copied.runs.at(-1).output;
    writeFileSync(
      join(root, 'clipboard-check.json'),
      JSON.stringify(
        {
          actualLength: actualClipboard.length,
          expectedLength: expectedClipboard.length,
          actualSha256: createHash('sha256').update(actualClipboard).digest('hex'),
          expectedSha256: createHash('sha256').update(expectedClipboard).digest('hex'),
          lineEndingsMatch:
            actualClipboard.replace(/\r\n/g, '\n') === expectedClipboard.replace(/\r\n/g, '\n'),
        },
        null,
        2,
      ),
    );
    if (actualClipboard !== expectedClipboard)
      throw new Error('Native clipboard did not receive the original Markdown');
    await wait("document.querySelector('.home-history-pin')");
    await evaluate("document.querySelector('.home-history-pin').click()");
    await wait("document.querySelector('.home-history-pin[aria-pressed=true]')");
    const screenshot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'agent-home.png'), Buffer.from(screenshot.data, 'base64'));
    await type('[data-testid=agent-input]', '长文展示测试：仅检查滚动和输入位置。');
    await clickText('发送');
    await wait(
      "document.querySelector('.assistant-markdown') && document.body.innerText.includes('展示检查 24') && document.querySelector('.assistant-run-status.succeeded')",
    );
    const layout = await evaluate(`(()=>{
      const input=document.querySelector('.assistant-compose').getBoundingClientRect();
      const viewport=document.querySelector('.assistant-viewport');
      return { composerBottom:input.bottom, composerTop:input.top, height:innerHeight,
        scrollHeight:viewport.scrollHeight, clientHeight:viewport.clientHeight,
        conversation:document.querySelector('.agent-home').classList.contains('home-conversation') };
    })()`);
    if (
      !layout.conversation ||
      layout.composerBottom > layout.height ||
      layout.composerTop < 0 ||
      layout.scrollHeight <= layout.clientHeight
    )
      throw new Error('Conversation layout did not retain the composer and scrollable output');
    const long = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(join(root, 'agent-long-output.png'), Buffer.from(long.data, 'base64'));
    writeFileSync(join(root, 'agent-layout.json'), JSON.stringify(layout, null, 2));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [], {
        env: { ...process.env, CASELITE_TASK_DEMO: 'agent-read', CASELITE_TASK_DEMO_DIR: root },
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Second instance did not exit'));
      }, 10000);
      child.once('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error('Second instance was not refused'));
      });
    });
    await evaluate("document.querySelector('[data-nav=tasks]').click()");
    await wait("document.querySelector('[data-testid=new-task]')");
    await evaluate("document.querySelector('[data-testid=new-task]').click()");
    await wait("document.querySelector('[data-testid=task-title]')");
    await evaluate(
      "(()=>{const e=document.querySelector('[data-testid=task-title]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'AI 接入合成演示');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await evaluate("document.querySelector('[data-testid=create-task]').click()");
    await wait('document.querySelector(\'[aria-label="属性与 AI 侧边栏"]\')');
    await wait("document.querySelector('[data-testid=assistant-input]')");
    await type('[data-testid=assistant-input]', '保留本任务的未发送草稿');
    await evaluate("document.querySelector('.task-inspector details > summary').click()");
    await evaluate("document.querySelector('.task-inspector details > summary').click()");
    await wait(
      "document.querySelector('[data-testid=assistant-input]')?.value.includes('保留本任务')",
    );
    if (
      await evaluate(
        "document.querySelector('.assistant-panel--compact').innerText.includes('【合成演示')",
      )
    )
      throw new Error('Home output leaked into task');
    await clickText('发送');
    await wait(
      "document.querySelector('.assistant-panel--compact').innerText.includes('生成完成，内容待人工核对。')",
    );
    const side = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'agent-sidebar.png'), Buffer.from(side.data, 'base64'));
    await evaluate("document.querySelector('.model-settings-link').click()");
    await wait(
      "document.querySelector('[data-provider=deepseek]') && !document.querySelector('[data-provider=deepseek]').disabled",
    );
    await evaluate("document.querySelector('[data-provider=deepseek]').click()");
    await evaluate(
      "(()=>{const e=document.querySelector('[aria-label=\"DeepSeek API Key\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'sk-synthetic-agent-deepseek');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await clickText('保存 Key');
    await wait("document.querySelector('.settings-notice')?.textContent.includes('已加密保存')");
    await evaluate(
      "(()=>{const e=document.querySelector('[aria-label=模型选择]');e.value='deepseek-v4-pro';e.dispatchEvent(new Event('change',{bubbles:true}));})()",
    );
    await clickText('设为默认模型');
    await wait(
      "document.querySelector('.settings-notice')?.textContent.includes('deepseek-v4-pro')",
    );
    const modelSettings = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'deepseek-settings.png'), Buffer.from(modelSettings.data, 'base64'));
    await evaluate("document.querySelector('.settings-back').click()");
    await wait("document.querySelector('.task-inspector')");
    await wait("document.querySelector('[data-testid=assistant-input]')");
    await wait("document.querySelector('.assistant-panel')?.innerText.includes('发送')");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await type('[data-testid=assistant-input]', 'DeepSeek 重新分析本轮要求。');
    await clickText('发送');
    await wait(
      "document.querySelector('.ai-inspector .assistant-run-status.succeeded')?.textContent.includes('deepseek-v4-pro')",
    );
    const dsResult = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:document.querySelector('.task-detail').dataset.activeTask})",
    );
    if (
      !dsResult.ok ||
      dsResult.runs.at(-1).model !== 'deepseek-v4-pro' ||
      dsResult.runs.at(-1).provider !== 'deepseek' ||
      dsResult.runs.at(-1).status !== 'succeeded' ||
      !dsResult.providers.openai
    )
      throw new Error('DeepSeek selected run failed');
    const dsImage = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'deepseek-sidebar.png'), Buffer.from(dsImage.data, 'base64'));
    await evaluate("document.querySelector('[data-nav=home]').click()");
    await wait(
      "document.querySelector('.agent-home [aria-label=选择大模型]')?.value==='deepseek-v4-pro'",
    );
    await type('[data-testid=agent-input]', 'DeepSeek 合成演示：梳理事实、矛盾与缺件。');
    await wait(
      "document.querySelector('.composer-send-note')?.textContent.includes('deepseek-v4-pro')",
    );
    const previewImage = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'deepseek-preview.png'), Buffer.from(previewImage.data, 'base64'));
    await clickText('发送');
    await wait(
      "document.querySelector('.agent-home .assistant-run-status.succeeded')?.textContent.includes('deepseek-v4-pro')",
    );
    const homeImage = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'deepseek-home.png'), Buffer.from(homeImage.data, 'base64'));
    writeFileSync(
      join(root, 'agent-result.json'),
      JSON.stringify(
        {
          passed: true,
          actualSdk: 'Pi Core 1.5.0',
          actualUi: 'assistant-ui 0.15.32',
          provider: 'MOCK_ONLY',
          checks: [
            'assistant-ui composer input',
            'preview does not dispatch',
            'actual SDK streaming',
            'cancel',
            'second explicit run',
            'safe Markdown and native clipboard original output',
            'long output scrolls while composer remains visible',
            'home/task isolation',
            'draft survives property tab',
            'sidebar streaming',
            'DeepSeek key and default model through settings UI',
            'DeepSeek selected run through Pi Core (synthetic stream)',
            'OpenAI retained after DeepSeek selection',
          ],
          credentialEncryption:
            'PASS_REAL safeStorage synthetic key roundtrip, ciphertext and removal',
          realByok: 'NOT_RUN',
          persistedHistory: 'PASS_REAL SQLite with synthetic provider data',
        },
        null,
        2,
      ),
    );
  } finally {
    window.webContents.debugger.detach();
    window.destroy();
  }
}

export async function runAgentHistoryProbe(
  createWindow: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
) {
  const window = await createWindow();
  const evaluate = (s: string) => window.webContents.executeJavaScript(s);
  const wait = async (predicate: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${predicate})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('History recovery UI failed');
  };
  try {
    await wait("document.querySelector('[data-testid=agent-input]')");
    const profile = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'profile'})",
    );
    if (phase === 'agent-credential-read') {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^https?:/i.test(details.url) }),
      );
      const unavailable = Boolean(
        profile.credential_errors?.[profile.model.startsWith('deepseek') ? 'deepseek' : 'openai'],
      );
      if (unavailable) {
        await wait("document.body.innerText.includes('系统安全凭据暂不可读')");
        const denied = await evaluate(
          `window.caselite.agent({protocol_version:1,operation:'start',scope:'home',run_id:${JSON.stringify(randomUUID())},prompt:'不应派发的合成测试',confirmed:true,model:${JSON.stringify(profile.model)}})`,
        );
        if (denied.ok || denied.code !== 'CREDENTIAL_UNAVAILABLE')
          throw new Error('Unavailable credential was not rejected');
      }
      const capture = async (name: string) => {
        const image = await window.webContents.capturePage();
        writeFileSync(join(root, name), image.toPNG());
      };
      await capture('credential-home.png');
      await evaluate("document.querySelector('[data-nav=settings]').click()");
      await evaluate(
        "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='模型')?.click()",
      );
      if (unavailable)
        await wait(
          "document.body.innerText.includes('凭据不可读') && document.body.innerText.includes('不表示密钥已删除')",
        );
      await capture('credential-settings.png');
      await evaluate("document.querySelector('[data-nav=tasks]').click()");
      await wait("document.querySelector('[data-testid=new-task]')");
      await evaluate("document.querySelector('[data-testid=new-task]').click()");
      await wait("document.querySelector('[data-testid=task-title]')");
      await evaluate(
        `(()=>{const e=document.querySelector('[data-testid=task-title]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'系统凭据等待时的人工任务');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await evaluate("document.querySelector('[data-testid=create-task]').click()");
      await wait("document.querySelector('[data-testid=body-editor]')");
      await evaluate(
        "document.querySelector('[data-testid=body-editor]').focus();document.execCommand('insertText',false,'合成人工正文，安全存储失败不阻止保存。')",
      );
      await wait("document.querySelector('[data-testid=save-body]')?.disabled===false");
      await evaluate("document.querySelector('[data-testid=save-body]').click()");
      await wait(
        "document.querySelector('[data-testid=save-body]')?.disabled===true && document.querySelector('[data-testid=save-status]')?.textContent==='已保存到此设备' && document.querySelector('[data-testid=revision]')?.textContent==='1'",
      );
      await capture('credential-manual-task.png');
      if (existsSync(join(root, 'unexpected-runtime.txt')))
        throw new Error('Credential probe dispatched a Provider');
      writeFileSync(
        join(root, 'credential-recovery-result.json'),
        JSON.stringify(
          {
            homepage: 'PASS_REAL',
            manualTaskAndBodySave: 'PASS_REAL',
            providerDispatch: 0,
            credentialRecovery: unavailable
              ? 'FAIL'
              : profile.configured
                ? 'PASS_REAL synthetic Key'
                : 'NOT_RUN no Key',
            profile,
            realByok: 'NOT_RUN',
          },
          null,
          2,
        ),
      );
      return;
    }
    if (phase === 'agent-crash') {
      const profile = await evaluate(
          "window.caselite.agent({protocol_version:1,operation:'profile'})",
        ),
        id = randomUUID();
      const r = await evaluate(
        `window.caselite.agent({protocol_version:1,operation:'start',scope:'home',run_id:${JSON.stringify(id)},prompt:'中断恢复合成样本',confirmed:true,model:${JSON.stringify(profile.model)}})`,
      );
      if (!r.ok || r.runs.at(-1).status !== 'running') throw new Error('Crash Run did not start');
      await wait(
        "document.querySelector('.assistant-run-status.running') && document.body.innerText.includes('合成演示')",
      );
      await new Promise((r) => setTimeout(r, 350));
      writeFileSync(join(root, 'crashed-run.json'), JSON.stringify({ id, model: profile.model }));
      process.kill(process.pid, 'SIGKILL');
    } else {
      await wait("document.body.innerText.includes('上次运行被中断')");
      await wait("document.querySelector('.home-history-pin[aria-pressed=true]')");
      const history = await evaluate(
        "window.caselite.agent({protocol_version:1,operation:'history'})",
      );
      if (!history.ok || history.runs.filter((r: { pinned?: boolean }) => r.pinned).length !== 1)
        throw new Error('Pinned history did not survive restart');
      await evaluate("document.querySelector('.home-history-open').click()");
      await wait("document.querySelector('.home-history-detail')?.textContent.includes('演示')");
      const result = await evaluate(
        "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
      );
      const crashed = JSON.parse(readFileSync(join(root, 'crashed-run.json'), 'utf8'));
      const run = result.runs.find((r: { id: string }) => r.id === crashed.id);
      if (
        !result.ok ||
        !run ||
        run.status !== 'interrupted' ||
        run.usage !== null ||
        result.runs.some((r: { status: string }) => r.status === 'running') ||
        !result.runs.some((r: { status: string }) => r.status === 'succeeded')
      )
        throw new Error('Restarted Run statuses incorrect');
      if (existsSync(join(root, 'unexpected-runtime.txt')))
        throw new Error('Restart dispatched a Provider');
      if (phase === 'agent-read' && (!profile.configured || profile.credential_errors))
        throw new Error(
          'System credential recovery unavailable; history recovered, Key not recovered',
        );
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const screenshot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      writeFileSync(join(root, 'agent-recovered.png'), Buffer.from(screenshot.data, 'base64'));
      window.webContents.debugger.detach();
      writeFileSync(
        join(root, 'history-result.json'),
        JSON.stringify(
          {
            passed: true,
            provider: 'MOCK_ONLY',
            sqliteRecovery: 'PASS_REAL',
            interruptedRunId: run.id,
            completedRuns: result.runs.filter((r: { status: string }) => r.status === 'succeeded')
              .length,
            runtimeAfterRestart: 0,
            realByok: 'NOT_RUN',
          },
          null,
          2,
        ),
      );
    }
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
