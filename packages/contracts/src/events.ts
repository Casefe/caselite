import { z } from 'zod';

import { IPC_PROTOCOL_VERSION } from './commands';

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const domainEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum(['matter.created', 'anchor.created']),
  schema_version: z.literal(IPC_PROTOCOL_VERSION),
  aggregate_type: z.enum(['matter', 'anchor']),
  aggregate_id: opaqueIdSchema,
  workspace_id: opaqueIdSchema,
  occurred_at: z.string().datetime(),
  payload: z.object({
    matter_id: opaqueIdSchema.optional(),
    source_version_id: opaqueIdSchema.optional(),
  }),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
