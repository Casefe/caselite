import { z } from 'zod';
import { matterSchema, projectProfessionalTypeSchema } from './catalog';
import { ordinaryDateSchema, taskSchema } from './task';

export const agentProviderSchema = z.enum(['openai', 'deepseek']);
export const agentModelSchema = z.enum(['gpt-4.1-mini', 'deepseek-flash', 'deepseek-v4-pro']);
export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentModel = z.infer<typeof agentModelSchema>;
export const agentProviderFor = (model: AgentModel): AgentProvider =>
  model === 'gpt-4.1-mini' ? 'openai' : 'deepseek';

export const AGENT_CHANNEL = 'caselite:agent:v1';
const projectScope = z.templateLiteral(['project:', z.string().uuid()]);
const documentScope = z.templateLiteral(['document:', z.string().uuid()]);
const scope = z.union([z.literal('home'), z.string().uuid(), projectScope, documentScope]);
const reviewRange = z.strictObject({
  task_id: z.string().uuid(),
  document_id: z.string().uuid(),
  body_id: z.string().uuid(),
  revision: z.number().int().positive(),
  paragraph: z.number().int().min(0).max(100000),
  from: z.number().int().min(0).max(2_000_000),
  to: z.number().int().positive().max(2_000_000),
  text: z.string().min(1).max(8000),
});
export type ReviewRange = z.infer<typeof reviewRange>;
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
  z.object({ ...base, operation: z.literal('profile') }).strict(),
  z.object({ ...base, operation: z.literal('refresh_credentials') }).strict(),
  z
    .object({
      ...base,
      operation: z.literal('configure'),
      provider: agentProviderSchema.optional(),
      key: z
        .string()
        .trim()
        .regex(/^sk-[A-Za-z0-9_-]{8,}$/)
        .max(512),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('clear_key'),
      provider: agentProviderSchema.optional(),
    })
    .strict(),
  z.object({ ...base, operation: z.literal('select_model'), model: agentModelSchema }).strict(),
  z.object({ ...base, operation: z.literal('read'), scope }).strict(),
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
      project_fingerprint: projectFingerprint.optional(),
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
    providers: z.object({ openai: z.boolean(), deepseek: z.boolean() }),
    credential_errors: z
      .object({
        openai: z.literal('UNAVAILABLE').optional(),
        deepseek: z.literal('UNAVAILABLE').optional(),
      })
      .strict()
      .optional(),
    runs: z.array(agentRunSchema),
    project_preview: agentProjectPreviewSchema.optional(),
    review_preview: z.strictObject({ id: z.string().uuid(), range: reviewRange }).optional(),
    review_saved: reviewSaved.optional(),
  }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
