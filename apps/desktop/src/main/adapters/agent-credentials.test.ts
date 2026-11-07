import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(),
  decryptStringAsync: vi.fn(),
  encryptStringAsync: vi.fn(),
}));
vi.mock('electron', () => ({ safeStorage: storage }));
import { createAgentApplication } from '@caselite/application';
import { createAgentCredentials } from './agent-credentials';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let root: string;
const file = () => join(root, 'openai-credential.enc');
const ciphertext = Buffer.from('synthetic-existing-ciphertext');
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  root = mkdtempSync(join(tmpdir(), 'caselite-credential-test-'));
  vi.useFakeTimers();
  storage.isAsyncEncryptionAvailable.mockReset().mockResolvedValue(true);
  storage.encryptStringAsync.mockReset().mockResolvedValue(ciphertext);
  storage.decryptStringAsync
    .mockReset()
    .mockResolvedValue({ result: 'synthetic-key', shouldReEncrypt: false });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe('bounded system credentials', () => {
  it('opens the no-Key manual path without initializing system storage', async () => {
    const vault = await createAgentCredentials(root);
    expect(vault.get()).toBeUndefined();
    expect(vault.getDefaultModel()).toBe('gpt-4.1-mini');
    expect(storage.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
  });
  it('preserves both ciphertexts on unavailable initialization without fallback', async () => {
    writeFileSync(file(), ciphertext);
    writeFileSync(join(root, 'deepseek-credential.enc'), ciphertext);
    storage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    const vault = await createAgentCredentials(root);
    expect(() => vault.get()).toThrow('Credential unavailable');
    expect(() => vault.get('deepseek')).toThrow('Credential unavailable');
    expect(readFileSync(file())).toEqual(ciphertext);
    expect(readFileSync(join(root, 'deepseek-credential.enc'))).toEqual(ciphertext);
    expect(storage.decryptStringAsync).not.toHaveBeenCalled();
    expect(storage.encryptStringAsync).not.toHaveBeenCalled();
    expect(storage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1);
  });
  it('bounds a hanging initialization and ignores its later success', async () => {
    writeFileSync(file(), ciphertext);
    const late = pending<boolean>();
    storage.isAsyncEncryptionAvailable.mockReturnValue(late.promise);
    const stages = vi.fn();
    const opening = createAgentCredentials(root, stages);
    await vi.advanceTimersByTimeAsync(3000);
    const vault = await opening;
    late.resolve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(() => vault.get()).toThrow('Credential unavailable');
    expect(storage.decryptStringAsync).not.toHaveBeenCalled();
    expect(stages).toHaveBeenLastCalledWith('availability', 'unavailable', 'TIMEOUT');
    expect(readFileSync(file())).toEqual(ciphertext);
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores late decrypt %s without caching or overwriting ciphertext',
    async (outcome) => {
      writeFileSync(file(), ciphertext);
      const late = pending<{ result: string; shouldReEncrypt: boolean }>();
      storage.decryptStringAsync.mockReturnValue(late.promise);
      const opening = createAgentCredentials(root);
      await vi.advanceTimersByTimeAsync(3000);
      const vault = await opening;
      if (outcome === 'resolve')
        late.resolve({ result: 'late-synthetic-key', shouldReEncrypt: true });
      else late.reject(new Error('synthetic sensitive error'));
      await vi.advanceTimersByTimeAsync(1);
      expect(() => vault.get()).toThrow('Credential unavailable');
      expect(readFileSync(file())).toEqual(ciphertext);
      expect(storage.encryptStringAsync).not.toHaveBeenCalled();
    },
  );
  it('does not let a timed-out encryption write files or update a cached Key later', async () => {
    writeFileSync(file(), ciphertext);
    const vault = await createAgentCredentials(root);
    const late = pending<Buffer>();
    storage.encryptStringAsync.mockReturnValue(late.promise);
    const saving = vault.set('new-synthetic-key');
    const rejected = expect(saving).rejects.toThrow('System credential unavailable');
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    late.resolve(Buffer.from('late-new-ciphertext'));
    await vi.advanceTimersByTimeAsync(1);
    expect(vault.get()).toBe('synthetic-key');
    expect(readFileSync(file())).toEqual(ciphertext);
    expect(existsSync(`${file()}.tmp`)).toBe(false);
  });
  it('bounds initialization during save and never starts encryption after timeout', async () => {
    const vault = await createAgentCredentials(root);
    const late = pending<boolean>();
    storage.isAsyncEncryptionAvailable.mockReturnValue(late.promise);
    const saving = vault.set('synthetic-key');
    const rejected = expect(saving).rejects.toThrow('System credential unavailable');
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    late.resolve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(storage.encryptStringAsync).not.toHaveBeenCalled();
    expect(vault.get()).toBeUndefined();
    expect(existsSync(file())).toBe(false);
  });
  it('preserves old bytes on asynchronous rejection and never reflects raw system errors', async () => {
    writeFileSync(file(), ciphertext);
    const vault = await createAgentCredentials(root);
    storage.encryptStringAsync.mockRejectedValue(new Error('synthetic-key private-error'));
    await expect(vault.set('new-synthetic-key')).rejects.toThrow(/^System credential unavailable$/);
    expect(vault.get()).toBe('synthetic-key');
    expect(readFileSync(file())).toEqual(ciphertext);
    storage.decryptStringAsync.mockRejectedValue(new Error('synthetic-key private-error'));
    const reopened = await createAgentCredentials(root);
    expect(() => reopened.get()).toThrow(/^Credential unavailable$/);
  });
  it('saves, reopens and explicitly deletes one Provider while preserving the default and other Provider', async () => {
    const vault = await createAgentCredentials(root);
    await vault.set('synthetic-key');
    await vault.set('synthetic-key', 'deepseek');
    vault.setDefaultModel('deepseek-flash');
    const reopened = await createAgentCredentials(root);
    expect(reopened.get()).toBe('synthetic-key');
    expect(reopened.get('deepseek')).toBe('synthetic-key');
    reopened.clear('deepseek');
    expect(reopened.get('deepseek')).toBeUndefined();
    expect(reopened.get()).toBe('synthetic-key');
    expect(reopened.getDefaultModel()).toBe('deepseek-flash');
    expect(existsSync(join(root, 'deepseek-credential.enc'))).toBe(false);
  });
});

it('keeps Provider dispatch blocked after a timed-out decrypt returns successfully', async () => {
  writeFileSync(file(), ciphertext);
  const late = pending<{ result: string; shouldReEncrypt: boolean }>();
  storage.decryptStringAsync.mockReturnValue(late.promise);
  const opening = createAgentCredentials(root);
  await vi.advanceTimersByTimeAsync(3000);
  const credentials = await opening;
  const runtime = { start: vi.fn(() => ({ cancel() {} })) };
  const app = createAgentApplication({ credentials, runtime, taskExists: () => true });
  late.resolve({ result: 'late-synthetic-key', shouldReEncrypt: false });
  await vi.advanceTimersByTimeAsync(1);
  const profile = await app.execute({ protocol_version: 1, operation: 'profile' }, 'window');
  expect(profile).toMatchObject({
    ok: true,
    configured: false,
    credential_errors: { openai: 'UNAVAILABLE' },
    model: 'gpt-4.1-mini',
  });
  expect(
    await app.execute(
      {
        protocol_version: 1,
        operation: 'start',
        scope: 'home',
        run_id: '12121212-1212-4212-8212-121212121212',
        prompt: '合成文字',
        confirmed: true,
      },
      'window',
    ),
  ).toMatchObject({ ok: false, code: 'CREDENTIAL_UNAVAILABLE' });
  expect(runtime.start).not.toHaveBeenCalled();
  expect(readFileSync(file())).toEqual(ciphertext);
});

it('reports only an enum for rejected storage and distinguishes unavailable from timeout', async () => {
  writeFileSync(file(), ciphertext);
  const stages = vi.fn();
  storage.isAsyncEncryptionAvailable.mockRejectedValueOnce(
    new Error('private synthetic system error'),
  );
  const vault = await createAgentCredentials(root, stages);
  expect(() => vault.get()).toThrow('Credential unavailable');
  expect(stages).toHaveBeenLastCalledWith('availability', 'unavailable', 'REJECTED');
  expect(JSON.stringify(stages.mock.calls)).not.toContain('private');
  storage.isAsyncEncryptionAvailable.mockResolvedValueOnce(false);
  const second = vi.fn();
  await createAgentCredentials(root, second);
  expect(second).toHaveBeenLastCalledWith('availability', 'unavailable', 'UNAVAILABLE');
});

it('re-reads system storage only when explicitly requested after an initialization timeout', async () => {
  writeFileSync(file(), ciphertext);
  const late = pending<boolean>();
  storage.isAsyncEncryptionAvailable.mockReturnValueOnce(late.promise);
  const opening = createAgentCredentials(root);
  await vi.advanceTimersByTimeAsync(3000);
  const vault = await opening;
  late.resolve(true);
  await vi.advanceTimersByTimeAsync(0);
  for (let n = 0; n < 3; n++) expect(() => vault.get()).toThrow('Credential unavailable');
  expect(storage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1);
  await vault.refresh!();
  expect(vault.get()).toBe('synthetic-key');
  expect(storage.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(2);
  expect(readFileSync(file())).toEqual(ciphertext);
});

it.each(['save', 'clear', 'refresh'] as const)(
  'does not let an older read overwrite a later %s',
  async (action) => {
    writeFileSync(file(), ciphertext);
    const vault = await createAgentCredentials(root);
    const late = pending<{ result: string; shouldReEncrypt: boolean }>();
    storage.decryptStringAsync.mockReturnValueOnce(late.promise);
    const reading = vault.refresh!();
    const rejected = expect(reading).rejects.toThrow('Credential operation superseded');
    await vi.advanceTimersByTimeAsync(0);
    if (action === 'save') await vault.set('new-synthetic-key');
    if (action === 'clear') vault.clear();
    if (action === 'refresh') {
      storage.decryptStringAsync.mockResolvedValueOnce({
        result: 'new-synthetic-key',
        shouldReEncrypt: false,
      });
      await vault.refresh!();
    }
    late.resolve({ result: 'stale-synthetic-key', shouldReEncrypt: false });
    await rejected;
    expect(vault.get()).toBe(action === 'clear' ? undefined : 'new-synthetic-key');
    if (action === 'clear') expect(existsSync(file())).toBe(false);
  },
);

it('does not let an earlier encryption overwrite a later explicit clear', async () => {
  writeFileSync(file(), ciphertext);
  const vault = await createAgentCredentials(root);
  const late = pending<Buffer>();
  storage.encryptStringAsync.mockReturnValueOnce(late.promise);
  const saving = vault.set('new-synthetic-key');
  const rejected = expect(saving).rejects.toThrow('Credential operation superseded');
  await vi.advanceTimersByTimeAsync(0);
  vault.clear();
  late.resolve(Buffer.from('stale-ciphertext'));
  await rejected;
  expect(vault.get()).toBeUndefined();
  expect(existsSync(file())).toBe(false);
});
