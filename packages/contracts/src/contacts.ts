import { z } from 'zod';

export const CONTACTS_CHANNEL = 'caselite:contacts:v1';
const id = z.string().uuid();
const clean = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes('\0'));
const fields = {
  name: clean(120).refine(Boolean),
  kind: z.enum(['person', 'organization']),
  phone: clean(64),
  email: z.union([z.literal(''), z.string().trim().max(254).email()]),
  project_ids: z
    .array(id)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
};
export const contactSchema = z.strictObject({
  ...fields,
  id,
  version: z.number().int().positive(),
  updated_at: z.string(),
});
export const contactsRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ protocol_version: z.literal(1), operation: z.literal('list') }),
  z.strictObject({
    protocol_version: z.literal(1),
    operation: z.literal('save'),
    contact_id: id,
    expected_version: z.number().int().nonnegative(),
    receipt: id,
    ...fields,
  }),
]);
export const contactsResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), contacts: z.array(contactSchema), receipt: id.nullable() }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT', 'RESULT_UNKNOWN', 'UNAVAILABLE']),
    message: z.string(),
  }),
]);
export type Contact = z.infer<typeof contactSchema>;
export type ContactsRequest = z.infer<typeof contactsRequestSchema>;
export type ContactsResponse = z.infer<typeof contactsResponseSchema>;
