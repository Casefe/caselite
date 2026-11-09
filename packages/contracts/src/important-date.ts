import { z } from 'zod';

export const DATE_RULE_VERSION = 'cn-civil-2026-11-09-v1';
const id = z.string().uuid();
const typeId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const date = z.iso.date().refine((v) => !v.startsWith('0000-'));
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const dateTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });
export const dateQuoteSchema = z.strictObject({
  source_id: id,
  page: z.number().int().min(1).max(200),
  quote: z.string().min(1).max(2000),
});
const value = z.strictObject({ ...dateQuoteSchema.shape, value: z.string().min(1).max(40) });
export const dateFactCandidateSchema = z.strictObject({
  type_id: typeId,
  rule: z.enum([
    'explicit',
    'civil-judgment-15',
    'civil-order-10',
    'civil-plaintiff-fee-7',
    'court-natural-days',
    'unsupported',
  ]),
  date: value.nullable(),
  time: value.nullable(),
  trigger: value.nullable(),
  period: value.nullable(),
  time_semantics: z.enum(['event_start', 'submission_deadline', 'unknown']),
  context: z.array(dateQuoteSchema).max(8),
  missing: z.array(z.string().min(1).max(160)).max(12),
});
export const dateModelResultSchema = z.strictObject({
  candidates: z.array(dateFactCandidateSchema).max(24),
});
export const dateBindingSchema = z.strictObject({
  version: z.literal(1),
  rule_version: z.string().min(1).max(80),
  task_id: id,
  task_version: z.number().int().positive(),
  preview_id: id,
  type_ids: z.array(typeId).min(1).max(24),
  type_versions: z
    .array(z.strictObject({ id: typeId, version: z.number().int().nonnegative() }))
    .min(1)
    .max(24),
  sources: z
    .array(
      z.strictObject({
        source_id: id,
        asset_version_id: id,
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        derivation_id: id,
        configuration: z.string().min(1).max(200),
        pages: z.array(z.number().int().min(1).max(200)).min(1).max(200),
      }),
    )
    .min(1)
    .max(16),
});
export const dateRunResultSchema = z.strictObject({
  candidates: z.array(dateFactCandidateSchema).max(24),
  error: z.string().max(300).nullable(),
});
export const dateChecksSchema = z.strictObject({
  source_reviewed: z.boolean(),
  ordinary_civil: z.boolean(),
  applicable_party: z.boolean(),
  valid_service: z.boolean(),
  current_notice: z.boolean(),
  no_changes: z.boolean(),
  evidence_55_56: z.boolean(),
  boundary: z.boolean(),
  conflict_resolved: z.boolean(),
});
export const emptyDateChecks: z.infer<typeof dateChecksSchema> = {
  source_reviewed: false,
  ordinary_civil: false,
  applicable_party: false,
  valid_service: false,
  current_notice: false,
  no_changes: false,
  evidence_55_56: false,
  boundary: false,
  conflict_resolved: false,
};
export const dateCheckLabels: Record<keyof typeof emptyDateChecks, string> = {
  source_reviewed: '已核对固定原件、引文及识别文字，无缺字或修订批注疑义',
  ordinary_civil: '已确认大陆普通民事范围；非刑事、行政、涉外、小额或终审',
  applicable_party: '已确认本方身份及本规则适用性（可上诉一审裁判／民事原告案件受理费等）',
  valid_service:
    '已核对有效送达日期、签收人／代理人／代收或电子送达依据；非仅落款、发出、上传或阅读日',
  current_notice: '已确认法院指定通知当前有效，起算方式和自然日单位准确',
  no_changes: '已核对无获准延期、送达争议或其他改变本次期间的情形',
  evidence_55_56: '已核对无证据规定55条中止／追加／变更请求等及56条证据交换日期改变',
  boundary: '已向文书或法院核对“日前／前提交”的包含性、提交渠道及时间边界',
  conflict_resolved: '已逐份核对冲突通知及替代关系，确认本次选定候选当前有效',
};
export const dateEvaluatedSchema = z.strictObject({
  index: z.number().int().nonnegative().max(23),
  fact: dateFactCandidateSchema,
  status: z.enum(['ready', 'needs_information', 'unsupported', 'invalid', 'conflict']),
  date: date.nullable(),
  time: time.nullable(),
  requires: z
    .array(
      z.enum(
        Object.keys(emptyDateChecks) as [
          keyof typeof emptyDateChecks,
          ...(keyof typeof emptyDateChecks)[],
        ],
      ),
    )
    .max(9),
  messages: z.array(z.string().max(300)).max(20),
  computation: z.array(z.string().max(300)).max(40),
  rule_version: z.string().max(80),
  calendar_versions: z.array(z.string().max(80)).max(3),
});
export const dateDecisionFields = {
  scope: id,
  run_id: id,
  candidate_index: z.number().int().nonnegative().max(23),
  expected_version: z.number().int().positive(),
  checks: dateChecksSchema,
  timezone: dateTimezoneSchema.nullable(),
};
export const dateConfirmRequestSchema = z.strictObject({
  protocol_version: z.literal(1),
  operation: z.literal('confirm_date'),
  ...dateDecisionFields,
  confirmed: z.literal(true),
  idempotency_key: id,
});
export const dateConfirmationSchema = z.strictObject({
  request: dateConfirmRequestSchema,
  candidate: dateEvaluatedSchema,
  binding: dateBindingSchema,
  confirmed_at: z.string(),
  task_version: z.number().int().positive(),
});
export type DateBinding = z.infer<typeof dateBindingSchema>;
export type DateFactCandidate = z.infer<typeof dateFactCandidateSchema>;
export type DateRunResult = z.infer<typeof dateRunResultSchema>;
export type DateChecks = z.infer<typeof dateChecksSchema>;
export type DateEvaluated = z.infer<typeof dateEvaluatedSchema>;
export type DateConfirmRequest = z.infer<typeof dateConfirmRequestSchema>;
export type DateConfirmation = z.infer<typeof dateConfirmationSchema>;
