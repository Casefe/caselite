import { z } from 'zod';
import { ordinaryDateSchema, taskIdSchema } from './task';

export const reminderTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const reminderZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/);
const wall = { date: ordinaryDateSchema, time: reminderTimeSchema, timezone: reminderZoneSchema };
const identity = {
  protocol_version: z.literal(1),
  request_id: taskIdSchema,
  idempotency_key: taskIdSchema,
};
const target = {
  reminder_id: taskIdSchema,
  task_id: taskIdSchema,
  expected_version: z.number().int().nonnegative(),
};
export const reminderSchema = z.object({
  id: taskIdSchema,
  task_id: taskIdSchema,
  task_title: z.string(),
  date: ordinaryDateSchema,
  time: reminderTimeSchema,
  timezone: reminderZoneSchema,
  instant: z.iso.datetime(),
  version: z.number().int().positive(),
  plan_revision: z.number().int().positive(),
  status: z.enum(['scheduled', 'canceled']),
  read_at: z.iso.datetime().nullable(),
  attempt: z.enum(['unknown', 'shown', 'failed', 'unsupported']).nullable(),
  attempted_at: z.iso.datetime().nullable(),
  updated_at: z.iso.datetime(),
});
export const reminderRequestSchema = z.discriminatedUnion('operation', [
  z.object({ protocol_version: z.literal(1), operation: z.literal('resolve'), ...wall }).strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('list'),
      task_id: taskIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('receipt'),
      idempotency_key: taskIdSchema,
    })
    .strict(),
  z
    .object({
      ...identity,
      ...target,
      ...wall,
      operation: z.literal('schedule'),
      instant: z.iso.datetime(),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ ...identity, ...target, operation: z.literal('cancel') }).strict(),
  z
    .object({ ...identity, ...target, operation: z.literal('mark_read'), read: z.boolean() })
    .strict(),
]);
export const reminderResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    reminders: z.array(reminderSchema),
    choices: z.array(z.iso.datetime()),
    receipt: taskIdSchema.nullable(),
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
export type Reminder = z.infer<typeof reminderSchema>;
export type ReminderRequest = z.infer<typeof reminderRequestSchema>;
export type ReminderResponse = z.infer<typeof reminderResponseSchema>;
export const REMINDER_CHANNEL = 'caselite:reminder:v1';
