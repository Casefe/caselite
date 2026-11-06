import { z } from 'zod';

export const agentProviderSchema = z.enum(['openai', 'deepseek']);
export const agentModelSchema = z.enum(['gpt-4.1-mini', 'deepseek-flash', 'deepseek-v4-pro']);
export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentModel = z.infer<typeof agentModelSchema>;
export const agentProviderFor = (model: AgentModel): AgentProvider =>
  model === 'gpt-4.1-mini' ? 'openai' : 'deepseek';

export const AGENT_CHANNEL = 'caselite:agent:v1';
const scope = z.union([z.literal('home'), z.string().uuid()]);
const base = { protocol_version: z.literal(1) };
export const agentRequestSchema = z.discriminatedUnion('operation', [
  z.object({ ...base, operation: z.literal('profile') }).strict(),
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
  status: z.enum(['running', 'succeeded', 'cancelled', 'failed', 'interrupted']),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  message: z.string(),
  usage: z.object({ input: z.number(), output: z.number() }).nullable(),
});
export const agentResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    configured: z.boolean(),
    model: agentModelSchema,
    providers: z.object({ openai: z.boolean(), deepseek: z.boolean() }),
    runs: z.array(agentRunSchema),
  }),
  z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
]);
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
