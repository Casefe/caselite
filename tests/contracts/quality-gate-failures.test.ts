import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imports, forbiddenTestModifiers } from '../../scripts/lib/source-analysis.mjs';
import {
  analyzeArchitecture,
  boundaryViolation,
} from '../../scripts/check-architecture-boundaries.mjs';
import { executePlan } from '../../scripts/lib/quality-results.mjs';
import { licenseViolations } from '../../scripts/lib/license-policy.mjs';
import { reviewChanges } from '../../scripts/check-quality-changes.mjs';

describe('G0 rejects deliberate failures', () => {
  it('detects static, dynamic, re-export, require and relative renderer boundary bypasses', () => {
    const file = 'apps/desktop/src/renderer/probe.ts';
    for (const source of [
      "import fs from 'node:fs';",
      "export * from 'node:fs';",
      "const probe = () => import('node:fs');",
      "const fs = require('fs/promises');",
    ]) {
      const entries = imports(source, file);
      expect(entries).toHaveLength(1);
      expect(boundaryViolation(file, entries[0].specifier!)).toBeTruthy();
    }
    expect(boundaryViolation(file, '../main/index', 'apps/desktop/src/main/index.ts')).toBeTruthy();
    expect(imports("// import('node:fs')\nconst text = 'require(fs)';", file)).toEqual([]);
    expect(imports('import(variable)', file)[0].specifier).toBeNull();
    expect(
      boundaryViolation(
        file,
        '../preload/caselite-api',
        'apps/desktop/src/preload/caselite-api.ts',
        true,
      ),
    ).toBeNull();
  });

  it('enforces future domain, sync, MCP, skill and contracts directions without creating production packages', () => {
    for (const [file, dependency, target] of [
      ['packages/domain/src/probe.ts', 'react', undefined],
      ['packages/domain/src/probe.ts', 'electron', undefined],
      ['packages/domain/src/probe.ts', 'drizzle-orm', undefined],
      ['packages/domain/src/probe.ts', 'yjs', undefined],
      ['packages/sync-client/src/probe.ts', 'react', undefined],
      [
        'apps/desktop/src/main/hosts/mcp/probe.ts',
        '@caselite/local-db',
        'packages/local-db/src/index.ts',
      ],
      ['packages/skills/src/probe.ts', 'better-sqlite3', undefined],
      ['apps/desktop/src/preload/probe.ts', 'node:fs', undefined],
      [
        'apps/desktop/src/preload/probe.ts',
        '@caselite/application',
        'packages/application/src/index.ts',
      ],
      [
        'apps/desktop/src/main/ipc/probe.ts',
        '@caselite/local-db',
        'packages/local-db/src/index.ts',
      ],
      [
        'packages/contracts/src/probe.ts',
        '@caselite/application',
        'packages/application/src/index.ts',
      ],
    ])
      expect(boundaryViolation(file!, dependency!, target)).toBeTruthy();
  });

  it('finds source cycles, undeclared deep entries, unused workspaces and empty future directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'caselite-architecture-'));
    const put = (file: string, text: string) => {
      const path = join(root, file);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    };
    try {
      put('apps/desktop/package.json', JSON.stringify({ name: '@caselite/desktop' }));
      put('apps/desktop/src/main/index.ts', "import '@caselite/contracts/private';");
      put(
        'packages/contracts/package.json',
        JSON.stringify({ name: '@caselite/contracts', exports: { '.': './src/index.ts' } }),
      );
      put('packages/contracts/src/index.ts', "export * from './cycle';");
      put('packages/contracts/src/cycle.ts', "export * from './index';");
      put('packages/unused/package.json', JSON.stringify({ name: '@caselite/unused' }));
      mkdirSync(join(root, 'infra'));
      const report = analyzeArchitecture(root);
      expect(report.violations.join('\n')).toMatch(/circular dependency/);
      expect(report.violations.join('\n')).toMatch(/workspace deep import/);
      expect(report.violations.join('\n')).toMatch(/undeclared dependency/);
      expect(report.violations.join('\n')).toMatch(/unused workspace/);
      expect(report.violations.join('\n')).toMatch(/no implementation/);
      expect(report.violations.join('\n')).toMatch(/empty future/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects chained, computed, conditional, alias and namespace skipped or focused tests', () => {
    for (const source of [
      "test.skip.each([1])('probe', () => {});",
      "test['only']('probe', () => {});",
      "describe.skipIf(true)('probe', () => {});",
      "import { it as scenario } from 'vitest'; scenario.todo('probe');",
      "import * as v from 'vitest'; v.test.skip('probe', () => {});",
    ])
      expect(forbiddenTestModifiers(source, 'probe.test.ts').length).toBeGreaterThan(0);
    expect(
      forbiddenTestModifiers("const example = 'test.skip()'; // test.only()", 'probe.test.ts'),
    ).toEqual([]);
  });

  it('blocks unknown, AGPL, commercial and unreviewed license expressions but labels own workspace code separately', () => {
    const packages = [
      'UNKNOWN',
      'AGPL-3.0-only',
      'UNLICENSED',
      '(MIT OR GPL-3.0)',
      'MIT',
      'Apache-2.0',
    ].map((license) => ({ name: 'synthetic', version: '0', license }));
    expect(licenseViolations(packages)).toHaveLength(4);
    expect(
      licenseViolations([
        { name: '@caselite/owned', version: '0', license: 'UNKNOWN', workspace: true },
      ]),
    ).toEqual([]);
  });

  it('records signals and every later unexecuted check instead of losing them on failure', () => {
    let executions = 0;
    const results = executePlan(
      [
        ['a', ['a']],
        ['b', ['b']],
        ['c', ['c']],
      ],
      () => {
        executions++;
        return { status: null, signal: 'SIGABRT' };
      },
    );
    expect(executions).toBe(1);
    expect(results.map((item) => item.status)).toEqual(['failed', 'not-run', 'not-run']);
    expect(results[0]).toMatchObject({ exitCode: null, signal: 'SIGABRT' });
    expect(executePlan([['x', ['x']]], () => ({ status: 1 }))[0]).toMatchObject({
      status: 'failed',
      exitCode: 1,
    });
  });

  it('blocks removed tests, security chain removal, disabled CI and lowered thresholds and requests review of protected changes', () => {
    const activeWorkflow = [
      'on:',
      '  pull_request:',
      'jobs:',
      '  quality:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: pnpm run ci',
      '      - name: Upload quality evidence',
      '        if: always()',
      '        uses: actions/upload-artifact@v7',
      '        with:',
      '          name: quality-evidence',
      '          path: artifacts/evidence/g0-ci-*.json',
      '          if-no-files-found: error',
    ].join('\n');
    const report = reviewChanges([
      {
        file: 'tests/contracts/probe.test.ts',
        before: "it('required safety', () => {});",
        after: '',
      },
      {
        file: 'package.json',
        before: JSON.stringify({
          scripts: { 'security:baseline': 'pnpm security:secrets', 'security:secrets': 'scan' },
        }),
        after: JSON.stringify({ scripts: { 'security:baseline': 'true' } }),
      },
      {
        file: '.github/workflows/quality.yml',
        before: activeWorkflow,
        after: 'push:',
      },
      {
        file: 'vitest.config.mts',
        before: 'thresholds: { lines: 80 }',
        after: 'thresholds: { lines: 20 }',
      },
    ]);
    expect(report.reviewRequired).toBe(true);
    expect(report.violations.join('\n')).toMatch(/Test removed/);
    expect(report.violations.join('\n')).toMatch(/Security chain removed/);
    expect(report.violations.join('\n')).toMatch(/workflow missing/);
    expect(report.violations.join('\n')).toMatch(/threshold removed or lowered/);
    for (const after of [
      activeWorkflow.replace('pnpm run ci', 'pnpm ci'),
      activeWorkflow.replace('if-no-files-found: error', 'if-no-files-found: warn'),
      activeWorkflow.replace('path: artifacts/evidence/g0-ci-*.json', 'path: coverage/'),
      activeWorkflow.replace('  pull_request:', '  # pull_request:'),
      activeWorkflow.replace('  pull_request:', '  pull_request:\n    types: [closed]'),
      activeWorkflow.replace('  pull_request:', '  pull_request:\n    branches: [release]'),
      activeWorkflow.replace('  pull_request:', "  pull_request:\n    paths-ignore: ['**']"),
      activeWorkflow.replace(
        '      - run: pnpm run ci',
        '      - run: pnpm run ci\n        if: false',
      ),
      activeWorkflow.replace(
        '      - run: pnpm run ci',
        '      - run: pnpm run ci\n        if : false',
      ),
      activeWorkflow.replace('        if: always()', '        if: false'),
      activeWorkflow.replace('  quality:', '  quality:\n    if: false'),
      activeWorkflow.replace('  quality:', '  quality:\n    if : false'),
      activeWorkflow.replace(
        '  quality:',
        '  precheck:\n    if: false\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n  quality:\n    needs: precheck',
      ),
      activeWorkflow.replace(
        '      - run: pnpm run ci',
        '      - run: pnpm run ci\n        continue-on-error: true',
      ),
    ]) {
      expect(
        reviewChanges([
          {
            file: '.github/workflows/quality.yml',
            before: activeWorkflow,
            after,
          },
        ]).violations,
      ).toContain(
        'Required PR quality workflow missing an active CI step or required evidence: .github/workflows/quality.yml',
      );
    }
    expect(
      reviewChanges([
        {
          file: '.github/workflows/quality.yml',
          before: activeWorkflow.replace('pnpm run ci', 'pnpm ci'),
          after: activeWorkflow,
        },
      ]).violations,
    ).toEqual([]);
    expect(
      reviewChanges([
        {
          file: 'tests/contracts/repeated.test.ts',
          before: "it('same title', () => {}); it('same title', () => {});",
          after: "it('same title', () => {});",
        },
      ]).violations,
    ).toContain('Test removed: same title');
  });
});
