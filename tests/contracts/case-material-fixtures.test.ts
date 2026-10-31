import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixturesRoot = path.join(repositoryRoot, 'tests/fixtures/case-materials');
const manifest = JSON.parse(readFileSync(path.join(fixturesRoot, 'manifest.json'), 'utf8')) as {
  files: Array<{ id: string; path: string; sha256: string; textLayer: string }>;
};

function sha256(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

describe('CaseLite synthetic case-material fixtures', () => {
  it('keeps every manifested fixture present and unchanged', () => {
    expect(manifest.files).toHaveLength(5);

    for (const fixture of manifest.files) {
      expect(sha256(path.join(fixturesRoot, fixture.path))).toBe(fixture.sha256);
    }
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
});
