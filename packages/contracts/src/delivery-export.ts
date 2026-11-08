import { z } from 'zod';

export const deliveryExportSchema = z
  .object({
    id: z.string().uuid(),
    snapshot_id: z.string().uuid(),
    format: z.literal('docx'),
    converter: z.literal('docx-9.15.3-v1'),
    status: z.enum(['pending', 'ready']),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    bytes: z.number().int().positive().max(20_000_000).nullable(),
    created_at: z.iso.datetime(),
  })
  .strict()
  .refine((row) => row.status === 'pending' || (row.sha256 !== null && row.bytes !== null));
export type DeliveryExport = z.infer<typeof deliveryExportSchema>;
