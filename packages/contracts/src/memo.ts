import { z } from 'zod';
import { taskIdSchema } from './task';

export const memoTextSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => !value.includes('\0'), '备忘文本不能包含空字符。');
export const memoLifecycleSchema = z.enum(['active', 'scratched', 'deleted']);
export const memoListViewSchema = z.enum(['daily', 'deleted']);
const identity = {
  protocol_version: z.literal(1),
  request_id: taskIdSchema,
  idempotency_key: taskIdSchema,
};
const target = {
  memo_id: taskIdSchema,
  expected_version: z.number().int().nonnegative(),
};
export const memoSchema = z.object({
  id: taskIdSchema,
  text: memoTextSchema,
  lifecycle: memoLifecycleSchema,
  version: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  scratched_at: z.iso.datetime().nullable(),
  deleted_at: z.iso.datetime().nullable(),
});
export const memoRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('list'),
      view: memoListViewSchema,
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
      operation: z.literal('create'),
      memo_id: taskIdSchema,
      text: memoTextSchema,
      expected_version: z.literal(0),
    })
    .strict(),
  z
    .object({ ...identity, ...target, operation: z.literal('update'), text: memoTextSchema })
    .strict(),
  z.object({ ...identity, ...target, operation: z.literal('scratch') }).strict(),
  z.object({ ...identity, ...target, operation: z.literal('restore_scratch') }).strict(),
  z.object({ ...identity, ...target, operation: z.literal('soft_delete') }).strict(),
  z.object({ ...identity, ...target, operation: z.literal('restore_delete') }).strict(),
]);
export const memoResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    memos: z.array(memoSchema),
    receipt: z.string().uuid().nullable(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['NOT_FOUND', 'CONFLICT', 'INVALID_REQUEST', 'READ_FAILED', 'WRITE_FAILED']),
    message: z.string(),
  }),
]);
export type Memo = z.infer<typeof memoSchema>;
export type MemoRequest = z.infer<typeof memoRequestSchema>;
export type MemoResponse = z.infer<typeof memoResponseSchema>;
export const MEMO_CHANNEL = 'caselite:memo:v1';
