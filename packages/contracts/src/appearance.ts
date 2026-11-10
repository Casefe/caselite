import { z } from 'zod';

export const APPEARANCE_CHANNEL = 'caselite:appearance:v1';
export const APPEARANCE_INITIAL_CHANNEL = 'caselite:appearance-initial:v1';
export const themeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof themeSchema>;
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
  z.object({ ok: z.literal(true), theme: themeSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict(),
]);
export type AppearanceResponse = z.infer<typeof appearanceResponseSchema>;
