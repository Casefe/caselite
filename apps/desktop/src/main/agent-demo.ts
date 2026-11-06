import { BrowserWindow, session } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
    '【合成演示 · 非真实模型】\n',
    '事实：两份材料的交付日期不同。\n',
    '矛盾：一份写10月10日，另一份写10月12日。\n',
    '缺件：缺少签收凭证，需人工核对。\n',
    '内部沟通初稿：建议先补齐签收材料，再核对时间线。',
  ];
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
    await clickText('预览发送');
    await wait(
      "document.querySelector('[aria-label=发送预览]') && document.body.innerText.includes('确认发送')",
    );
    const before = await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
    );
    if (!before.ok || before.runs.length) throw new Error('Preview dispatched a run');
    await clickText('确认发送');
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
    await clickText('预览发送');
    await clickText('确认发送');
    await wait("document.body.innerText.includes('生成完成，内容待人工核对。')");
    const screenshot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'agent-home.png'), Buffer.from(screenshot.data, 'base64'));
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
    await clickText('创建本地任务');
    await wait("document.querySelector('[data-testid=task-title]')");
    await evaluate(
      "(()=>{const e=document.querySelector('[data-testid=task-title]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'AI 接入合成演示');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
    );
    await evaluate("document.querySelector('[data-testid=create-task]').click()");
    await wait('document.querySelector(\'[aria-label="属性与 AI 侧边栏"]\')');
    await clickText('AI 助手');
    await wait("document.querySelector('[data-testid=assistant-input]')");
    await type('[data-testid=assistant-input]', '保留本任务的未发送草稿');
    await clickText('属性');
    await clickText('AI 助手');
    await wait(
      "document.querySelector('[data-testid=assistant-input]')?.value.includes('保留本任务')",
    );
    if (await evaluate("document.querySelector('.ai-inspector').innerText.includes('【合成演示')"))
      throw new Error('Home output leaked into task');
    await clickText('预览发送');
    await clickText('确认发送');
    await wait(
      "document.querySelector('.ai-inspector').innerText.includes('生成完成，内容待人工核对。')",
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
    await clickText('AI 助手');
    await wait("document.querySelector('[data-testid=assistant-input]')");
    await wait("document.querySelector('.assistant-panel')?.innerText.includes('预览发送')");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await clickText('预览发送');
    await wait(
      "document.querySelector('[aria-label=发送预览]')?.textContent.includes('deepseek-v4-pro')",
    );
    await clickText('确认发送');
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
      "document.querySelector('.agent-home .assistant-model')?.textContent.includes('deepseek-v4-pro')",
    );
    await type('[data-testid=agent-input]', 'DeepSeek 合成演示：梳理事实、矛盾与缺件。');
    await clickText('预览发送');
    await wait(
      "document.querySelector('[aria-label=发送预览]')?.textContent.includes('deepseek-v4-pro')",
    );
    const previewImage = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(join(root, 'deepseek-preview.png'), Buffer.from(previewImage.data, 'base64'));
    await clickText('确认发送');
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
            'Tiptap input',
            'preview does not dispatch',
            'actual SDK streaming',
            'cancel',
            'second explicit run',
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
