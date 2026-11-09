import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('rejects missing or unrelated performance output before launching any app or creating files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'caselite-performance-negative-'));
  try {
    for (const output of [undefined, directory, directory + '/new']) {
      const env = { ...process.env };
      delete env.CASELITE_PERFORMANCE_OUTPUT;
      if (output) env.CASELITE_PERFORMANCE_OUTPUT = output;
      const result = spawnSync(
        process.execPath,
        [resolve('scripts/check-performance-demo.mjs'), '/not-an-app'],
        { env, encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Explicit fresh direct-child performance output required');
      expect(readdirSync(directory)).toEqual([]);
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});
