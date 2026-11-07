import type { BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createModels, getCurrentTools } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AgentRuntimePort } from '@caselite/application';
import type { AgentModel, AgentResponse, AgentRun, MaterialResponse } from '@caselite/contracts';
import { createPiRuntime } from './adapters/pi-runtime';
import { syntheticAgentStream } from './agent-demo';
import {
  createRealDemoBudget,
  realDemoMarker,
  realDemoPdfHash,
  realDemoPrompts,
  selectedCredentialReady,
  type inspectZeroDispatchResume,
} from './agent-real-policy';

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export function createRealDemoRuntime(options: {
  directory: string;
  budgetDirectory?: string;
  resumeAudit?: ReturnType<typeof inspectZeroDispatchResume>;
  model: AgentModel;
  dry: boolean;
  runs(): AgentRun[];
  verifySource(run: AgentRun): boolean;
}): AgentRuntimePort {
  let budget: ReturnType<typeof createRealDemoBudget> | undefined;
  const models = createModels();
  models.setProvider(openaiProvider());
  models.setProvider(deepseekProvider());
  let phase = 0;
  let current: AgentRun | undefined;
  let dispatchIndex = 0;
  const stream: StreamFn = (model, context, streamOptions) => {
    const run = current;
    const json = JSON.stringify(context);
    if (
      !run ||
      model.id !== options.model ||
      context.messages.length !== 2 ||
      context.messages[0].role !== 'system' ||
      context.messages[1].role !== 'user' ||
      getCurrentTools(context.messages).length ||
      streamOptions?.maxTokens !== 2048 ||
      streamOptions.maxRetries !== 0
    )
      throw new Error('Unexpected dispatch context');
    if (
      phase === 1 &&
      (run.attachments?.length ||
        run.context_id ||
        run.scope !== 'home' ||
        json.includes(realDemoMarker))
    )
      throw new Error('Text run contains materials');
    if (
      phase === 2 &&
      (!options.verifySource(run) ||
        !json.includes(realDemoMarker) ||
        !json.includes('物理页 1') ||
        !json.includes(realDemoPrompts[1]))
    )
      throw new Error('PDF dispatch source mismatch');
    // 只保存本轮合成上下文；绝不序列化含apiKey的options、HTTP头或错误原文。
    writeFileSync(
      join(options.directory, `context-${phase}.json`),
      JSON.stringify(
        { context, sha256: hash(json), runId: run.id, attachments: run.attachments ?? [] },
        null,
        2,
      ),
    );
    // 凭据或UI预检失败不消费恢复标记；在完整输入校验后、首次派发前排他落盘。
    budget ??= createRealDemoBudget(
      options.budgetDirectory ?? options.directory,
      options.resumeAudit ? { audit: options.resumeAudit } : undefined,
    );
    dispatchIndex = budget.reserve(run.id, model.id, run.prompt);
    if (options.dry) return syntheticAgentStream(model, context, streamOptions);
    return models.streamSimple(model, context, {
      ...streamOptions,
      onPayload(payload) {
        const text = JSON.stringify(payload);
        if (
          !text.includes(realDemoPrompts[phase - 1]) ||
          (phase === 2 && !text.includes(realDemoMarker))
        )
          throw new Error('Provider payload mismatch');
        writeFileSync(
          join(options.directory, `provider-payload-${phase}.json`),
          JSON.stringify({ payload, sha256: hash(text), runId: run.id }, null, 2),
        );
      },
      onResponse(response) {
        // 只记录状态码，不保存可能含账户信息的headers或response对象。
        writeFileSync(
          join(options.directory, `http-${phase}.json`),
          JSON.stringify({ status: response.status }),
        );
      },
    });
  };
  const runtime = createPiRuntime(stream);
  return {
    start(input) {
      const expected = realDemoPrompts[phase];
      const candidates = options.runs().filter((run) => run.status === 'running');
      if (
        !expected ||
        input.model !== options.model ||
        input.images?.length ||
        candidates.length !== 1 ||
        candidates[0].prompt !== expected ||
        !input.prompt.includes(expected)
      )
        throw new Error('Outside authorized run');
      current = candidates[0];
      phase++;
      const index = phase;
      const started = Date.now();
      return runtime.start({
        ...input,
        onEnd(result) {
          if (dispatchIndex === index)
            budget!.settle(index, {
              ...result,
              elapsedMs: Date.now() - started,
              runId: current!.id,
              cost: 'unknown; provider billing not queried',
            });
          input.onEnd(result);
        },
      });
    },
  };
}

export async function runRealAgentDemo(
  create: () => Promise<BrowserWindow>,
  directory: string,
  dry: boolean,
  fixtureDirectory = directory,
) {
  const file = join(fixtureDirectory, 'caselite-agent-mock.pdf');
  if (hash(readFileSync(file)) !== realDemoPdfHash)
    throw new Error('Synthetic fixture hash mismatch');
  const window = await create();
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  const stage = (name: string) =>
    writeFileSync(
      join(directory, 'stage.json'),
      JSON.stringify({ stage: name, time: new Date().toISOString() }),
    );
  async function wait(predicate: string, attempts = 350) {
    for (let i = 0; i < attempts; i++) {
      if (await evaluate(predicate)) return;
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error('UI validation timed out');
  }
  async function read(): Promise<Extract<AgentResponse, { ok: true }>> {
    const response = (await evaluate(
      "window.caselite.agent({protocol_version:1,operation:'read',scope:'home'})",
    )) as AgentResponse;
    if (!response.ok) throw new Error('Run query unavailable');
    return response;
  }
  async function capture(name: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const shot = await Promise.race([
        window.webContents.debugger.sendCommand('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Screenshot timeout')), 6000);
        }),
      ]);
      writeFileSync(join(directory, `${name}.png`), Buffer.from(shot.data, 'base64'));
    } catch {
      // 截图只是展示证据，失败不重发已登记的收费Run；可之后只读补取原结果。
      writeFileSync(
        join(directory, `screenshot-error-${name}.json`),
        JSON.stringify({
          status: 'NOT_RUN',
          recovery: 'Read existing Run; never resend for a screenshot',
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const results: AgentRun[] = [];
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  try {
    stage('credential-preflight');
    await wait("Boolean(document.querySelector('[data-testid=agent-input]'))");
    const initial = await read();
    writeFileSync(
      join(directory, 'preflight.json'),
      JSON.stringify(
        {
          model: initial.model,
          configured: initial.configured,
          credentialErrors: initial.credential_errors ?? {},
          runs: initial.runs.length,
          realByok: !dry,
        },
        null,
        2,
      ),
    );
    if (
      !selectedCredentialReady(initial, dry ? initial.model : 'deepseek-flash') ||
      initial.runs.length
    )
      throw new Error('Credentials unavailable or nonempty test workspace; no dispatch');
    for (let index = 0; index < 2; index++) {
      if (index === 1) {
        stage('drop-pdf');
        await evaluate(
          "(()=>{const e=document.createElement('input');e.type='file';e.id='real-demo-file';e.hidden=true;document.body.append(e);})()",
        );
        const doc = await window.webContents.debugger.sendCommand('DOM.getDocument');
        const node = await window.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: '#real-demo-file',
        });
        await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
          nodeId: node.nodeId,
          files: [file],
        });
        await evaluate(
          "(()=>{const data=new DataTransfer();data.items.add(document.querySelector('#real-demo-file').files[0]);document.querySelector('.material-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()",
        );
        await wait(
          "Boolean(document.querySelector('.material-staged')) || Boolean(document.querySelector('[aria-label=待发送附件]'))",
        );
        // 等待真实PDF.js提取完成后再发送；仍由产品发送动作冻结单份附件完整页。
        for (let i = 0; i < 250; i++) {
          const response = (await evaluate(
            "window.caselite.material({protocol_version:1,operation:'list',scope:'home'})",
          )) as MaterialResponse;
          if (
            response.ok &&
            response.materials.length === 1 &&
            response.materials[0].status === 'ready'
          ) {
            const material = response.materials[0];
            if (
              material.sha256 !== realDemoPdfHash ||
              material.pages.length !== 1 ||
              !material.pages[0].text.includes(realDemoMarker)
            )
              throw new Error('PDF text/source mismatch');
            writeFileSync(join(directory, 'pdf-source.json'), JSON.stringify(material, null, 2));
            break;
          }
          if (i === 249) throw new Error('PDF extraction not ready');
          await new Promise((done) => setTimeout(done, 200));
        }
      }
      stage(index ? 'pdf-type' : 'text-type');
      await evaluate(
        `(()=>{const e=document.querySelector('[data-testid=agent-input]');e.focus();document.execCommand('insertText',false,${JSON.stringify(realDemoPrompts[index])});})()`,
      );
      await wait(
        `document.querySelector('[data-testid=agent-input]')?.value===${JSON.stringify(realDemoPrompts[index])} && document.querySelector('.assistant-submit')?.disabled===false`,
      );
      if ((await read()).runs.length !== index)
        throw new Error('Typing or import dispatched unexpectedly');
      await capture(index ? 'pdf-before-send' : 'text-before-send');
      stage(index ? 'pdf-send' : 'text-send');
      const sendState = await evaluate(
        "(()=>{const button=document.querySelector('.assistant-submit'); const state={disabled:button.disabled,label:button.textContent.trim(),input:document.querySelector('[data-testid=agent-input]').value}; if(state.disabled || state.label!=='发送') throw new Error('Send is not ready'); button.click();return state;})()",
      );
      writeFileSync(
        join(directory, `ui-send-${index + 1}.json`),
        JSON.stringify(sendState, null, 2),
      );
      let final: AgentRun | undefined;
      for (let i = 0; i < 350; i++) {
        const state = await read();
        const run = state.runs.find((run) => run.prompt === realDemoPrompts[index]);
        if (run && run.status !== 'running') {
          final = run;
          break;
        }
        await new Promise((done) => setTimeout(done, 200));
      }
      if (!final) throw new Error('Unknown receipt; stop without retry');
      writeFileSync(join(directory, `result-${index + 1}.json`), JSON.stringify(final, null, 2));
      await wait(
        `document.querySelectorAll('.assistant-message--assistant').length===${index + 1} && Boolean(document.querySelector('.assistant-run-status.succeeded')) && ![...document.querySelectorAll('.material-controls button')].some(button=>button.disabled)`,
      );
      await capture(index ? 'pdf-real-output' : 'text-real-output');
      if (final.status !== 'succeeded' || !final.output)
        throw new Error('Failed or incomplete model run; stop without retry');
      if (!dry && index && !final.output.includes(realDemoMarker))
        throw new Error('Model omitted verification marker; no retry');
      results.push(final);
    }
    stage('completed');
    writeFileSync(
      join(directory, 'validation-result.json'),
      JSON.stringify(
        {
          passed: true,
          classification: dry ? 'MOCK_ONLY' : 'PASS_REAL',
          results,
          physicalFinderDrop: 'NOT_RUN; CDP file bytes and synthetic drop through product handler',
          stop: 'NOT_RUN on paid provider; prior synthetic evidence only',
          cost: 'unknown; usage is provider-reported',
        },
        null,
        2,
      ),
    );
  } catch {
    writeFileSync(
      join(directory, 'failure-ui.txt'),
      await evaluate('document.body.innerText').catch(() => 'Renderer unavailable'),
    );
    await capture('validation-failure').catch(() => {});
    writeFileSync(
      join(directory, 'validation-result.json'),
      JSON.stringify({ passed: false, results, classification: 'BLOCKED', automaticRetry: false }),
    );
    throw new Error(
      'Bounded UI validation stopped; reconcile local evidence before any further action',
    );
  } finally {
    window.webContents.debugger.detach();
  }
}
