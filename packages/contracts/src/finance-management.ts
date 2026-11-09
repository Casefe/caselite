import { z } from 'zod';
import { ordinaryDateSchema } from './task';

const id = z.uuid();
const amount = z.number().int().nonnegative().max(1_000_000_000_000);
const positive = amount.refine((value) => value > 0);
const text = (length: number) =>
  z
    .string()
    .trim()
    .max(length)
    .refine((value) => !/[\p{Cc}]/u.test(value));
const ruleValues = {
  name: text(80).refine(Boolean),
  firm_name: text(80).refine(Boolean),
  method: z.enum(['firm_percent', 'lawyer_percent', 'net_lawyer', 'annual_tier', 'annual_cap']),
  rate_bps: z.number().int().min(0).max(10_000),
  second_rate_bps: z.number().int().min(0).max(10_000),
  threshold_cents: amount,
  cap_cents: amount,
  settlement_trigger: z.enum(['receipt', 'approval']),
  effective_date: ordinaryDateSchema,
  annual_year: z.number().int().min(2000).max(9999),
  opening_base_cents: amount,
  opening_firm_cents: amount,
  annual_data_confirmed: z.boolean(),
};
export const financeRuleValuesSchema = z.strictObject(ruleValues);
export const financeRuleSchema = financeRuleValuesSchema.extend({
  id,
  created_at: z.iso.datetime(),
});
export type FinanceRule = z.infer<typeof financeRuleSchema>;
const keys = { request_id: id, idempotency_key: id };
const protocol = { protocol_version: z.literal(1) };
const project = { project_id: id };
const allocation = {
  ...project,
  payment_id: id,
  rule_id: id,
  pre_tax_cents: amount,
  pre_cost_cents: amount,
  post_deduction_cents: amount,
  deductions_confirmed: z.literal(true),
  occurred_on: ordinaryDateSchema,
  note: text(1000),
};
const invoiceFields = {
  ...project,
  installment_id: id,
  invoice_number: text(80).refine(Boolean),
  amount_cents: positive,
  occurred_on: ordinaryDateSchema,
  note: text(1000),
};
export const financeInvoiceSchema = z.object({
  id,
  ...invoiceFields,
  kind: z.enum(['invoice', 'red_invoice']),
  original_invoice_id: id.nullable(),
  created_at: z.iso.datetime(),
});
const party = z.enum(['lawyer', 'firm', 'client']);
const expenseFields = {
  ...project,
  description: text(160).refine(Boolean),
  category: z.enum(['case_cost', 'travel', 'client_advance', 'other']),
  payer: party,
  bearer: party,
  payee: text(80).refine(Boolean),
  reimbursable: z.boolean(),
  amount_cents: positive,
  occurred_on: ordinaryDateSchema,
  note: text(1000),
};
export const financeExpenseSchema = z.object({
  id,
  ...expenseFields,
  created_at: z.iso.datetime(),
  reversed_at: z.iso.datetime().nullable(),
});
export const financeReimbursementSchema = z.object({
  id,
  ...project,
  expense_id: id,
  amount_cents: positive,
  occurred_on: ordinaryDateSchema,
  note: text(1000),
  from_party: party,
  to_party: party,
  created_at: z.iso.datetime(),
  reversed_at: z.iso.datetime().nullable(),
});
export const financeManagementRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...protocol, operation: z.literal('m_read') }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...expenseFields,
    operation: z.literal('m_record_expense'),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_record_reimbursement'),
    expense_id: id,
    amount_cents: positive,
    occurred_on: ordinaryDateSchema,
    note: text(1000),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_reverse_expense'),
    expense_id: id,
    note: text(1000).refine(Boolean),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_reverse_reimbursement'),
    reimbursement_id: id,
    note: text(1000).refine(Boolean),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...invoiceFields,
    operation: z.literal('m_record_invoice'),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...invoiceFields,
    original_invoice_id: id,
    operation: z.literal('m_red_invoice'),
  }),
  z.strictObject({ ...protocol, operation: z.literal('m_status'), idempotency_key: id }),
  z.strictObject({
    ...protocol,
    ...keys,
    operation: z.literal('m_save_rule'),
    values: financeRuleValuesSchema,
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    operation: z.literal('m_set_default'),
    rule_id: id.nullable(),
    expected_version: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_bind_rule'),
    rule_id: id,
    expected_rule_id: id.nullable(),
  }),
  z.strictObject({ ...protocol, ...allocation, operation: z.literal('m_preview_allocation') }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...allocation,
    expected_preview_digest: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.literal('m_allocate'),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_record_payout'),
    allocation_id: id,
    amount_cents: positive,
    occurred_on: ordinaryDateSchema,
    note: text(1000),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_reverse_payout'),
    payout_id: id,
    note: text(1000).refine(Boolean),
  }),
  z.strictObject({
    ...protocol,
    ...keys,
    ...project,
    operation: z.literal('m_reverse_allocation'),
    allocation_id: id,
    note: text(1000).refine(Boolean),
  }),
]);
export type FinanceManagementRequest = z.infer<typeof financeManagementRequestSchema>;
export const financeAllocationSchema = z.object({
  id,
  project_id: id,
  installment_id: id,
  payment_id: id,
  rule_id: id,
  base_cents: amount,
  pre_tax_cents: amount,
  pre_cost_cents: amount,
  distributable_cents: amount,
  firm_cents: amount,
  lawyer_cents: amount,
  post_deduction_cents: amount,
  payable_cents: amount,
  occurred_on: ordinaryDateSchema,
  created_at: z.iso.datetime(),
  note: z.string(),
  reversed_at: z.iso.datetime().nullable(),
});
export type FinanceAllocation = z.infer<typeof financeAllocationSchema>;
export const financeManagementStateSchema = z.object({
  version: z.number().int().nonnegative(),
  default_rule_id: id.nullable(),
  projects: z.array(
    z.object({
      project_id: id,
      amount_cents: z.number().int().nonnegative(),
      received_cents: z.number().int().nonnegative(),
      outstanding_cents: z.number().int().nonnegative(),
    }),
  ),
  rules: z.array(financeRuleSchema),
  bindings: z.array(z.object({ project_id: id, rule_id: id })),
  allocations: z.array(financeAllocationSchema),
  invoices: z.array(financeInvoiceSchema),
  expenses: z.array(financeExpenseSchema),
  reimbursements: z.array(financeReimbursementSchema),
  payouts: z.array(
    z.object({
      id,
      project_id: id,
      allocation_id: id,
      amount_cents: positive,
      occurred_on: ordinaryDateSchema,
      note: z.string(),
      created_at: z.iso.datetime(),
      reversed_at: z.iso.datetime().nullable(),
    }),
  ),
});
export type FinanceManagementState = z.infer<typeof financeManagementStateSchema>;
export const financeManagementSuccessSchema = z.object({
  ok: z.literal(true),
  kind: z.literal('management'),
  receipt: id.nullable(),
  evidence: z.object({ operation: z.string(), target_id: id, event_id: id }).nullable(),
  state: financeManagementStateSchema,
  effect: z.record(z.string(), z.unknown()).nullable(),
  preview_digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  preview: financeAllocationSchema
    .omit({ id: true, created_at: true, reversed_at: true })
    .optional(),
});
export type FinanceManagementSuccess = z.infer<typeof financeManagementSuccessSchema>;
