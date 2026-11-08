import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentModelSchema,
  agentProviderSchema,
  type AgentModel,
  type AgentProvider,
} from '@caselite/contracts';
import type { AgentCredentialPort } from '@caselite/application';

const STORAGE_TIMEOUT_MS = 3_000;
// macOS 冷初始化实测超过 12 秒；只给后台可用性初始化留出上限，实际加解密仍限 3 秒。
const INITIALIZATION_TIMEOUT_MS = 30_000;
type CredentialStage = 'availability' | `${AgentProvider}-${'decrypt' | 'encrypt'}`;

export async function createAgentCredentials(
  root: string,
  onStage?: (
    stage: CredentialStage,
    state: 'started' | 'succeeded' | 'unavailable',
    failure?: 'TIMEOUT' | 'REJECTED' | 'UNAVAILABLE',
  ) => void,
  initialization?: { afterWindowReady: Promise<void>; onSettled(): void },
): Promise<AgentCredentialPort> {
  const bounded = async <T>(stage: CredentialStage, operation: () => Promise<T>): Promise<T> => {
    onStage?.(stage, 'started');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      // 系统调用不能取消；只接纳期限内的返回值，晚到结果不能写缓存或覆盖旧密文。
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              timedOut = true;
              reject(new Error('System credential timeout'));
            },
            stage === 'availability' ? INITIALIZATION_TIMEOUT_MS : STORAGE_TIMEOUT_MS,
          );
        }),
      ]);
      onStage?.(stage, 'succeeded');
      return result;
    } catch {
      onStage?.(stage, 'unavailable', timedOut ? 'TIMEOUT' : 'REJECTED');
      throw new Error('System credential unavailable');
    } finally {
      clearTimeout(timer);
    }
  };
  const credentialFile = (provider: AgentProvider) => join(root, `${provider}-credential.enc`);
  let cached = new Map<AgentProvider, string>();
  let unavailable = new Set<AgentProvider>();
  let generation = 0;
  let initialReadQueued = Boolean(initialization);
  const settingsFile = join(root, 'agent-model.json');
  const requireEncryption = async () => {
    if (
      process.platform !== 'darwin' ||
      !(await bounded('availability', () => safeStorage.isAsyncEncryptionAvailable()))
    ) {
      onStage?.('availability', 'unavailable', 'UNAVAILABLE');
      throw new Error('System encryption unavailable');
    }
  };
  const refresh = async () => {
    const revision = ++generation;
    const current = () => {
      if (revision !== generation) throw new Error('Credential operation superseded');
    };
    const nextCached = new Map<AgentProvider, string>();
    const nextUnavailable = new Set<AgentProvider>();
    const storedProviders = agentProviderSchema.options.filter((provider) =>
      existsSync(credentialFile(provider)),
    );
    if (storedProviders.length) {
      let available = false;
      try {
        await requireEncryption();
        available = true;
      } catch {
        // 初始化失败保留全部旧密文；不从轮询或失败路径自动重试。
      }
      current();
      for (const provider of storedProviders) {
        try {
          if (!available) throw new Error('System encryption unavailable');
          const decrypted = await bounded(`${provider}-decrypt`, () =>
            safeStorage.decryptStringAsync(readFileSync(credentialFile(provider))),
          );
          current();
          nextCached.set(provider, decrypted.result);
        } catch {
          current();
          nextUnavailable.add(provider);
        }
      }
    }
    // 重读只提交本代的完整内存投影；晚到读取不能覆盖后来的保存、删除或新重读。
    current();
    cached = nextCached;
    unavailable = nextUnavailable;
  };
  if (initialization) {
    // 窗口就绪前只暴露不可读状态；轮询不能触发系统调用，首次读取也不能覆盖后来的显式操作。
    unavailable = new Set(
      agentProviderSchema.options.filter((provider) => existsSync(credentialFile(provider))),
    );
    void initialization.afterWindowReady
      .then(async () => {
        if (!initialReadQueued) return;
        initialReadQueued = false;
        await refresh();
      })
      .catch(() => {
        // 窗口加载/初始化失败保留旧密文和不可读标记，不能明文降级或自动重试。
      })
      .finally(initialization.onSettled);
  } else await refresh();
  return {
    refresh() {
      initialReadQueued = false;
      return refresh();
    },
    get(provider = 'openai') {
      if (unavailable.has(provider)) throw new Error('Credential unavailable');
      return cached.get(provider);
    },
    async set(key, provider = 'openai') {
      initialReadQueued = false;
      const revision = ++generation;
      await requireEncryption();
      if (revision !== generation) throw new Error('Credential operation superseded');
      const bytes = await bounded(`${provider}-encrypt`, () => safeStorage.encryptStringAsync(key));
      if (revision !== generation) throw new Error('Credential operation superseded');
      const file = credentialFile(provider);
      writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      cached.set(provider, key);
      unavailable.delete(provider);
    },
    clear(provider = 'openai') {
      initialReadQueued = false;
      generation++;
      const file = credentialFile(provider);
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
