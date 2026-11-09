import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultExportStyle } from '@caselite/contracts';
import { createExportConfigurationResolver } from './export-configuration';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it('freezes bounded host font bytes, rejects replacement, links and missing resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'caselite-export-font-'));
  roots.push(root);
  const path = join(root, 'font.ttf');
  const font = Buffer.alloc(32);
  font.writeUInt32BE(0x10000);
  await writeFile(path, font);
  const resolver = createExportConfigurationResolver(async () => path);
  const first = await resolver.resolve(defaultExportStyle);
  expect(await resolver.resolve(defaultExportStyle)).toEqual(first);
  expect((await resolver.resolve({ ...defaultExportStyle, font_size: 14 })).fingerprint).not.toBe(
    first.fingerprint,
  );
  font[20] = 1;
  await writeFile(path, font);
  await expect(resolver.verify(first)).rejects.toThrow('EXPORT_FONT_CHANGED');
  const linked = join(root, 'link.ttf');
  await symlink(path, linked);
  await expect(
    createExportConfigurationResolver(async () => linked).resolve(defaultExportStyle),
  ).rejects.toThrow('PDF_FONT_UNAVAILABLE');
  await writeFile(path, 'bad');
  await expect(resolver.resolve(defaultExportStyle)).rejects.toThrow('PDF_FONT_UNAVAILABLE');
  await rm(path);
  await expect(resolver.resolve(defaultExportStyle)).rejects.toThrow('PDF_FONT_UNAVAILABLE');
});
