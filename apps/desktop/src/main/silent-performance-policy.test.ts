import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { realpathSync, readFileSync } from 'node:fs';
import { validateSilentPerformance } from './silent-performance-policy';
const roots: string[] = [];
function root() {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'caselite-task-demo-silent-')));
  roots.push(p);
  writeFileSync(
    join(p, 'silent-manifest.json'),
    JSON.stringify({
      version: 1,
      purpose: 'DEV-1932-synthetic-only',
      root: p,
      credentialAccess: 'disabled',
      token: 'a'.repeat(64),
    }),
  );
  return p;
}
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
describe('silent performance isolation', () => {
  it('requires compiled test-only build and explicit root', () => {
    expect(() => validateSilentPerformance(false, root(), 'run-0.json')).toThrow();
    expect(() => validateSilentPerformance(true, undefined, 'run-0.json')).toThrow();
  });
  it('rejects output escape and overwrite', () => {
    const p = root();
    expect(() => validateSilentPerformance(true, p, '../result.json')).toThrow();
    writeFileSync(join(p, 'run-0.json'), 'existing');
    expect(() => validateSilentPerformance(true, p, 'run-0.json')).toThrow();
  });
  it('rejects a symlink in the profile before session access', () => {
    const p = root();
    symlinkSync(tmpdir(), join(p, 'userData'));
    expect(() => validateSilentPerformance(true, p, 'run-0.json')).toThrow();
  });
  it('rejects a manifest bound to a different root', () => {
    const p = root();
    writeFileSync(
      join(p, 'silent-manifest.json'),
      JSON.stringify({
        version: 1,
        purpose: 'DEV-1932-synthetic-only',
        root: '/',
        credentialAccess: 'disabled',
        token: 'a'.repeat(64),
      }),
    );
    expect(() => validateSilentPerformance(true, p, 'run-0.json')).toThrow();
  });
  it('accepts the owned synthetic-only root', () => {
    const p = root();
    expect(validateSilentPerformance(true, p, 'run-0.json')).toEqual({
      root: p,
      output: join(p, 'run-0.json'),
    });
  });
});

describe('silent performance production wiring', () => {
  const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const forge = readFileSync(new URL('../../forge.config.mjs', import.meta.url), 'utf8');
  it('compiled silent binary rejects ordinary startup before window setup', () => {
    expect(main).toContain(
      'if (CASELITE_SILENT_PERFORMANCE_BUILD && !silentRequested) process.exit(2)',
    );
    expect(main.indexOf('validateSilentPerformance(')).toBeLessThan(
      main.indexOf('const defaultCredentialRoot'),
    );
    expect(main).toContain('CASELITE_LOCAL_TEST_BUILD && CASELITE_SILENT_PERFORMANCE_BUILD');
  });
  it('prevents focus, visibility and existing workspace activation', () => {
    expect(main).toContain("app.setActivationPolicy('prohibited')");
    expect(main).toContain("app.on('browser-window-created'");
    expect(main).toContain('silentRequested || isolatedProbe || app.requestSingleInstanceLock()');
    expect(main).toContain('show && !silentRequested && !window.isDestroyed()');
    expect(main).toContain('focusable: false, skipTaskbar: true');
  });
  it('uses separate test bundle identity with two build gates', () => {
    expect(forge).toContain("process.env.CASELITE_LOCAL_TEST_BUILD === '1' &&");
    expect(forge).toContain("process.env.CASELITE_SILENT_PERFORMANCE_BUILD === '1'");
    expect(forge).toContain("'com.caselite.silent-performance'");
    expect(forge).toContain('LSUIElement: true');
  });
});
