import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWorktreeOrIndex } from '../../scripts/lib/repository-content.mjs';

describe('repository security scan input', () => {
  it('retains indexed content when a file is deleted before staging and cleans its isolated repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-index-fixture-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      const file = 'synthetic.txt';
      const content = ['ghp', 'A'.repeat(36)].join('_');
      writeFileSync(join(root, file), content);
      execFileSync('git', ['add', '--', file], { cwd: root });
      rmSync(join(root, file));
      expect(readWorktreeOrIndex(root, file).toString()).toBe(content);
      // This snapshot must reach the same credential detector as a live file.
      expect(readWorktreeOrIndex(root, file).toString()).toMatch(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/);
      writeFileSync(join(root, file), 'live worktree');
      expect(readWorktreeOrIndex(root, file).toString()).toBe('live worktree');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(existsSync(root)).toBe(false);
  });
});
