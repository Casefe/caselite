/** 输入是宿主已选择并读取的文件，不代表本模块验证了真实目录或 ZIP。 */
export interface SkillInputFile {
  path: string;
  kind: 'file' | 'symlink';
  bytes: Uint8Array;
}
export interface SkillPreviewInput {
  files: readonly SkillInputFile[];
  priorCandidates?: readonly PriorCandidate[];
  priorManifestSha256?: readonly string[];
  cancelled?: boolean;
}
export interface PriorCandidate {
  id: string;
  kind: CandidateKind;
  name: string;
  rawSha256: string;
  normalizedSha256: string;
  /** 与当前转换器一致的归一化前 40 字符 SHA-256，仅供人工相似提示；不是隐私或完整相似性保证。 */
  similaritySha256?: string | null;
}
export type CandidateKind = 'method' | 'reference' | 'template' | 'rule';
export interface DuplicateHint {
  target: string;
  relation: 'exact-raw' | 'exact-normalized' | 'same-name' | 'similar';
  action: 'review';
}
export interface SkillCandidate {
  id: string;
  kind: CandidateKind;
  name: string;
  sourcePath: string;
  skillPath: string;
  sourceVersion: string | null;
  sourceLicense: string | null;
  sourceSha256: string;
  rawSha256: string;
  normalizedSha256: string;
  /** 短于 40 字符时为 null；宿主只能传递当前授权比较范围内的此类指纹。 */
  similaritySha256: string | null;
  sourceStartLine: number;
  text: string;
  reviewRequired: true;
  duplicates: DuplicateHint[];
}
export interface SkillFileRecord {
  path: string;
  sha256: string;
  bytes: number;
  classification: 'skill' | 'candidate' | 'quarantined' | 'unsupported';
}
export interface SkillPreview {
  status: 'preview';
  converterVersion: 'dev1923-preview-1';
  manifestSha256: string;
  exactManifestMatches: string[];
  files: SkillFileRecord[];
  skills: {
    path: string;
    sourceSha256: string;
    platform: string;
    name: string;
    description: string;
    license: string | null;
    metadata: Record<string, string>;
    rawFrontmatter: string;
    toolDeclarations: string[];
    unsupported: string[];
  }[];
  candidates: SkillCandidate[];
  warnings: string[];
}
export type SkillPreviewResult =
  SkillPreview | { status: 'cancelled' } | { status: 'rejected'; code: string };

import { z } from 'zod';

export const SKILLS_PREVIEW_CHANNEL = 'caselite:skills-preview';
export const SKILLS_PREVIEW_LIMITS = Object.freeze({
  files: 500,
  fileBytes: 5 * 1024 * 1024,
  totalBytes: 30 * 1024 * 1024,
});
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const pathSchema = z.string().min(1).max(4096);
const nameSchema = z.string().max(4096);
const textSchema = z.string().max(SKILLS_PREVIEW_LIMITS.fileBytes);
const kindSchema = z.enum(['method', 'reference', 'template', 'rule']);
const priorSchema = z
  .object({
    id: pathSchema,
    kind: kindSchema,
    name: nameSchema,
    rawSha256: hashSchema,
    normalizedSha256: hashSchema,
    similaritySha256: hashSchema.nullable().optional(),
  })
  .strict();
export const skillPreviewInputSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            path: pathSchema,
            kind: z.enum(['file', 'symlink']),
            bytes: z
              .instanceof(Uint8Array)
              .refine((value) => value.byteLength <= SKILLS_PREVIEW_LIMITS.fileBytes),
          })
          .strict(),
      )
      .max(SKILLS_PREVIEW_LIMITS.files),
    priorCandidates: z.array(priorSchema).max(500).optional(),
    priorManifestSha256: z.array(hashSchema).max(500).optional(),
    cancelled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.files.reduce((sum, file) => sum + file.bytes.byteLength, 0) <=
      SKILLS_PREVIEW_LIMITS.totalBytes,
  );
export const skillPreviewResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('rejected'), code: z.string().min(1).max(128) }).strict(),
  z
    .object({
      status: z.literal('preview'),
      converterVersion: z.literal('dev1923-preview-1'),
      manifestSha256: hashSchema,
      exactManifestMatches: z.array(hashSchema).max(500),
      files: z
        .array(
          z
            .object({
              path: pathSchema,
              sha256: hashSchema,
              bytes: z.number().int().min(0).max(SKILLS_PREVIEW_LIMITS.fileBytes),
              classification: z.enum(['skill', 'candidate', 'quarantined', 'unsupported']),
            })
            .strict(),
        )
        .max(500),
      skills: z
        .array(
          z
            .object({
              path: pathSchema,
              sourceSha256: hashSchema,
              platform: nameSchema,
              name: nameSchema,
              description: textSchema,
              license: textSchema.nullable(),
              metadata: z.record(z.string().max(4096), textSchema),
              rawFrontmatter: textSchema,
              toolDeclarations: z.array(textSchema).max(500),
              unsupported: z.array(textSchema).max(100000),
            })
            .strict(),
        )
        .max(500),
      candidates: z
        .array(
          z
            .object({
              id: pathSchema,
              kind: kindSchema,
              name: nameSchema,
              sourcePath: pathSchema,
              skillPath: pathSchema,
              sourceVersion: textSchema.nullable(),
              sourceLicense: textSchema.nullable(),
              sourceSha256: hashSchema,
              rawSha256: hashSchema,
              normalizedSha256: hashSchema,
              similaritySha256: hashSchema.nullable(),
              sourceStartLine: z.number().int().min(1),
              text: textSchema,
              reviewRequired: z.literal(true),
              duplicates: z
                .array(
                  z
                    .object({
                      target: pathSchema,
                      relation: z.enum(['exact-raw', 'exact-normalized', 'same-name', 'similar']),
                      action: z.literal('review'),
                    })
                    .strict(),
                )
                .max(1000),
            })
            .strict(),
        )
        .max(100),
      warnings: z.array(textSchema).max(100000),
    })
    .strict(),
]);
