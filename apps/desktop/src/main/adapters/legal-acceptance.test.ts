import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLegalAcceptance, loadLegalBundle } from './legal-acceptance';

describe('local legal acceptance owner', () => {
  it('persists a minimal receipt across instances and preserves unrecognized records', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-legal-unit-'));
    const file = join(root, 'legal-acceptance.json');
    try {
      const port = createLegalAcceptance(root);
      expect(port.read()).toBeNull();
      const receipt = {
        version: 1 as const,
        document_set_hash: 'a'.repeat(64),
        license_sha256: 'b'.repeat(64),
        eula_sha256: 'c'.repeat(64),
        accepted_at: '2026-11-09T10:00:00.000Z',
      };
      port.write(receipt);
      expect(createLegalAcceptance(root).read()).toEqual(receipt);
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(root)).toEqual(['legal-acceptance.json']);
      for (const corrupt of [
        'not json',
        JSON.stringify({ ...receipt, version: 2 }),
        JSON.stringify({ ...receipt, extra: 'unexpected' }),
      ]) {
        writeFileSync(file, corrupt);
        expect(() => port.write(receipt)).toThrow();
        expect(readFileSync(file, 'utf8')).toBe(corrupt);
      }
      rmSync(file);
      mkdirSync(file);
      expect(() => port.read()).toThrow();
      rmSync(file, { recursive: true });
      writeFileSync(join(root, 'unrelated'), JSON.stringify(receipt));
      symlinkSync(join(root, 'unrelated'), file);
      expect(() => port.read()).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('loads the canonical offline texts byte-for-byte and detects any text update', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-legal-unit-'));
    try {
      for (const name of ['LICENSE.md', 'EULA.md'])
        copyFileSync(resolve('legal', name), join(root, name));
      const first = loadLegalBundle(root);
      expect(first.documents[0].text).toBe(readFileSync('legal/LICENSE.md', 'utf8'));
      expect(first.documents[1].text).toBe(readFileSync('legal/EULA.md', 'utf8'));
      expect(first.documents[1].sha256).toBe(
        createHash('sha256').update(readFileSync('legal/EULA.md')).digest('hex'),
      );
      writeFileSync(join(root, 'EULA.md'), first.documents[1].text + '\n修订');
      expect(loadLegalBundle(root).document_set_hash).not.toBe(first.document_set_hash);
      rmSync(join(root, 'LICENSE.md'));
      expect(() => loadLegalBundle(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
