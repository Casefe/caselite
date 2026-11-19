import { describe, expect, it } from 'vitest';
import {
  renderSelectedInput,
  selectedInputItemSchema,
  selectedInputManifestSchema,
  type SelectedInputItem,
  type SelectedInputManifest,
} from '../../packages/contracts/src/agent-input';
import { pdfAnchorSchema } from '../../packages/contracts/src/source';

// DEV-1758试做：EvidenceRef在本仓库尚无正式合同，下面是测试内的最小投影，
// 只验证1651冻结Manifest能否无损、不升级角色地映射到证据引用，不是新接口或第二来源库。
type EvidenceRole =
  | 'original_quote'
  | 'ocr_candidate'
  | 'document_text'
  | 'personal_note'
  | 'previous_candidate'
  | 'user_message'
  | 'user_correction'
  | 'accepted_candidate';
type EvidenceRef = {
  evidence_id: string;
  role: EvidenceRole;
  fixed_version: string;
  content_sha256: string;
};

const roleOf = (item: SelectedInputItem): EvidenceRole | null => {
  switch (item.kind) {
    case 'user_text':
      return null;
    case 'source_excerpt':
      return item.role;
    case 'document':
      return item.role;
    case 'task_message':
      return {
        user: 'user_message',
        correction: 'user_correction',
        accepted_candidate: 'accepted_candidate',
      }[item.role] as EvidenceRole;
  }
};
const versionOf = (item: SelectedInputItem) => {
  switch (item.kind) {
    case 'user_text':
      return null;
    case 'source_excerpt':
      return `source:${item.source_ref.source_version_id}:${item.source_ref.anchor_id}:${item.asset_sha256}`;
    case 'document':
      return `document:${item.document_id}:${item.body_id}:r${item.body_revision}`;
    case 'task_message':
      return `message:${item.message_id}:r${item.message_revision}`;
  }
};

function toEvidenceRefs(manifest: SelectedInputManifest): EvidenceRef[] {
  return manifest.selected.flatMap((item) => {
    const role = roleOf(item);
    const fixed_version = versionOf(item);
    if (role === null || fixed_version === null) return [];
    return [
      { evidence_id: item.selection_id, role, fixed_version, content_sha256: item.content_sha256 },
    ];
  });
}

const uuid = (n: number | string) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const sha = (c: string) => c.repeat(64);
const selection = (n: number, text: string) => ({
  selection_id: uuid(n),
  text,
  content_sha256: sha(String(n)),
});

const items: SelectedInputItem[] = [
  { kind: 'user_text', ...selection(1, '请核对付款条款') },
  {
    kind: 'source_excerpt',
    ...selection(2, '合成条款原文'),
    source_ref: { source_version_id: uuid(3), anchor_id: uuid(4) },
    asset_sha256: sha('b'),
    role: 'original_quote',
  },
  {
    kind: 'source_excerpt',
    ...selection(5, '合成条款OCR候选'),
    source_ref: { source_version_id: uuid(3), anchor_id: uuid(6) },
    asset_sha256: sha('b'),
    role: 'ocr_candidate',
  },
  {
    kind: 'document',
    ...selection(7, '文档正文'),
    document_id: uuid(8),
    body_id: uuid(9),
    body_revision: 3,
    role: 'personal_note',
  },
  {
    kind: 'task_message',
    ...selection(2 + 7, '用户更正'),
    message_id: uuid(1 + 1 + 1),
    message_revision: 2,
    role: 'correction',
  },
];

const buildManifest = (
  selected: SelectedInputItem[],
  excluded: SelectedInputManifest['excluded'] = [],
): SelectedInputManifest =>
  selectedInputManifestSchema.parse({
    manifest_id: uuid(1),
    task_id: uuid(2),
    task_version: 1,
    run_id: uuid(3),
    provider: 'deepseek',
    model: 'deepseek-flash',
    instruction: '列出矛盾和缺件',
    selected,
    excluded,
    payload_text: renderSelectedInput('列出矛盾和缺件', selected),
    payload_sha256: sha('c'),
    confirmed_preview_id: uuid(4),
  });

describe('DEV-1758 Manifest to EvidenceRef compatibility (test-local projection)', () => {
  it('projects every non-instruction selected item one-to-one with a fixed version and hash', () => {
    const manifest = buildManifest(items);
    const refs = toEvidenceRefs(manifest);
    expect(refs).toHaveLength(items.length - 1);
    expect(new Set(refs.map((ref) => ref.evidence_id)).size).toBe(refs.length);
    expect(refs.map((ref) => ref.role)).toEqual([
      'original_quote',
      'ocr_candidate',
      'personal_note',
      'user_correction',
    ]);
    for (const ref of refs) {
      expect(ref.fixed_version).toMatch(/^(source|document|message):/);
      expect(ref.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(refs[2].fixed_version).toContain(':r3');
  });

  it('never carries excluded objects into evidence and keeps OCR distinct from the original quote', () => {
    const manifest = buildManifest(items, [
      { object_id: uuid('d'), reason: 'REPLACED_OLD' },
      { object_id: uuid('e'), reason: 'OTHER_TASK' },
    ]);
    const refs = toEvidenceRefs(manifest);
    expect(
      refs.some((ref) =>
        manifest.excluded.some(
          (e) => ref.evidence_id === e.object_id || ref.fixed_version.includes(e.object_id),
        ),
      ),
    ).toBe(false);
    const ocr = refs.find((ref) => ref.evidence_id === uuid(5));
    expect(ocr?.role).toBe('ocr_candidate');
    expect(ocr?.role).not.toBe('original_quote');
  });

  it('keeps repeated selection identities and unknown roles/kinds visible as failures', () => {
    expect(() => buildManifest([items[1], items[1]])).toThrow();
    expect(selectedInputItemSchema.safeParse({ ...items[1], role: 'verified_fact' }).success).toBe(
      false,
    );
    expect(selectedInputItemSchema.safeParse({ ...items[0], kind: 'annotation' }).success).toBe(
      false,
    );
  });

  it('exposes OCR role/anchor origin mismatch instead of silently trusting the Manifest role', () => {
    const geometry = {
      anchor_id: uuid(6),
      source_version_id: uuid(3),
      locator_version: 1 as const,
      page: {
        page_index: 0,
        display_label: '1',
        crop_box: [0, 0, 100, 100],
        rotation: 0,
        user_unit: 1,
      },
      quads: [],
      quote: '合成条款OCR候选',
      prefix: '',
      suffix: '',
      locator_granularity: 'page' as const,
    };
    const ocrAnchor = {
      ...geometry,
      text_origin: 'ocr_candidate' as const,
      text_derivation_id: uuid(7),
    };
    expect(pdfAnchorSchema.safeParse(ocrAnchor).success).toBe(true);
    expect(pdfAnchorSchema.safeParse({ ...ocrAnchor, text_derivation_id: null }).success).toBe(
      false,
    );
    const claimsExactText = { ...ocrAnchor, locator_granularity: 'text' as const };
    expect(pdfAnchorSchema.safeParse(claimsExactText).success).toBe(false);

    const compatible = (role: EvidenceRole, origin: 'pdf_text' | 'ocr_candidate') =>
      role === 'ocr_candidate'
        ? origin === 'ocr_candidate'
        : role !== 'original_quote' || origin === 'pdf_text';
    expect(compatible('original_quote', ocrAnchor.text_origin)).toBe(false);
    expect(compatible('ocr_candidate', ocrAnchor.text_origin)).toBe(true);
  });

  it('binds the evidence set to the frozen payload so a changed selection cannot reuse the old preview', () => {
    const manifest = buildManifest(items);
    expect(manifest.payload_text).toBe(
      renderSelectedInput(manifest.instruction, manifest.selected),
    );
    const dropped = items.slice(0, 2);
    expect(manifest.payload_text).not.toBe(renderSelectedInput(manifest.instruction, dropped));
    expect(selectedInputManifestSchema.safeParse({ ...manifest, selected: dropped }).success).toBe(
      false,
    );
  });
});
