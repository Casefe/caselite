import { z } from 'zod';

import { domainEventSchema } from './events';
import { applicationErrorSchema } from './errors';

const commandSuccessSchema = z.object({
  entity_id: z.string().min(1).max(128),
  new_version: z.number().int().positive(),
  domain_events: z.array(domainEventSchema).min(1),
  local_save_status: z.literal('not-persisted'),
  warnings: z.array(z.string().min(1).max(240)).min(1),
});

export const createMatterResponseSchema = commandSuccessSchema.extend({
  entity_kind: z.literal('matter'),
});

export const createAnchorResponseSchema = commandSuccessSchema.extend({
  entity_kind: z.literal('anchor'),
});

export const commandFailureSchema = z.object({
  ok: z.literal(false),
  error: applicationErrorSchema,
});

export const createMatterResultSchema = z.union([
  z.object({ ok: z.literal(true), value: createMatterResponseSchema }),
  commandFailureSchema,
]);

export const createAnchorResultSchema = z.union([
  z.object({ ok: z.literal(true), value: createAnchorResponseSchema }),
  commandFailureSchema,
]);

export type CreateMatterResponse = z.infer<typeof createMatterResponseSchema>;
export type CreateAnchorResponse = z.infer<typeof createAnchorResponseSchema>;
export type CreateMatterResult = z.infer<typeof createMatterResultSchema>;
export type CreateAnchorResult = z.infer<typeof createAnchorResultSchema>;
export type CommandFailure = z.infer<typeof commandFailureSchema>;
