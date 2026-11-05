import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { agentModelSchema, type AgentModel, type AgentProvider } from '@caselite/contracts';
import type { AgentCredentialPort } from '@caselite/application';

export async function createAgentCredentials(root: string): Promise<AgentCredentialPort> {
  const files = {
    openai: join(root, 'openai-credential.enc'),
    deepseek: join(root, 'deepseek-credential.enc'),
  };
  const cached = new Map<AgentProvider, string>();
  const unavailable = new Set<AgentProvider>();
  const settingsFile = join(root, 'agent-model.json');
  const requireEncryption = async () => {
    if (process.platform !== 'darwin' || !(await safeStorage.isAsyncEncryptionAvailable()))
      throw new Error('System encryption unavailable');
  };
  for (const provider of ['openai', 'deepseek'] as const) {
    if (existsSync(files[provider])) {
      try {
        await requireEncryption();
        cached.set(
          provider,
          (await safeStorage.decryptStringAsync(readFileSync(files[provider]))).result,
        );
      } catch {
        unavailable.add(provider);
      }
    }
  }
  return {
    get(provider = 'openai') {
      if (unavailable.has(provider)) throw new Error('Credential unavailable');
      return cached.get(provider);
    },
    async set(key, provider = 'openai') {
      await requireEncryption();
      const bytes = await safeStorage.encryptStringAsync(key);
      const file = files[provider];
      writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      cached.set(provider, key);
      unavailable.delete(provider);
    },
    clear(provider = 'openai') {
      const file = files[provider];
      rmSync(file, { force: true });
      rmSync(`${file}.tmp`, { force: true });
      cached.delete(provider);
      unavailable.delete(provider);
    },
    getDefaultModel() {
      // 无配置时兼容旧版；损坏配置必须报错，不能默默切换到另一收费目标。
      if (!existsSync(settingsFile)) return 'gpt-4.1-mini';
      const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
      if (settings.version !== 1) throw new Error('Unsupported model settings');
      return agentModelSchema.parse(settings.model);
    },
    setDefaultModel(model: AgentModel) {
      const validated = agentModelSchema.parse(model);
      writeFileSync(`${settingsFile}.tmp`, JSON.stringify({ version: 1, model: validated }), {
        mode: 0o600,
      });
      renameSync(`${settingsFile}.tmp`, settingsFile);
    },
  };
}
