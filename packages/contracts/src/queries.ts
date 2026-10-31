import { z } from 'zod';

export const listMattersQuerySchema = z.object({
  protocol_version: z.literal(1),
  workspace_id: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  cursor: z.string().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const listMattersQueryResponseSchema = z.object({
  items: z.array(
    z.object({
      matter_id: z.string().min(1).max(128),
      title: z.string().min(1).max(160),
      version: z.number().int().positive(),
    }),
  ),
  next_cursor: z.string().min(1).max(256).nullable(),
  snapshot_version: z.number().int().nonnegative(),
  stale: z.boolean(),
});
