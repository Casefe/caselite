import { z } from 'zod';

export const taskIdSchema = z.string().uuid();
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'canceled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const taskPrioritySchema = z.number().int().min(0).max(4);
export const ordinaryDateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'));
export const taskSchema = z.object({
  id: taskIdSchema,
  title: z.string().min(1).max(160),
  objective: z.string().max(4000),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default(0),
  due_date: ordinaryDateSchema.nullable().default(null),
  matter_id: taskIdSchema.nullable(),
  document_archived_at: z.string().nullable().optional(),
  matter_title: z.string().nullable().optional(),
  version: z.number().int().positive(),
  document_id: taskIdSchema,
  body_id: taskIdSchema,
  body_revision: z.number().int().nonnegative(),
  editor_schema: z.literal(1),
  updated_at: z.string(),
});
export const taskQuerySchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list'), protocol_version: z.literal(1) }).strict(),
  z
    .object({ operation: z.literal('read'), protocol_version: z.literal(1), task_id: taskIdSchema })
    .strict(),
  z
    .object({
      operation: z.literal('status'),
      protocol_version: z.literal(1),
      idempotency_key: taskIdSchema,
    })
    .strict(),
]);
const richState = z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000);
const mutation = {
  protocol_version: z.literal(1),
  request_id: taskIdSchema,
  idempotency_key: taskIdSchema,
};
export const taskMutationSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...mutation,
      operation: z.literal('update_attributes'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      priority: taskPrioritySchema,
      due_date: ordinaryDateSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('change_status'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      status: taskStatusSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('create'),
      title: z.string().trim().min(1).max(160),
      objective: z.string().max(4000),
      objective_state: richState.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('update'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      title: z.string().trim().min(1).max(160),
      objective: z.string().max(4000),
      objective_state: richState.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('save'),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      body_id: taskIdSchema,
      expected_revision: z.number().int().nonnegative(),
      editor_schema: z.literal(1),
      state: z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000),
    })
    .strict(),
]);
export const taskRequestSchema = z.union([taskQuerySchema, taskMutationSchema]);
export const taskResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    tasks: z.array(taskSchema),
    state: z.array(z.number().int().min(0).max(255)).nullable(),
    receipt: taskIdSchema.nullable(),
    objective_state: richState.nullable().optional(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'INVALID_REQUEST',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'WRITE_FAILED',
      'READ_FAILED',
      'RESULT_UNKNOWN',
    ]),
    message: z.string().max(240),
  }),
]);
export type Task = z.infer<typeof taskSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export const TASK_CHANNEL = 'caselite:task:v1';
