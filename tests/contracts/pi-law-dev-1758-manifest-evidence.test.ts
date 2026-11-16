import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bind1651MaterialEvidence,
  evidenceRefsFromManifest,
  manifestEvidenceAlignedWith1651Preview,
  manifestEvidenceIndexFromManifest,
  materialPreviewCompatGaps,
  previewSelectionCoversEvidenceRef,
} from '../../packages/contracts/src/pi-law-harness';
import {
  renderSelectedInput,
  selectedInputManifestSchema,
} from '../../packages/contracts/src/agent-input';
import { materialPreviewSchema } from '../../packages/contracts/src/material';

const here = dirname(fileURLToPath(import.meta.url));
const frozen1651 = materialPreviewSchema.parse(
  JSON.parse(readFileSync(join(here, '../fixtures/pi-law/dev-1651-material-preview.json'), 'utf8')),
);

const manifestId = '11111111-1111-4111-8111-111111111111';
const taskId = frozen1651.task_id;
const runId = '22222222-2222-4222-8222-222222222222';
const sourceVersionId = frozen1651.selections[0]!.source_id;
const anchorId = '33333333-3333-4333-8333-333333333333';
const item = {
  kind: 'source_excerpt' as const,
  selection_id: '44444444-4444-4444-8444-444444444444',
  text: '甲方应于验收后30日内支付合同价款。',
  content_sha256: 'a'.repeat(64),
  source_ref: { source_version_id: sourceVersionId, anchor_id: anchorId },
  asset_sha256: 'b'.repeat(64),
  role: 'original_quote' as const,
};
const manifest = selectedInputManifestSchema.parse({
  manifest_id: manifestId,
  task_id: taskId,
  task_version: 1,
  run_id: runId,
  provider: 'deepseek',
  model: 'deepseek-flash',
  instruction: frozen1651.instruction,
  selected: [item],
  excluded: [{ object_id: '55555555-5555-4555-8555-555555555555', reason: 'OTHER_TASK' }],
  payload_text: renderSelectedInput(frozen1651.instruction, [item]),
  payload_sha256: 'c'.repeat(64),
  confirmed_preview_id: frozen1651.id,
});

describe('DEV-1758 PLH-03 manifest and EvidenceRef compatibility', () => {
  it('projects 1580 manifest selections into harness EvidenceRefs with fixed roles and read scopes', () => {
    const index = manifestEvidenceIndexFromManifest(manifest);
    expect(index.manifest_id).toBe(manifestId);
    expect(index.evidence_refs).toHaveLength(1);
    expect(index.evidence_refs[0]).toMatchObject({
      role: 'original_quote',
      read_scope: 'selected_pages',
      source_ref: item.source_ref,
    });
  });

  it('rejects EvidenceRef rows that mix user text with material bindings', () => {
    const refs = evidenceRefsFromManifest(manifest);
    expect(
      previewSelectionCoversEvidenceRef(frozen1651, {
        ...refs[0]!,
        material_binding: {
          source_id: '99999999-9999-4999-8999-999999999999',
          derivation_id: frozen1651.selections[0]!.derivation_id,
          asset_sha256: 'd'.repeat(64),
          pages: [1],
        },
      }),
    ).toBe(false);
  });

  it('aligns manifest material evidence with the frozen DEV-1651 preview selection', () => {
    const bound = bind1651MaterialEvidence(item, frozen1651);
    expect(previewSelectionCoversEvidenceRef(frozen1651, bound)).toBe(true);
    expect(manifestEvidenceAlignedWith1651Preview(manifest, frozen1651)).toBe(true);
    const crossTask = { ...manifest, task_id: '66666666-6666-4666-8666-666666666666' };
    expect(manifestEvidenceAlignedWith1651Preview(crossTask, frozen1651)).toBe(false);
  });

  it('records known gaps before 1651 preview can become a full 1580 manifest consumer', () => {
    const gaps = materialPreviewCompatGaps(frozen1651);
    expect(gaps).toContain('MISSING_MANIFEST_ID');
    expect(gaps).toContain('PAGE_SCOPE_UNVERIFIED');
    const overBudget = materialPreviewSchema.parse({
      ...frozen1651,
      payload: 'x'.repeat(4001),
    });
    expect(materialPreviewCompatGaps(overBudget)).toContain('PAYLOAD_BUDGET_MISMATCH');
  });
});
