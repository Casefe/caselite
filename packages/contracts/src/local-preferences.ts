import { z } from 'zod';

export const LOCAL_PREFERENCES_CHANNEL = 'caselite:local-preferences:v1';
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
export type LocalPreferences = z.infer<typeof localPreferencesSchema>;
export type LocalPreferencesRequest = z.infer<typeof localPreferencesRequestSchema>;
export type LocalPreferencesResponse = z.infer<typeof localPreferencesResponseSchema>;
export type WorkspaceLocations = z.infer<typeof workspaceLocationsSchema>;
