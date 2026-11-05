import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentCredentialPort } from '@caselite/application';

export async function createAgentCredentials(root: string): Promise<AgentCredentialPort> {
  const file = join(root, 'openai-credential.enc');
  let cached: string | undefined;
  let unavailable = false;
  const requireEncryption = async () => {
    if (process.platform !== 'darwin' || !(await safeStorage.isAsyncEncryptionAvailable()))
      throw new Error('System encryption unavailable');
  };
  if (existsSync(file)) {
    try {
      await requireEncryption();
      cached = (await safeStorage.decryptStringAsync(readFileSync(file))).result;
    } catch {
      unavailable = true;
    }
  }
  return {
    get() {
      if (unavailable) throw new Error('Credential unavailable');
      return cached;
    },
    async set(key) {
      await requireEncryption();
      const bytes = await safeStorage.encryptStringAsync(key);
      writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      cached = key;
      unavailable = false;
    },
    clear() {
      rmSync(file, { force: true });
      rmSync(`${file}.tmp`, { force: true });
      cached = undefined;
      unavailable = false;
    },
  };
}
