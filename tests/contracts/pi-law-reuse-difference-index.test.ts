import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentRequestSchema } from '../../packages/contracts/src/agent';
import {
  assertReuseDifferenceBoundaries,
  loadReuseDifferenceIndex,
  piImportHits,
  repositoryRoot,
  type ReuseDifferenceIndex,
} from '../fixtures/pi-law/reuse-difference-index';

const runId = '11111111-1111-4111-8111-111111111111';
const passIds = ['exit-host-read', 'persistence-independent-of-pi', 'agent-v1-omits-manifest'];

function entry(index: ReuseDifferenceIndex, id: string) {
  const found = index.entries.find((item) => item.id === id);
  expect(found, id).toBeTruthy();
  return found!;
}

describe('Pi-law reuse difference index', () => {
  it('keeps product and candidate acceptance unclaimed while recording only this card’s checks', () => {
    const index = loadReuseDifferenceIndex();
    expect(index.entries.map((item) => item.id)).toEqual([
      'exit-host-read',
      'persistence-independent-of-pi',
      'agent-v1-omits-manifest',
      'product-acceptance',
      'candidate-acceptance',
      'source-version-anchor-store',
      'upstream-difference-cards',
      'lawyer-and-real-provider',
    ]);
    expect(entry(index, 'product-acceptance')).toMatchObject({
      owner_issue: 'DEV-1657',
      status: 'NOT_RUN',
      evidence: null,
    });
    expect(entry(index, 'candidate-acceptance')).toMatchObject({
      owner_issue: 'DEV-1655',
      status: 'NOT_RUN',
      evidence: null,
    });
    for (const id of [
      'source-version-anchor-store',
      'upstream-difference-cards',
      'lawyer-and-real-provider',
    ])
      expect(entry(index, id).status).toBe('NOT_RUN');
    for (const id of passIds) {
      expect(entry(index, id)).toMatchObject({ owner_issue: 'DEV-1767', status: 'PASS_REAL' });
    }
    const claimed = index.entries
      .filter((item) => item.status === 'PASS_REAL')
      .map((item) => item.id);
    expect(claimed).toEqual(passIds);
  });

  it('rejects an index that marks another card’s acceptance as passed', () => {
    const index = loadReuseDifferenceIndex();
    const stolen: ReuseDifferenceIndex = {
      ...index,
      entries: index.entries.map((item) =>
        item.id === 'product-acceptance'
          ? { ...item, status: 'PASS_REAL', evidence: 'tests/integration/pi-law-exit-read.test.ts' }
          : item,
      ),
    };
    expect(() => assertReuseDifferenceBoundaries(stolen)).toThrow(/DEV-1657/);
  });

  it('records that agent:v1 still rejects a manifest operation and extra manifest field', () => {
    const start = {
      protocol_version: 1,
      operation: 'start',
      scope: 'home',
      run_id: runId,
      prompt: '合成输入',
      confirmed: true,
    };
    expect(agentRequestSchema.safeParse(start).success).toBe(true);
    expect(agentRequestSchema.safeParse({ ...start, manifest_id: runId }).success).toBe(false);
    expect(
      agentRequestSchema.safeParse({
        protocol_version: 1,
        operation: 'submit_manifest',
        manifest_id: runId,
      }).success,
    ).toBe(false);
  });

  it('finds no Pi import in the persistence packages or this card’s exit read', () => {
    expect(
      piImportHits(repositoryRoot, [
        'packages/domain',
        'packages/contracts',
        'packages/application',
        'packages/local-db',
      ]),
    ).toEqual([]);
    const exitRead = readFileSync(
      join(repositoryRoot, 'tests/integration/pi-law-exit-read.test.ts'),
      'utf8',
    );
    expect(exitRead).not.toContain('@earendil-works/');
    expect(exitRead).not.toContain('pi-runtime');
  });
});
