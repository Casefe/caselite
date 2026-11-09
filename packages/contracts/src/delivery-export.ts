import { z } from 'zod';
import { exportConfigurationSchema } from './export-style';

export const deliveryFormatSchema = z.enum(['docx', 'pdf']);
export const deliveryConverters = {
  docx: 'docx-9.15.3-v1',
  pdf: 'electron-45.1.0-pdf-v2',
} as const;
export const configuredDeliveryConverters = {
  docx: 'docx-9.15.3-v2',
  pdf: 'electron-45.1.0-pdf-v3',
} as const;
export type DeliveryExportFormat = z.infer<typeof deliveryFormatSchema>;

export const deliveryExportSchema = z
  .object({
    id: z.string().uuid(),
    snapshot_id: z.string().uuid(),
    format: deliveryFormatSchema,
    converter: z.enum([
      'docx-9.15.3-v1',
      'docx-9.15.3-v2',
      'electron-45.1.0-pdf-v1',
      'electron-45.1.0-pdf-v2',
      'electron-45.1.0-pdf-v3',
    ]),
    configuration: exportConfigurationSchema.optional(),
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
      ? row.converter === deliveryConverters.docx ||
        row.converter === configuredDeliveryConverters.docx
      : row.converter.startsWith('electron-'),
  )
  .refine(
    (row) =>
      Boolean(row.configuration) ===
      Object.values(configuredDeliveryConverters).some((converter) => converter === row.converter),
  )
  .refine((row) => row.status === 'pending' || (row.sha256 !== null && row.bytes !== null));
export type DeliveryExport = z.infer<typeof deliveryExportSchema>;
