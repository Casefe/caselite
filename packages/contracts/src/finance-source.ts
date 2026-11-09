import { z } from 'zod';
import { ordinaryDateSchema } from './task';
const id = z.uuid();
export const financeSourceClaimSchema = z.strictObject({
  candidate_id: id,
  confirmed: z.literal(true),
});
export const financeSourceReferenceSchema = z.strictObject({
  project_id: id,
  source_id: id,
  asset_version_id: id,
  derivation_id: id,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().min(1).max(200),
});
export const financeCandidateSchema = financeSourceReferenceSchema.extend({
  id,
  name: z.string(),
  quote: z.string().max(8000),
  kind: z.enum(['contract', 'payment', 'invoice', 'expense', 'unknown']),
  amount_options: z.array(z.number().int().positive().max(1_000_000_000_000)).max(100),
  date_options: z.array(ordinaryDateSchema).max(100),
  reference: z.string().nullable(),
  status: z.enum(['pending', 'confirmed', 'dismissed']),
  confirmed_target_id: id.nullable(),
  created_at: z.iso.datetime(),
});
export const financeSourceLinkSchema = z.object({
  candidate_id: id,
  project_id: id,
  operation: z.string(),
  target_id: id,
  edited: z.boolean(),
  created_at: z.iso.datetime(),
});
export type FinanceSourceClaim = z.infer<typeof financeSourceClaimSchema>;
export type FinanceSourceReference = z.infer<typeof financeSourceReferenceSchema>;
export type FinanceCandidate = z.infer<typeof financeCandidateSchema>;
