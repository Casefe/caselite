import { app, session } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentProviderFor, agentProviderSchema, type AgentProvider } from '@caselite/contracts';
import type { AgentCredentialPort } from '@caselite/application';
import { createAgentCredentials } from './adapters/agent-credentials';

export const credentialFingerprints = (credentialRoot: string) =>
  Object.fromEntries(
    [
      ...agentProviderSchema.options.map((provider) => `${provider}-credential.enc`),
      'agent-model.json',
    ].map((name) => {
      const file = join(credentialRoot, name);
      return [
        name,
        existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null,
      ];
    }),
  );

export function credentialStatus(vault: AgentCredentialPort) {
  const model = vault.getDefaultModel();
  const credentialErrors: Partial<Record<AgentProvider, 'UNAVAILABLE'>> = {};
  const providers: Record<AgentProvider, boolean> = {
    openai: false,
    deepseek: false,
    glm: false,
    kimi: false,
    siliconflow: false,
  };
  for (const provider of agentProviderSchema.options) {
    try {
      providers[provider] = Boolean(vault.get(provider));
    } catch {
      credentialErrors[provider] = 'UNAVAILABLE';
    }
  }
  return { model, configured: providers[agentProviderFor(model)], providers, credentialErrors };
}

export function readOnlyDemoCredentials(port: AgentCredentialPort): AgentCredentialPort {
  const reject = () => {
    throw new Error('Read-only validation credentials');
  };
  return {
    get: (provider) => port.get(provider),
    ...(port.refresh ? { refresh: () => port.refresh!() } : {}),
    getDefaultModel: () => port.getDefaultModel(),
    set: reject,
    clear: reject,
    setDefaultModel: reject,
  };
}

// 仅由Main已校验的隔离诊断入口调用；读取仍归原凭据Owner，不返回Key或密文。
export async function runCredentialPreflight(credentialRoot: string, directory: string) {
  const started = Date.now();
  let httpAttempts = 0;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const http = /^https?:/i.test(details.url);
    if (http) httpAttempts++;
    callback({ cancel: http });
  });
  const before = credentialFingerprints(credentialRoot);
  const stages: { stage: string; state: string; failure?: string; elapsedMs: number }[] = [];
  writeFileSync(
    join(directory, 'credential-origin.json'),
    JSON.stringify(
      {
        ready: app.isReady(),
        appName: app.getName(),
        packaged: app.isPackaged,
        executable: process.execPath,
        defaultUserData: credentialRoot,
        isolatedUserData: app.getPath('userData'),
        before,
      },
      null,
      2,
    ),
  );
  const vault = await createAgentCredentials(credentialRoot, (stage, state, failure) => {
    stages.push({ stage, state, ...(failure ? { failure } : {}), elapsedMs: Date.now() - started });
    writeFileSync(join(directory, 'credential-stages.json'), JSON.stringify(stages, null, 2));
  });
  const state = credentialStatus(vault);
  const after = credentialFingerprints(credentialRoot);
  const result = {
    ...state,
    unchanged: JSON.stringify(before) === JSON.stringify(after),
    after,
    elapsedMs: Date.now() - started,
    providerDispatches: 0,
    httpAttempts,
  };
  writeFileSync(join(directory, 'credential-result.json'), JSON.stringify(result, null, 2));
  return result;
}
