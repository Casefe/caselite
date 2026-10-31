import { z } from 'zod';

import { commandFailureSchema } from './results';

// DEV-1566 only: fixed synthetic values, never a general database or file API.
export const offlineProbeRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    protocol_version: z.literal(1),
    action: z.literal('write'),
    record_id: z.literal('dev-1566-synthetic'),
    value: z.literal('offline-integration-verified'),
  }),
  z.strictObject({
    protocol_version: z.literal(1),
    action: z.literal('read'),
    record_id: z.literal('dev-1566-synthetic'),
  }),
]);

export const offlineProbeResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({
      record_id: z.literal('dev-1566-synthetic'),
      stored_value: z.string().nullable(),
      migration_count: z.number().int().nonnegative(),
    }),
  }),
  commandFailureSchema,
]);

export type OfflineProbeRequest = z.infer<typeof offlineProbeRequestSchema>;
export type OfflineProbeResult = z.infer<typeof offlineProbeResultSchema>;
