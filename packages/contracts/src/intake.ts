import { z } from 'zod';

const id = z.string().uuid();
export const intakeStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'snoozed',
  'duplicate',
]);
export const intakeSourceSchema = z.literal('local_manual');
export const workRequestSchema = z
  .object({
    id,
    title: z.string().min(1).max(160),
    text: z.string().max(4000),
    source: intakeSourceSchema,
    status: intakeStatusSchema,
    attachment_draft_id: id.nullable(),
    target_task_id: id.nullable(),
    target_task_version: z.number().int().positive().nullable(),
    duplicate_of_request_id: id.nullable(),
    snooze_until: z.iso.datetime().nullable(),
    snooze_due: z.boolean(),
    version: z.number().int().positive(),
    updated_at: z.string(),
  })
  .strict();
export type WorkRequest = z.infer<typeof workRequestSchema>;

const identity = {
  protocol_version: z.literal(1),
  request_id: id,
  idempotency_key: id,
};
const textField = z
  .string()
  .max(4000)
  .refine((value) => !value.includes('\0'));
const titleField = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !value.includes('\0'));

export const intakeRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('list'),
      now: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('receipt'),
      idempotency_key: id,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('submit'),
      title: titleField,
      text: textField,
      attachment_draft_id: id.optional(),
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('accept_create'),
      work_request_id: id,
      matter_id: id.optional(),
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('accept_link'),
      work_request_id: id,
      task_id: id,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('reject'),
      work_request_id: id,
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('snooze'),
      work_request_id: id,
      until: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      ...identity,
      operation: z.literal('duplicate'),
      work_request_id: id,
      target: z.discriminatedUnion('type', [
        z.object({ type: z.literal('request'), id }).strict(),
        z.object({ type: z.literal('task'), id }).strict(),
      ]),
    })
    .strict(),
]);
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;

const failureCode = z.enum([
  'CANCELLED',
  'INVALID_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'WRITE_FAILED',
  'READ_FAILED',
  'RESULT_UNKNOWN',
]);
export const intakeResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      requests: z.array(workRequestSchema).max(200),
      receipt: id.nullable(),
      task_id: id.optional(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: failureCode,
      message: z.string().max(240),
    })
    .strict(),
]);
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
export const INTAKE_CHANNEL = 'caselite:intake:v1';
