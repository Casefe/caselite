import { z } from 'zod';
import { ordinaryDateSchema } from './task';
import { financeSourceClaimSchema } from './finance-source';
export * from './finance-source';
import { financeManagementSuccessSchema } from './finance-management';
export * from './finance-management';

export const FINANCE_CHANNEL = 'caselite:finance:v1';
const id = z.uuid();
const cents = z.number().int().positive();
const balance = z.number().int().nonnegative();
const base = { protocol_version: z.literal(1), project_id: id };
const write = { ...base, request_id: id, idempotency_key: id };
const writeOperation = z.enum(['register_contract', 'record_payment', 'reverse_payment']);
export const financeEvidenceSchema = z.object({
  operation: writeOperation,
  target_id: id,
  activity_id: id,
});
const installment = z.strictObject({ amount_cents: cents, due_date: ordinaryDateSchema });
export const financeRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('read') }),
  z.strictObject({ ...base, operation: z.literal('status'), idempotency_key: id }),
  z.strictObject({
    ...write,
    operation: z.literal('register_contract'),
    source: financeSourceClaimSchema.optional(),
    number: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !value.includes('\0')),
    amount_cents: cents,
    installments: z.array(installment).min(1).max(100),
  }),
  z.strictObject({
    ...write,
    operation: z.literal('record_payment'),
    occurred_on: ordinaryDateSchema.optional(),
    note: z.string().trim().max(1000).optional(),
    source: financeSourceClaimSchema.optional(),
    installment_id: id,
    amount_cents: cents,
  }),
  z.strictObject({ ...write, operation: z.literal('reverse_payment'), payment_id: id }),
]);
const detail = z.object({
  number: z.string(),
  source_candidate_id: id.nullable().optional(),
  amount_cents: cents,
  outstanding_cents: balance,
  due_cents: balance,
  installments: z.array(installment.extend({ id, outstanding_cents: balance })),
  payments: z.array(
    z.object({
      id,
      installment_id: id,
      amount_cents: cents,
      committed_at: z.iso.datetime(),
      occurred_on: ordinaryDateSchema.nullable().optional(),
      note: z.string().optional(),
      source_candidate_id: id.nullable().optional(),
      reversed_at: z.iso.datetime().nullable(),
    }),
  ),
});
export const financeResponseSchema = z.union([
  financeManagementSuccessSchema,
  z.object({
    ok: z.literal(true),
    kind: z.literal('ledger'),
    project_id: id,
    receipt: id.nullable(),
    evidence: financeEvidenceSchema.nullable(),
    today: ordinaryDateSchema,
    time_zone: z.string(),
    ledger: detail.nullable(),
  }),
  z.object({
    ok: z.literal(true),
    kind: z.literal('status'),
    project_id: id,
    receipt: id,
    evidence: financeEvidenceSchema.nullable(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'INVALID_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'FORBIDDEN',
      'UNAVAILABLE',
      'RESULT_UNKNOWN',
    ]),
    message: z.string(),
  }),
]);
export type FinanceRequest = z.infer<typeof financeRequestSchema>;
export type FinanceResponse = z.infer<typeof financeResponseSchema>;
