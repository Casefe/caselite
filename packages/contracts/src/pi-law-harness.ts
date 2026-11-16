import { z } from 'zod';
import type { MaterialPreview } from './material';
import type { SelectedInputItem, SelectedInputManifest } from './agent-input';
import { sourceRefSchema } from './source';

// DEV-1758试做：Pi-law harness 侧 EvidenceRef 与 1580 Manifest 的兼容投影；不创建第二输入装配或 IPC。
const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const evidenceRoleSchema = z.enum([
  'user_text',
  'original_quote',
  'ocr_candidate',
  'document_text',
  'personal_note',
  'correction',
  'accepted_candidate',
]);
export type EvidenceRole = z.infer<typeof evidenceRoleSchema>;

export const evidenceReadScopeSchema = z.enum([
  'selected_only',
  'selected_pages',
  'fixed_revision',
  'preview_payload',
]);
export type EvidenceReadScope = z.infer<typeof evidenceReadScopeSchema>;

export const materialEvidenceBindingSchema = z
  .object({
    source_id: id,
    derivation_id: id,
    asset_sha256: hash,
    pages: z.array(z.number().int().positive()).min(1).max(200),
  })
  .strict();

export const evidenceRefSchema = z
  .object({
    evidence_id: id,
    role: evidenceRoleSchema,
    content_sha256: hash,
    read_scope: evidenceReadScopeSchema,
    source_ref: sourceRefSchema.optional(),
    material_binding: materialEvidenceBindingSchema.optional(),
    document_id: id.optional(),
    body_id: id.optional(),
    body_revision: z.number().int().nonnegative().optional(),
    message_id: id.optional(),
    message_revision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((ref, context) => {
    const needsSource = ['original_quote', 'ocr_candidate'].includes(ref.role);
    if (needsSource && !ref.source_ref)
      context.addIssue({ code: 'custom', message: 'Material evidence requires a fixed SourceRef' });
    if (ref.role === 'user_text' && (ref.source_ref || ref.material_binding))
      context.addIssue({ code: 'custom', message: 'User text must not claim a material binding' });
  });

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const manifestEvidenceIndexSchema = z
  .object({
    manifest_id: id,
    payload_sha256: hash,
    evidence_refs: z.array(evidenceRefSchema).max(32),
  })
  .strict();

export type ManifestEvidenceIndex = z.infer<typeof manifestEvidenceIndexSchema>;

const manifestItemToEvidenceRef = (item: SelectedInputItem): EvidenceRef | undefined => {
  if (item.kind === 'user_text') {
    return evidenceRefSchema.parse({
      evidence_id: item.selection_id,
      role: 'user_text',
      content_sha256: item.content_sha256,
      read_scope: 'preview_payload',
    });
  }
  if (item.kind === 'document') {
    return evidenceRefSchema.parse({
      evidence_id: item.selection_id,
      role: item.role,
      content_sha256: item.content_sha256,
      read_scope: 'fixed_revision',
      document_id: item.document_id,
      body_id: item.body_id,
      body_revision: item.body_revision,
    });
  }
  if (item.kind === 'task_message') {
    return evidenceRefSchema.parse({
      evidence_id: item.selection_id,
      role: item.role,
      content_sha256: item.content_sha256,
      read_scope: 'fixed_revision',
      message_id: item.message_id,
      message_revision: item.message_revision,
    });
  }
  if (item.kind === 'source_excerpt') {
    return evidenceRefSchema.parse({
      evidence_id: item.selection_id,
      role: item.role,
      content_sha256: item.content_sha256,
      read_scope: 'selected_pages',
      source_ref: item.source_ref,
    });
  }
};

/** 1651 preview 为 1580 材料项补齐 derivation／页范围；不发生长读取。 */
export function bind1651MaterialEvidence(
  item: Extract<SelectedInputItem, { kind: 'source_excerpt' }>,
  preview: MaterialPreview,
): EvidenceRef {
  const row = preview.selections.find(
    (entry) => entry.source_id === item.source_ref.source_version_id,
  );
  if (!row) throw new Error('DEV-1651 preview does not cover this SourceRef');
  return evidenceRefSchema.parse({
    evidence_id: item.selection_id,
    role: item.role,
    content_sha256: item.content_sha256,
    read_scope: 'selected_pages',
    source_ref: item.source_ref,
    material_binding: {
      source_id: row.source_id,
      derivation_id: row.derivation_id,
      asset_sha256: item.asset_sha256,
      pages: row.pages,
    },
  });
}

/** 从 1580 Manifest 导出 Pi-law 可消费的 EvidenceRef 索引；不含二次读取或宿主授权。 */
export function evidenceRefsFromManifest(manifest: SelectedInputManifest): EvidenceRef[] {
  return manifest.selected
    .map(manifestItemToEvidenceRef)
    .filter((ref): ref is EvidenceRef => ref !== undefined);
}

export function manifestEvidenceIndexFromManifest(
  manifest: SelectedInputManifest,
): ManifestEvidenceIndex {
  return manifestEvidenceIndexSchema.parse({
    manifest_id: manifest.manifest_id,
    payload_sha256: manifest.payload_sha256,
    evidence_refs: evidenceRefsFromManifest(manifest),
  });
}

export type MaterialPreviewCompatGap =
  | 'PAYLOAD_BUDGET_MISMATCH'
  | 'MISSING_SOURCE_VERSION_BINDING'
  | 'MISSING_MANIFEST_ID'
  | 'MISSING_RUN_BINDING'
  | 'PAGE_SCOPE_UNVERIFIED';

/** 对照 DEV-1651 冻结 preview，列出 Manifest/EvidenceRef 接线前必须闭合的差异。 */
export function materialPreviewCompatGaps(preview: MaterialPreview): MaterialPreviewCompatGap[] {
  const gaps: MaterialPreviewCompatGap[] = [];
  if (!('manifest_id' in preview)) gaps.push('MISSING_MANIFEST_ID');
  if (preview.payload.length > 4000) gaps.push('PAYLOAD_BUDGET_MISMATCH');
  if (preview.selections.some((row) => row.source_id && !row.derivation_id))
    gaps.push('MISSING_SOURCE_VERSION_BINDING');
  if (!preview.task_id) gaps.push('MISSING_RUN_BINDING');
  gaps.push('PAGE_SCOPE_UNVERIFIED');
  return gaps;
}

export function previewSelectionCoversEvidenceRef(
  preview: MaterialPreview,
  ref: EvidenceRef,
): boolean {
  const binding = ref.material_binding;
  if (!binding) return ref.role === 'user_text';
  const row = preview.selections.find((item) => item.source_id === binding.source_id);
  if (!row) return false;
  if (row.derivation_id !== binding.derivation_id) return false;
  return binding.pages.every((page) => row.pages.includes(page));
}

/** Manifest 中列出的材料 EvidenceRef 必须能被同一轮 1651 preview _SELECTION 覆盖。 */
export function manifestEvidenceAlignedWith1651Preview(
  manifest: SelectedInputManifest,
  preview: MaterialPreview,
): boolean {
  if (manifest.task_id !== preview.task_id) return false;
  for (const item of manifest.selected) {
    if (item.kind !== 'source_excerpt') continue;
    const ref = bind1651MaterialEvidence(item, preview);
    if (!previewSelectionCoversEvidenceRef(preview, ref)) return false;
  }
  return true;
}
