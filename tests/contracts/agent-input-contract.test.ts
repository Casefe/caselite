import { describe, expect, it } from 'vitest';
import {
  candidateDecisionSchema,
  candidateIsWithinManifest,
  draftCandidateSchema,
  providerProfileSchema,
  readToolPolicySchema,
  renderSelectedInput,
  selectedInputManifestSchema,
} from '../../packages/contracts/src/agent-input';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const item = {
  kind: 'source_excerpt' as const,
  selection_id: id,
  text: '合成合同付款条款，仍待核验',
  content_sha256: 'a'.repeat(64),
  source_ref: { source_version_id: id, anchor_id: id },
  asset_sha256: 'b'.repeat(64),
  role: 'original_quote' as const,
};
const manifest = {
  manifest_id: id,
  task_id: id,
  task_version: 1,
  run_id: id,
  provider: 'deepseek',
  model: 'deepseek-flash',
  instruction: '列出矛盾和缺件',
  selected: [item],
  excluded: [{ object_id: other, reason: 'OTHER_TASK' }],
  payload_text: renderSelectedInput('列出矛盾和缺件', [item]),
  payload_sha256: 'c'.repeat(64),
  confirmed_preview_id: id,
};
describe('frozen Agent input and candidate design contract', () => {
  it('ties one model/provider and blocks secrets, retries and arbitrary tools in DTOs', () => {
    const profile = {
      profile_id: id,
      provider: 'deepseek',
      model: 'deepseek-flash',
      credential_ref: id,
      max_output_tokens: 2048,
      automatic_retries: 0,
    };
    expect(providerProfileSchema.safeParse(profile).success).toBe(true);
    for (const patch of [{ key: 'synthetic' }, { provider: 'openai' }, { automatic_retries: 1 }])
      expect(providerProfileSchema.safeParse({ ...profile, ...patch }).success).toBe(false);
    expect(
      readToolPolicySchema.safeParse({
        manifest_id: id,
        tools: ['shell'],
        allow_discovery: false,
        allow_effects: false,
      }).success,
    ).toBe(false);
  });

  it('rejects changed preview, unsupported roles, repeated identities or an oversized payload', () => {
    expect(selectedInputManifestSchema.safeParse(manifest).success).toBe(true);
    for (const patch of [
      { payload_text: manifest.payload_text + '\n未选材料' },
      { selected: [{ ...item, role: 'FAILED_ONLY' }] },
      {
        selected: [item, item],
        payload_text: renderSelectedInput(manifest.instruction, [item, item]),
      },
      { payload_text: 'x'.repeat(4001) },
      { provider: 'openai' },
    ])
      expect(selectedInputManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
  });

  it('binds candidate references to this Task, Run, Manifest and selected fixed sources', () => {
    const parsed = selectedInputManifestSchema.parse(manifest);
    const candidate = draftCandidateSchema.parse({
      candidate_id: id,
      run_id: id,
      task_id: id,
      manifest_id: id,
      text: '内部沟通初稿，待核对',
      source_refs: [item.source_ref],
      status: 'preview',
    });
    expect(candidateIsWithinManifest(parsed, candidate)).toBe(true);
    for (const patch of [
      { task_id: other },
      { run_id: other },
      { manifest_id: other },
      { source_refs: [{ ...item.source_ref, anchor_id: other }] },
    ])
      expect(candidateIsWithinManifest(parsed, { ...candidate, ...patch })).toBe(false);
  });

  it('only permits rejecting or accepting as new; never accepts an overwrite target', () => {
    const command = {
      candidate_id: id,
      task_id: id,
      decision: 'accept_as_new_document',
      idempotency_key: id,
    };
    expect(candidateDecisionSchema.safeParse(command).success).toBe(true);
    expect(candidateDecisionSchema.safeParse({ ...command, document_id: other }).success).toBe(
      false,
    );
    expect(candidateDecisionSchema.safeParse({ ...command, decision: 'overwrite' }).success).toBe(
      false,
    );
  });
});
