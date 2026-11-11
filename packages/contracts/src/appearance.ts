import { z } from 'zod';

export const APPEARANCE_CHANNEL = 'caselite:appearance:v1';
export const APPEARANCE_INITIAL_CHANNEL = 'caselite:appearance-initial:v1';
export const themeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof themeSchema>;
export const themeProposalSchema = z.object({ theme: themeSchema }).strict();
export const themeCommandSchema = z
  .object({
    id: z.string().uuid(),
    before: themeSchema,
    after: themeSchema,
    state: z.enum(['pending', 'saved', 'unknown', 'unchanged', 'rejected', 'undone']),
    can_undo: z.boolean(),
    current: z.boolean().optional(),
    message: z.string().max(300),
  })
  .strict();
export type ThemeCommand = z.infer<typeof themeCommandSchema>;

// 全句白名单只授予明确的本次动作；资料、否定、咨询和混合句不获得写权限。
export function explicitThemeTarget(prompt: string): Theme | undefined {
  const match =
    /^(?:请)?(?:(?:把|将)(?:CaseLite|界面|主题)(?:的主题)?(?:调整|切换|设置|改|调)(?:成|为|到)|(?:调整|切换|设置|改|调)(?:成|为|到|回)|切换到)(深色|浅色)(?:主题|模式)?[。！!]?$/iu.exec(
      prompt.trim().replace(/[ \t]/g, ''),
    );
  return match ? (match[1] === '深色' ? 'dark' : 'light') : undefined;
}
export const appearanceRequestSchema = z.discriminatedUnion('operation', [
  z.object({ protocol_version: z.literal(1), operation: z.literal('read') }).strict(),
  z
    .object({ protocol_version: z.literal(1), operation: z.literal('set'), theme: themeSchema })
    .strict(),
  z
    .object({ protocol_version: z.literal(1), operation: z.literal('applied'), theme: themeSchema })
    .strict(),
]);
export type AppearanceRequest = z.infer<typeof appearanceRequestSchema>;
export const appearanceResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({ ok: z.literal(true), theme: themeSchema, command: themeCommandSchema.optional() })
    .strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict(),
]);
export type AppearanceResponse = z.infer<typeof appearanceResponseSchema>;
