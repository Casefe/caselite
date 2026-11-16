import { z } from 'zod';
import { taskIdSchema } from './task';

// 备忘正文是结构化字段，最长 4000 字。更长的可编辑正文仍归 Document/Yjs，不在这里复制一份。
export const memoTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((value) => !value.includes('\0'));
const stamp = z.iso.datetime();
const identity = {
  protocol_version: z.literal(1),
  request_id: taskIdSchema,
  idempotency_key: taskIdSchema,
};
const target = {
  memo_id: taskIdSchema,
  expected_version: z.number().int().positive(),
};
export const memoSchema = z
  .object({
    id: taskIdSchema,
    text: memoTextSchema,
    status: z.enum(['active', 'done']),
    version: z.number().int().positive(),
    created_at: stamp,
    updated_at: stamp,
    deleted_at: stamp.nullable(),
  })
  .strict();
export const memoRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('list'),
      view: z.enum(['active', 'done', 'deleted']),
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
    })
    .strict(),
  z
    .object({ ...identity, ...target, operation: z.literal('update'), text: memoTextSchema })
    .strict(),
  z.object({ ...identity, ...target, operation: z.literal('scratch') }).strict(),
  z.object({ ...identity, ...target, operation: z.literal('restore') }).strict(),
  z.object({ ...identity, ...target, operation: z.literal('delete') }).strict(),
  z.object({ ...identity, ...target, operation: z.literal('recover') }).strict(),
]);
export const memoResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      memos: z.array(memoSchema),
      receipt: taskIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
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
    })
    .strict(),
]);
export type Memo = z.infer<typeof memoSchema>;
export type MemoRequest = z.infer<typeof memoRequestSchema>;
export type MemoResponse = z.infer<typeof memoResponseSchema>;
