import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('test-integrity gate', () => {
  it('rejects the deliberate skip fixture while accepting real tests', () => {
    const output = execFileSync(process.execPath, ['scripts/check-test-integrity.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(output).toContain('Test-integrity check passed');
    expect(output).toContain('Deliberate negative fixture detected');
  });
});
