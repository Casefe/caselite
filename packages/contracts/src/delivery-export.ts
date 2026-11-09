import { z } from 'zod';

export const deliveryFormatSchema = z.enum(['docx', 'pdf']);
export const deliveryConverters = {
  docx: 'docx-9.15.3-v1',
  pdf: 'electron-45.1.0-pdf-v2',
} as const;
export type DeliveryExportFormat = z.infer<typeof deliveryFormatSchema>;

export const deliveryExportSchema = z
  .object({
    id: z.string().uuid(),
    snapshot_id: z.string().uuid(),
    format: deliveryFormatSchema,
    converter: z.enum(['docx-9.15.3-v1', 'electron-45.1.0-pdf-v1', 'electron-45.1.0-pdf-v2']),
    status: z.enum(['pending', 'ready']),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    bytes: z.number().int().positive().max(20_000_000).nullable(),
    created_at: z.iso.datetime(),
  })
  .strict()
  .refine((row) =>
    row.format === 'docx'
      ? row.converter === deliveryConverters.docx
      : row.converter !== deliveryConverters.docx,
  )
  .refine((row) => row.status === 'pending' || (row.sha256 !== null && row.bytes !== null));
export type DeliveryExport = z.infer<typeof deliveryExportSchema>;
