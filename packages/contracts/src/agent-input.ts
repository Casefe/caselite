import { z } from 'zod';
import { agentModelSchema, agentProviderFor, agentProviderSchema } from './agent';
import { sourceRefSchema } from './source';

// DEV-1580最低设计合同；现有agent:v1尚未消费这些DTO，不改变Run存储Owner。
const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(4000);
const providerModel = { provider: agentProviderSchema, model: agentModelSchema };
const pairMatches = (item: { provider: string; model: z.infer<typeof agentModelSchema> }) =>
  agentProviderFor(item.model) === item.provider;

export const providerProfileSchema = z
  .object({
    profile_id: id,
    ...providerModel,
    credential_ref: id,
    max_output_tokens: z.literal(2048),
    automatic_retries: z.literal(0),
  })
  .strict()
  .refine(pairMatches, 'Provider and model must match');

const selection = { selection_id: id, text, content_sha256: hash };
export const selectedInputItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...selection, kind: z.literal('user_text') }).strict(),
  z
    .object({
      ...selection,
      kind: z.literal('document'),
      document_id: id,
      body_id: id,
      body_revision: z.number().int().nonnegative(),
      role: z.enum(['document_text', 'personal_note', 'previous_candidate']),
    })
    .strict(),
  z
    .object({
      ...selection,
      kind: z.literal('source_excerpt'),
      source_ref: sourceRefSchema,
      asset_sha256: hash,
      role: z.enum(['original_quote', 'ocr_candidate']),
    })
    .strict(),
  z
    .object({
      ...selection,
      kind: z.literal('task_message'),
      message_id: id,
      message_revision: z.number().int().positive(),
      role: z.enum(['user', 'correction', 'accepted_candidate']),
    })
    .strict(),
]);
export type SelectedInputItem = z.infer<typeof selectedInputItemSchema>;

export function renderSelectedInput(instruction: string, selected: SelectedInputItem[]) {
  return [
    `用户要求\n${instruction}`,
    ...selected.map(
      (item, index) =>
        `[${index + 1}:${item.kind}:${'role' in item ? item.role : 'user'}]\n${item.text}`,
    ),
  ].join('\n\n');
}

export const selectedInputManifestSchema = z
  .object({
    manifest_id: id,
    task_id: id,
    task_version: z.number().int().positive(),
    run_id: id,
    ...providerModel,
    instruction: text,
    selected: z.array(selectedInputItemSchema).max(32),
    excluded: z
      .array(
        z
          .object({
            object_id: id,
            reason: z.enum([
              'FAILED_ONLY',
              'REPLACED_OLD',
              'OTHER_TASK',
              'UNSELECTED',
              'INACCESSIBLE',
              'BUDGET',
            ]),
          })
          .strict(),
      )
      .max(100),
    payload_text: text,
    payload_sha256: hash,
    confirmed_preview_id: id,
  })
  .strict()
  .superRefine((manifest, context) => {
    if (!pairMatches(manifest))
      context.addIssue({ code: 'custom', message: 'Provider and model must match' });
    if (manifest.payload_text !== renderSelectedInput(manifest.instruction, manifest.selected))
      context.addIssue({ code: 'custom', message: 'Payload differs from the fixed preview' });
    const selectedIds = manifest.selected.map((item) => item.selection_id);
    if (new Set(selectedIds).size !== selectedIds.length)
      context.addIssue({ code: 'custom', message: 'Repeated selection identity' });
  });

// 1653的Run仍是唯一权威；这里只冻结其输入绑定增量，不另建Pi会话。
export const runInputBindingSchema = z
  .object({ run_id: id, task_id: id, manifest_id: id, payload_sha256: hash })
  .strict();
export const readToolPolicySchema = z
  .object({
    manifest_id: id,
    tools: z
      .array(
        z.enum(['read_selected_document', 'read_selected_source', 'read_selected_task_message']),
      )
      .max(3),
    allow_discovery: z.literal(false),
    allow_effects: z.literal(false),
  })
  .strict();
export const draftCandidateSchema = z
  .object({
    candidate_id: id,
    run_id: id,
    task_id: id,
    manifest_id: id,
    text: z.string().max(32_000),
    source_refs: z.array(sourceRefSchema).max(100),
    status: z.literal('preview'),
  })
  .strict();
export const candidateDecisionSchema = z
  .object({
    candidate_id: id,
    task_id: id,
    decision: z.enum(['reject', 'accept_as_new_document']),
    idempotency_key: id,
  })
  .strict();

export type SelectedInputManifest = z.infer<typeof selectedInputManifestSchema>;
export type DraftCandidate = z.infer<typeof draftCandidateSchema>;
export function candidateIsWithinManifest(
  manifest: SelectedInputManifest,
  candidate: DraftCandidate,
) {
  if (
    candidate.task_id !== manifest.task_id ||
    candidate.run_id !== manifest.run_id ||
    candidate.manifest_id !== manifest.manifest_id
  )
    return false;
  return candidate.source_refs.every((ref) =>
    manifest.selected.some(
      (item) =>
        item.kind === 'source_excerpt' &&
        item.source_ref.source_version_id === ref.source_version_id &&
        item.source_ref.anchor_id === ref.anchor_id,
    ),
  );
}
