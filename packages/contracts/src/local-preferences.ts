import { z } from 'zod';
import { exportStyleSchema } from './export-style';

export const LOCAL_PREFERENCES_CHANNEL = 'caselite:local-preferences:v1';
export const writingSkillSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9-]+$/),
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((value) => !/[\p{Cc}]/u.test(value)),
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(3000)
      .refine((value) => !value.includes('\0')),
    enabled: z.boolean(),
  })
  .strict();
export const writingSkillsSchema = z
  .array(writingSkillSchema)
  .max(20)
  .refine((skills) => new Set(skills.map((skill) => skill.id)).size === skills.length);
const statisticsCardPreferenceSchema = z
  .object({ enabled: z.boolean(), position: z.enum(['top', 'middle', 'bottom']) })
  .strict();
const statisticsCardsSchema = z
  .object({
    tasks: statisticsCardPreferenceSchema,
    projects: statisticsCardPreferenceSchema,
    finance: statisticsCardPreferenceSchema,
    contacts: statisticsCardPreferenceSchema,
  })
  .strict();
export const favoriteNavigationSchema = z
  .strictObject({
    folders: z
      .array(
        z.strictObject({
          id: z.uuid(),
          name: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .refine((v) => !/[\p{Cc}]/u.test(v)),
        }),
      )
      .max(100),
    references: z
      .array(
        z.strictObject({
          kind: z.enum(['task', 'project']),
          id: z.uuid(),
          folder_id: z.uuid().nullable(),
        }),
      )
      .max(2000),
    // 文档星标仍以 documents.favorite 为准；这里只保存收藏中的位置。
    document_folders: z.array(z.strictObject({ id: z.uuid(), folder_id: z.uuid() })).max(2000),
  })
  .refine((v) => {
    const folders = new Set(v.folders.map((f) => f.id));
    return (
      folders.size === v.folders.length &&
      new Set(v.references.map((r) => `${r.kind}:${r.id}`)).size === v.references.length &&
      new Set(v.document_folders.map((r) => r.id)).size === v.document_folders.length &&
      [...v.references, ...v.document_folders].every(
        (r) => r.folder_id === null || folders.has(r.folder_id),
      )
    );
  });
export const localPreferenceValuesSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) =>
        Array.from(value).every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      ),
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.union([z.literal(''), z.email()])),
    avatar: z.enum(['portrait', 'initials']),
    show_word_count: z.boolean(),
    // 保持旧请求和回执的字段形状，缺省方案由界面解释，不在解析时注入摘要。
    editor_mode: z.enum(['markdown', 'word']).optional(),
    // 可选字段不改写旧请求摘要；布局仍归当前工作区的同一偏好记录。
    calendar_layout: z
      .object({
        dates_width: z.number().min(220).max(460),
        inspector_width: z.number().min(280).max(560),
      })
      .strict()
      .optional(),
    // 缺省保留旧请求摘要；空数组明确表示用户移除了全部技能。
    writing_skills: writingSkillsSchema.optional(),
    // 省略时保留旧请求形状与已保存样式；缺省展示值不能注入旧幂等摘要。
    export_style: exportStyleSchema.optional(),
    // 缺省由显示消费者解释；不改变旧请求摘要和历史回执。
    statistics_cards: statisticsCardsSchema.optional(),
    favorite_navigation: favoriteNavigationSchema.optional(),
  })
  .strict();
export const localPreferencesSchema = localPreferenceValuesSchema.extend({
  version: z.number().int().nonnegative(),
});
export const defaultLocalPreferences = localPreferencesSchema.parse({
  name: '谭律师',
  email: '',
  avatar: 'portrait',
  show_word_count: false,
  version: 0,
});
export const workspaceLocationsSchema = z
  .object({
    database_file: z.string().min(1).max(4096),
    output_directory: z.string().min(1).max(4096),
  })
  .strict();
export const localPreferencesRequestSchema = z.discriminatedUnion('operation', [
  z.object({ protocol_version: z.literal(1), operation: z.literal('read') }).strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('status'),
      idempotency_key: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('set'),
      request_id: z.string().uuid(),
      idempotency_key: z.string().uuid(),
      expected_version: z.number().int().nonnegative(),
      values: localPreferenceValuesSchema,
    })
    .strict(),
]);
export const localPreferencesResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      preferences: localPreferencesSchema,
      receipt: z.string().uuid().nullable(),
      locations: workspaceLocationsSchema.optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum([
        'INVALID_REQUEST',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'READ_FAILED',
        'WRITE_FAILED',
        'RESULT_UNKNOWN',
      ]),
      message: z.string(),
    })
    .strict(),
]);
export type LocalPreferenceValues = z.infer<typeof localPreferenceValuesSchema>;
export type WritingSkill = z.infer<typeof writingSkillSchema>;
export type LocalPreferences = z.infer<typeof localPreferencesSchema>;
export type LocalPreferencesRequest = z.infer<typeof localPreferencesRequestSchema>;
export type LocalPreferencesResponse = z.infer<typeof localPreferencesResponseSchema>;
export type WorkspaceLocations = z.infer<typeof workspaceLocationsSchema>;
