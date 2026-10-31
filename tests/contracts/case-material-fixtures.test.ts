import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixturesRoot = path.join(repositoryRoot, 'tests/fixtures/case-materials');
const manifest = JSON.parse(readFileSync(path.join(fixturesRoot, 'manifest.json'), 'utf8')) as {
  files: Array<{
    id: string;
    path: string;
    sha256: string;
    sourceSha256?: string;
    textLayer: string;
  }>;
};

function sha256(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

describe('CaseLite synthetic case-material fixtures', () => {
  it('keeps every manifested fixture present and unchanged', () => {
    expect(manifest.files).toHaveLength(6);

    for (const fixture of manifest.files) {
      expect(sha256(path.join(fixturesRoot, fixture.path))).toBe(fixture.sha256);
    }
  });

  it('ties each text source to its frozen PDF and verifies without rewriting files', () => {
    const sources = new Map([
      ['development-contract-v1-text', 'contract-v1.txt'],
      ['development-contract-v2-text', 'contract-v2.txt'],
      ['development-anchor-repeat-two-pages', 'anchor-repeat-two-pages.txt'],
      ['regression-supply-contract-v1-text', 'supply-contract-v1.txt'],
    ]);

    for (const fixture of manifest.files) {
      const source = sources.get(fixture.id);
      if (source) {
        expect(fixture.sourceSha256).toBe(sha256(path.join(fixturesRoot, 'source', source)));
      }
    }

    const files = ['manifest.json', ...manifest.files.map((fixture) => fixture.path)];
    const before = files.map((file) => sha256(path.join(fixturesRoot, file)));
    execFileSync(process.execPath, [
      path.join(repositoryRoot, 'scripts/generate-case-material-fixtures.mjs'),
    ]);
    expect(files.map((file) => sha256(path.join(fixturesRoot, file)))).toEqual(before);
  });

  it('keeps v1 and v2 to one substantive payment-term change', () => {
    const v1 = readFileSync(path.join(fixturesRoot, 'source/contract-v1.txt'), 'utf8').split('\n');
    const v2 = readFileSync(path.join(fixturesRoot, 'source/contract-v2.txt'), 'utf8').split('\n');
    const differences = v1
      .map((line, index) => [line, v2[index]])
      .filter(([left, right]) => left !== right);

    expect(differences).toEqual([
      [
        '2. 甲方应在收到乙方合规发票后十个自然日内一次性支付全部服务费。',
        '2. 甲方应在收到乙方合规发票后三十个自然日内一次性支付全部服务费。',
      ],
    ]);
  });

  it('keeps text, scan and damaged-input expectations explicit', () => {
    expect(manifest.files.map((fixture) => [fixture.id, fixture.textLayer])).toEqual(
      expect.arrayContaining([
        ['development-contract-v1-text', 'expected'],
        ['development-contract-v1-scan', 'none'],
        ['development-damaged-pdf', 'invalid'],
      ]),
    );
  });

  it('keeps one identical quote on each of two distinct PDF pages', () => {
    const source = readFileSync(
      path.join(fixturesRoot, 'source/anchor-repeat-two-pages.txt'),
      'utf8',
    );
    const pages = source.split('[[PAGE_BREAK]]');
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page.split('请核对资料编号。')).toHaveLength(2);
    }
    expect(pages[0]).toContain('ALPHA-001');
    expect(pages[1]).toContain('BETA-002');

    const pdf = readFileSync(
      path.join(fixturesRoot, 'development/anchor-repeat-two-pages.pdf'),
    ).toString('latin1');
    expect(pdf).toMatch(/\/Count\s+2\b/);
    expect([...pdf.matchAll(/\/Type\s*\/Page\b/g)]).toHaveLength(2);
  });
});
