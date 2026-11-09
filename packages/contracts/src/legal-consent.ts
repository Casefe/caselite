import { z } from 'zod';

export const LEGAL_CONSENT_CHANNEL = 'caselite:legal-consent:v1';
export const legalDocumentIdSchema = z.enum(['license', 'eula']);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const legalDocumentSchema = z
  .object({
    id: legalDocumentIdSchema,
    title: z.string().min(1),
    text: z.string().min(1),
    sha256: hashSchema,
  })
  .strict();
export type LegalDocument = z.infer<typeof legalDocumentSchema>;
export const legalBundleSchema = z
  .object({
    effective_date: z.literal('2026-11-09'),
    document_set_hash: hashSchema,
    documents: z.tuple([legalDocumentSchema, legalDocumentSchema]),
  })
  .strict();
export type LegalBundle = z.infer<typeof legalBundleSchema>;
export const legalReceiptSchema = z
  .object({
    version: z.literal(1),
    document_set_hash: hashSchema,
    license_sha256: hashSchema,
    eula_sha256: hashSchema,
    accepted_at: z.iso.datetime(),
  })
  .strict();
export type LegalReceipt = z.infer<typeof legalReceiptSchema>;
export const legalConsentRequestSchema = z.discriminatedUnion('operation', [
  z.object({ protocol_version: z.literal(1), operation: z.literal('read') }).strict(),
  z.object({ protocol_version: z.literal(1), operation: z.literal('decline') }).strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('accept'),
      document_set_hash: hashSchema,
      confirmed: z.literal(true),
      reviewed_documents: z.tuple([z.literal('license'), z.literal('eula')]),
    })
    .strict(),
]);
export type LegalConsentRequest = z.infer<typeof legalConsentRequestSchema>;
export const legalConsentResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      accepted: z.boolean(),
      bundle: legalBundleSchema,
    })
    .strict(),
  z.object({ ok: z.literal(false), message: z.string() }).strict(),
]);
export type LegalConsentResponse = z.infer<typeof legalConsentResponseSchema>;
