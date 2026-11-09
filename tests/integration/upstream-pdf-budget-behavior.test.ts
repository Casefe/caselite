import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, truncateSync, readdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MATERIAL_MAX_BYTES } from '@caselite/contracts';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(size: number) {
  const root = mkdtempSync(join(tmpdir(), 'caselite-pdf-size-'));
  roots.push(root);
  const source = join(root, 'synthetic.pdf');
  writeFileSync(source, '%PDF-synthetic-size-test');
  truncateSync(source, size);
  return { root, source, assets: join(root, 'materials') };
}
it('refuses an oversized synthetic PDF before reading file bytes or creating a staged copy', async () => {
  const f = fixture(MATERIAL_MAX_BYTES + 1);
  const handle = await open(f.source, 'r');
  const reads = vi.spyOn(Object.getPrototypeOf(handle), 'readFile');
  await handle.close();
  await expect(createMaterialFiles(f.assets).stage(f.source, 'home')).rejects.toThrow(
    'File budget',
  );
  expect(reads).not.toHaveBeenCalled();
  expect(readdirSync(join(f.assets, 'staging'))).toEqual([]);
  expect(readdirSync(join(f.assets, 'originals'))).toEqual([]);
});
it('accepts the exact configured byte boundary without changing the source file', async () => {
  const f = fixture(MATERIAL_MAX_BYTES);
  const files = createMaterialFiles(f.assets);
  const staged = await files.stage(f.source, 'home');
  expect(staged.bytes).toBe(MATERIAL_MAX_BYTES);
  expect(staged.name).toBe('synthetic.pdf');
  expect(await files.placedOrStaged(staged.token, staged.sha256)).toHaveLength(MATERIAL_MAX_BYTES);
  expect(readdirSync(join(f.assets, 'originals'))).toEqual([]);
});
