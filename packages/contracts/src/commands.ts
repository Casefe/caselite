import { z } from 'zod';

export const IPC_PROTOCOL_VERSION = 1 as const;

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const requestIdSchema = z.string().uuid();
const idempotencyKeySchema = z.string().uuid();

export const commandEnvelopeSchema = z.object({
  request_id: requestIdSchema,
  protocol_version: z.literal(IPC_PROTOCOL_VERSION),
  workspace_id: opaqueIdSchema,
  actor_id: opaqueIdSchema,
  device_id: opaqueIdSchema,
  idempotency_key: idempotencyKeySchema,
  expected_version: z.number().int().nonnegative(),
});

export const createMatterRequestSchema = commandEnvelopeSchema.extend({
  expected_version: z.literal(0),
  payload: z.object({
    title: z.string().trim().min(1).max(160),
  }),
});

export const createAnchorRequestSchema = commandEnvelopeSchema.extend({
  expected_version: z.literal(0),
  matter_id: opaqueIdSchema,
  payload: z.object({
    source_version_id: opaqueIdSchema,
    page_number: z.number().int().positive(),
    quoted_text: z.string().trim().min(1).max(3_000),
  }),
});

export type CreateMatterRequest = z.infer<typeof createMatterRequestSchema>;
export type CreateAnchorRequest = z.infer<typeof createAnchorRequestSchema>;
