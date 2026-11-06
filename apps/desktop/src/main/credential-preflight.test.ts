import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), network: vi.fn() }));
vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getName: () => 'CaseLite',
    isPackaged: true,
    getPath: () => 'isolated-data',
  },
  session: { defaultSession: { webRequest: { onBeforeRequest: mocks.network } } },
}));
vi.mock('./adapters/agent-credentials', () => ({ createAgentCredentials: mocks.create }));
import { runCredentialPreflight } from './credential-preflight';
let root: string;
let directory: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caselite-credential-origin-test-'));
  directory = mkdtempSync(join(tmpdir(), 'caselite-task-demo-credential-test-'));
  mocks.create.mockReset();
  mocks.network.mockReset();
  writeFileSync(join(root, 'deepseek-credential.enc'), 'synthetic-ciphertext');
  writeFileSync(join(root, 'agent-model.json'), '{"version":1,"model":"deepseek-flash"}');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(directory, { recursive: true, force: true });
});

it('uses only the original credential Owner getters, fingerprints files and never serializes the Key', async () => {
  const vault = {
    get: vi.fn((provider: string) =>
      provider === 'deepseek' ? 'private-synthetic-key' : undefined,
    ),
    getDefaultModel: () => 'deepseek-flash',
    set: vi.fn(),
    clear: vi.fn(),
    setDefaultModel: vi.fn(),
  };
  mocks.create.mockResolvedValue(vault);
  const result = await runCredentialPreflight(root, directory);
  expect(mocks.create.mock.calls[0][0]).toBe(root);
  expect(result).toMatchObject({
    model: 'deepseek-flash',
    configured: true,
    unchanged: true,
    providerDispatches: 0,
    httpAttempts: 0,
  });
  expect(vault.set).not.toHaveBeenCalled();
  expect(vault.clear).not.toHaveBeenCalled();
  expect(vault.setDefaultModel).not.toHaveBeenCalled();
  expect(readFileSync(join(directory, 'credential-result.json'), 'utf8')).not.toContain(
    'private-synthetic-key',
  );
  expect(readFileSync(join(root, 'deepseek-credential.enc'), 'utf8')).toBe('synthetic-ciphertext');
  const callback = vi.fn();
  mocks.network.mock.calls[0][0]({ url: 'https://example.invalid/' }, callback);
  expect(callback).toHaveBeenCalledWith({ cancel: true });
});
it('reports unavailable enums while preserving model, ciphertext and the no-dispatch result', async () => {
  mocks.create.mockResolvedValue({
    get: () => {
      throw new Error('private-error');
    },
    getDefaultModel: () => 'deepseek-flash',
  });
  const result = await runCredentialPreflight(root, directory);
  expect(result).toMatchObject({
    model: 'deepseek-flash',
    configured: false,
    unchanged: true,
    credentialErrors: { openai: 'UNAVAILABLE', deepseek: 'UNAVAILABLE' },
    providerDispatches: 0,
  });
  expect(readFileSync(join(directory, 'credential-result.json'), 'utf8')).not.toContain(
    'private-error',
  );
});
