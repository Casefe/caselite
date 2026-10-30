import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

describe('architecture boundary gate', () => {
  it('accepts current renderer code and detects the deliberate Node import fixture', () => {
    const output = execFileSync(process.execPath, ['scripts/check-architecture-boundaries.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(output).toContain('Architecture boundary check passed');
    expect(output).toContain('Deliberate negative fixture detected');
  });
});
