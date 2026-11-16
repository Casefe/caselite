import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = path.join(repositoryRoot, 'tests/fixtures/pi-law-harness/plh-12-dev-1767');

const RESULTS = new Set(['PASS_REAL', 'MOCK_ONLY', 'NOT_RUN', 'BLOCKED', 'FAIL']);

type ExitEvidenceIndex = {
  index_id: string;
  issue: string;
  plh_id: string;
  base_commit: string;
  acceptance_owners: { product_total: string };
  upstream_plh_dependencies: Array<{ plh: string; issue: string; result: string }>;
  fixed_references: Record<string, string>;
  harness_exit_conditions: Array<{ id: string; verification: string }>;
  difference_acceptance_paths: Array<{ id: string; result: string }>;
  evidence_slots: Array<{ slot_id: string; required: boolean; result: string }>;
  result_vocabulary: string[];
};

type DifferenceAcceptance = {
  artifact_id: string;
  issue: string;
  paired_product_acceptance: string;
  loop_steps: Array<{ step: number; name: string; result: string }>;
};

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, fileName), 'utf8')) as T;
}

function assertResults(values: string[]) {
  for (const value of values) {
    expect(RESULTS.has(value)).toBe(true);
  }
}

describe('PLH-12 Pi-law exit evidence index (DEV-1767 trial)', () => {
  const index = readJson<ExitEvidenceIndex>('exit-evidence-index.json');
  const difference = readJson<DifferenceAcceptance>('difference-acceptance.json');

  it('binds PLH-12 to DEV-1767 and DEV-1657 product acceptance', () => {
    expect(index.index_id).toBe('PLH-12-DEV-1767-TRIAL-001');
    expect(index.issue).toBe('DEV-1767');
    expect(index.plh_id).toBe('PLH-12');
    expect(index.acceptance_owners.product_total).toBe('DEV-1657');
    expect(difference.paired_product_acceptance).toBe('DEV-1657');
    expect(difference.issue).toBe('DEV-1767');
  });

  it('keeps upstream PLH dependencies and exit slots on the approved result vocabulary', () => {
    expect(index.upstream_plh_dependencies.map((row) => row.plh)).toEqual(
      expect.arrayContaining(['PLH-06', 'PLH-07', 'PLH-10', 'PLH-11']),
    );
    assertResults(index.upstream_plh_dependencies.map((row) => row.result));
    assertResults(index.harness_exit_conditions.map((row) => row.verification));
    assertResults(index.difference_acceptance_paths.map((row) => row.result));
    assertResults(index.evidence_slots.map((row) => row.result));
    assertResults(difference.loop_steps.map((row) => row.result));
    expect(new Set(index.result_vocabulary)).toEqual(RESULTS);
  });

  it('points at frozen representative fixtures and existing harness scripts', () => {
    for (const relPath of Object.values(index.fixed_references)) {
      expect(() => readFileSync(path.join(repositoryRoot, relPath))).not.toThrow();
    }
  });

  it('requires SHA and fixture-index evidence slots', () => {
    const required = index.evidence_slots.filter((slot) => slot.required);
    expect(required.map((slot) => slot.slot_id)).toEqual(
      expect.arrayContaining(['E-SHA', 'E-FIXTURE-INDEX', 'E-1657-R1', 'E-LAWYER']),
    );
    expect(required.find((slot) => slot.slot_id === 'E-SHA')?.result).toBe('PASS_REAL');
  });

  it('defines a six-step same-page legal loop for difference acceptance', () => {
    expect(difference.loop_steps).toHaveLength(6);
    expect(difference.loop_steps.map((step) => step.name)).toEqual([
      'synthetic_ui',
      'fixed_materials',
      'byok_generate',
      'source_anchoring',
      'accept_or_reject_draft',
      'restart_readback',
    ]);
  });
});
