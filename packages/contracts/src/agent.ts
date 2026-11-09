import { z } from 'zod';
import { contactRecordCandidateSchema } from './contacts';
import { matterSchema, projectProfessionalTypeSchema } from './catalog';
import { ordinaryDateSchema, taskSchema } from './task';
import {
  dateBindingSchema,
  dateRunResultSchema,
  dateEvaluatedSchema,
  dateConfirmationSchema,
  dateDecisionFields,
  dateConfirmRequestSchema,
} from './important-date';

export const agentProviderSchema = z.enum(['openai', 'deepseek', 'glm', 'kimi', 'siliconflow']);
export const agentModelSchema = z.enum([
  'gpt-4.1-mini',
  'deepseek-flash',
  'deepseek-v4-pro',
  'glm-4.7-flash',
  'kimi-k2.6',
  'deepseek-ai/DeepSeek-V4-Flash',
]);
export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentModel = z.infer<typeof agentModelSchema>;
const modelProviders: Record<AgentModel, AgentProvider> = {
  'gpt-4.1-mini': 'openai',
  'deepseek-flash': 'deepseek',
  'deepseek-v4-pro': 'deepseek',
  'glm-4.7-flash': 'glm',
  'kimi-k2.6': 'kimi',
  'deepseek-ai/DeepSeek-V4-Flash': 'siliconflow',
};
export const agentProviderFor = (model: AgentModel): AgentProvider => modelProviders[model];
export const agentModelAcceptsImages = (model: AgentModel) =>
  model === 'gpt-4.1-mini' || model === 'deepseek-flash';

const validProviderKey = (provider: AgentProvider, key: string) =>
  provider === 'openai' || provider === 'deepseek'
    ? /^sk-[A-Za-z0-9_-]{8,}$/.test(key)
    : /^[A-Za-z0-9._-]{10,}$/.test(key);

export const AGENT_CHANNEL = 'caselite:agent:v1';
const projectScope = z.templateLiteral(['project:', z.string().uuid()]);
const documentScope = z.templateLiteral(['document:', z.string().uuid()]);
const contactScope = z.templateLiteral(['contact:', z.string().uuid()]);
const scope = z.union([
  z.literal('home'),
  z.string().uuid(),
  projectScope,
  documentScope,
  contactScope,
]);
export const agentPageReferenceSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  mode: z.enum(['page', 'selection']),
  characters: z.number().int().min(1).max(32_000),
});
export type AgentPageReference = z.infer<typeof agentPageReferenceSchema>;
const reviewRange = z.strictObject({
  task_id: z.string().uuid(),
  document_id: z.string().uuid(),
  body_id: z.string().uuid(),
  revision: z.number().int().positive(),
  paragraph: z.number().int().min(0).max(100000),
  from: z.number().int().min(0).max(2_000_000),
  to: z.number().int().nonnegative().max(2_000_000),
  text: z.string().max(8000),
});
export type ReviewRange = z.infer<typeof reviewRange>;
export const reviewActionSchema = z.enum(['replace', 'insert_after', 'append']);
export type ReviewAction = z.infer<typeof reviewActionSchema>;
const reviewSaved = z.strictObject({
  task: taskSchema,
  state: z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000),
});
export type ReviewSaved = z.infer<typeof reviewSaved>;
const projectFingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const agentProjectFieldsSchema = z.strictObject({
  title: z.string().min(1).max(160),
  status: matterSchema.shape.status,
  project_type: z.union([
    z.enum(['general', 'litigation', 'contract_review']),
    projectProfessionalTypeSchema,
  ]),
  priority: z.number().int().min(0).max(4),
  target_date: ordinaryDateSchema.nullable(),
});
const agentProjectPreviewSchema = z.strictObject({
  fields: agentProjectFieldsSchema,
  fingerprint: projectFingerprint,
  archived: z.boolean(),
});
export type AgentProjectPreview = z.infer<typeof agentProjectPreviewSchema>;
const base = { protocol_version: z.literal(1) };
export const agentRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('date_rules') }),
  z.strictObject({
    ...base,
    operation: z.literal('read_dates'),
    scope: z.string().uuid(),
    run_id: z.string().uuid(),
  }),
  z.strictObject({ ...base, operation: z.literal('preview_date'), ...dateDecisionFields }),
  dateConfirmRequestSchema,
  z.strictObject({
    ...base,
    operation: z.literal('status_date'),
    scope: z.string().uuid(),
    run_id: z.string().uuid(),
    idempotency_key: z.string().uuid(),
  }),
  z.object({ ...base, operation: z.literal('profile') }).strict(),
  z.object({ ...base, operation: z.literal('refresh_credentials') }).strict(),
  z
    .object({
      ...base,
      operation: z.literal('configure'),
      provider: agentProviderSchema.optional(),
      key: z.string().trim().max(512),
    })
    .strict()
    .refine(({ provider, key }) => validProviderKey(provider ?? 'openai', key), { path: ['key'] }),
  z
    .object({
      ...base,
      operation: z.literal('clear_key'),
      provider: agentProviderSchema.optional(),
    })
    .strict(),
  z.object({ ...base, operation: z.literal('select_model'), model: agentModelSchema }).strict(),
  z.object({ ...base, operation: z.literal('read'), scope }).strict(),
  z.strictObject({
    ...base,
    operation: z.literal('preview_page'),
    scope,
    selected_text: z.string().trim().min(1).max(32_000).optional(),
  }),
  z.object({ ...base, operation: z.literal('preview_project'), scope: projectScope }).strict(),
  z.strictObject({
    ...base,
    operation: z.literal('preview_review'),
    scope: documentScope,
    range: reviewRange,
  }),
  z.strictObject({
    ...base,
    operation: z.literal('apply_review'),
    scope: documentScope,
    run_id: z.string().uuid(),
    confirmed: z.literal(true),
    action: reviewActionSchema.optional(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal('status_review'),
    scope: documentScope,
    run_id: z.string().uuid(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal('discard_review'),
    scope: documentScope,
    run_id: z.string().uuid(),
  }),
  z
    .object({ ...base, operation: z.literal('copy_output'), scope, run_id: z.string().uuid() })
    .strict(),
  z.object({ ...base, operation: z.literal('history') }).strict(),
  z
    .object({
      ...base,
      operation: z.literal('pin_history'),
      run_id: z.string().uuid(),
      pinned: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('start'),
      model: agentModelSchema.optional(),
      scope,
      run_id: z.string().uuid(),
      prompt: z.string().trim().min(1).max(4000),
      confirmed: z.literal(true),
      context_id: z.string().uuid().optional(),
      page_context_id: z.string().uuid().optional(),
      contact_record_context_id: z.string().uuid().optional(),
      project_fingerprint: projectFingerprint.optional(),
      purpose: z.literal('important_dates').optional(),
      date_types: z.array(z.string().min(1).max(80)).min(1).max(24).optional(),
      task_version: z.number().int().positive().optional(),
    })
    .strict(),
  z.object({ ...base, operation: z.literal('cancel'), scope, run_id: z.string().uuid() }).strict(),
]);
export const agentRunSchema = z.object({
  provider: agentProviderSchema,
  model: agentModelSchema,
  id: z.string().uuid(),
  scope,
  prompt: z.string(),
  output: z.string(),
  contact_record_candidate: contactRecordCandidateSchema.optional(),
  output_incomplete: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        source_id: z.string().uuid(),
        task_id: z.string().uuid(),
        name: z.string(),
        pages: z.array(z.number().int().positive()),
      }),
    )
    .max(16)
    .optional(),
  context_id: z.string().uuid().optional(),
  page_context_id: z.string().uuid().optional(),
  contact_record_context_id: z.string().uuid().optional(),
  page_reference: agentPageReferenceSchema.optional(),
  purpose: z.literal('important_dates').optional(),
  date_binding: dateBindingSchema.optional(),
  date_result: dateRunResultSchema.optional(),
  project_fingerprint: projectFingerprint.optional(),
  status: z.enum(['running', 'succeeded', 'cancelled', 'failed', 'interrupted']),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  message: z.string(),
  usage: z.object({ input: z.number(), output: z.number() }).nullable(),
  pinned: z.boolean().optional(),
});
export const agentResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    configured: z.boolean(),
    model: agentModelSchema,
    providers: z.object({
      openai: z.boolean(),
      deepseek: z.boolean(),
      glm: z.boolean().optional(),
      kimi: z.boolean().optional(),
      siliconflow: z.boolean().optional(),
    }),
    credential_reading: z.boolean().optional(),
    credential_errors: z
      .object({
        openai: z.literal('UNAVAILABLE').optional(),
        deepseek: z.literal('UNAVAILABLE').optional(),
        glm: z.literal('UNAVAILABLE').optional(),
        kimi: z.literal('UNAVAILABLE').optional(),
        siliconflow: z.literal('UNAVAILABLE').optional(),
      })
      .strict()
      .optional(),
    runs: z.array(agentRunSchema),
    project_preview: agentProjectPreviewSchema.optional(),
    page_preview: agentPageReferenceSchema.optional(),
    review_preview: z.strictObject({ id: z.string().uuid(), range: reviewRange }).optional(),
    review_saved: reviewSaved.optional(),
    date_task: taskSchema.optional(),
    date_error: z.string().max(300).nullable().optional(),
    date_candidates: z.array(dateEvaluatedSchema).max(24).optional(),
    date_confirmations: z.array(dateConfirmationSchema).max(100).optional(),
    date_saved: z
      .strictObject({
        task: taskSchema,
        confirmation: dateConfirmationSchema,
        receipt: z.string().uuid(),
      })
      .optional(),
    date_rules: z
      .strictObject({
        version: z.string(),
        checks: z.record(z.string(), z.string()),
        types: z.array(
          z.strictObject({ type_id: z.string(), documents: z.string(), support: z.string() }),
        ),
        laws: z.array(z.strictObject({ title: z.string(), url: z.url(), effective: z.string() })),
        calendars: z.array(
          z.strictObject({ id: z.string(), url: z.url(), year: z.number().int() }),
        ),
      })
      .optional(),
  }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
