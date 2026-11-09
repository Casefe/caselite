import { z } from 'zod';

export const CONTACTS_CHANNEL = 'caselite:contacts:v1';
const id = z.string().uuid();
const clean = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes('\0'));
const profile = {
  wechat: clean(80),
  company: clean(160),
  position: clean(80),
  city: clean(80),
  relationship: clean(40),
  tags: z
    .array(clean(40).refine(Boolean))
    .max(20)
    .refine((v) => new Set(v).size === v.length),
};
export const contactRecordCandidateSchema = z.strictObject({
  kind: z.literal('contact_record'),
  title: clean(120).refine(Boolean),
  channel: z.enum(['phone', 'wechat', 'email', 'meeting', 'other']),
  occurred_on: z.string().date().nullable(),
  summary: clean(8000).refine(Boolean),
});
export type ContactRecordCandidate = z.infer<typeof contactRecordCandidateSchema>;
export function parseContactRecord(output: string): ContactRecordCandidate | undefined {
  try {
    const text = output
      .trim()
      .replace(/^```(?:json)?\s*/u, '')
      .replace(/\s*```$/u, '');
    const parsed = contactRecordCandidateSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
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
  wechat: profile.wechat.default(''),
  company: profile.company.default(''),
  position: profile.position.default(''),
  city: profile.city.default(''),
  relationship: profile.relationship.default(''),
  tags: profile.tags.default([]),
  last_contact: z.string().nullable().default(null),
  id,
  version: z.number().int().positive(),
  updated_at: z.string(),
});
export const contactEntrySchema = z.strictObject({
  id,
  contact_id: id,
  kind: z.enum(['communication', 'note']),
  title: clean(120).refine(Boolean),
  channel: contactRecordCandidateSchema.shape.channel,
  occurred_on: z.string().date().nullable(),
  content: clean(8000).refine(Boolean),
  body_id: id,
  body_revision: z.number().int().positive(),
  version: z.number().int().positive(),
  source_run_id: id.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ContactEntry = z.infer<typeof contactEntrySchema>;
const detail = z.strictObject({
  contact_id: id,
  entries: z.array(contactEntrySchema),
  task_ids: z.array(id),
  document_ids: z.array(id),
});
export const contactsRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ protocol_version: z.literal(1), operation: z.literal('list') }),
  z.strictObject({ protocol_version: z.literal(1), operation: z.literal('read'), contact_id: id }),
  z.strictObject({
    protocol_version: z.literal(1),
    operation: z.literal('save'),
    contact_id: id,
    expected_version: z.number().int().nonnegative(),
    receipt: id,
    ...fields,
    wechat: profile.wechat.optional(),
    company: profile.company.optional(),
    position: profile.position.optional(),
    city: profile.city.optional(),
    relationship: profile.relationship.optional(),
    tags: profile.tags.optional(),
  }),
  z.strictObject({
    protocol_version: z.literal(1),
    operation: z.literal('save_entry'),
    contact_id: id,
    entry_id: id,
    receipt: id,
    expected_version: z.number().int().nonnegative(),
    kind: z.enum(['communication', 'note']),
    title: clean(120).refine(Boolean),
    channel: contactRecordCandidateSchema.shape.channel,
    occurred_on: z.string().date().nullable(),
    state: z.array(z.number().int().min(0).max(255)).min(1).max(100000),
    source_run_id: id.optional(),
  }),
  z.strictObject({
    protocol_version: z.literal(1),
    operation: z.literal('set_links'),
    contact_id: id,
    receipt: id,
    expected_version: z.number().int().positive(),
    kind: z.enum(['task', 'document']),
    target_ids: z
      .array(id)
      .max(100)
      .refine((v) => new Set(v).size === v.length),
  }),
]);
export const contactsResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    contacts: z.array(contactSchema),
    receipt: id.nullable(),
    detail: detail.optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['INVALID_REQUEST', 'FORBIDDEN', 'CONFLICT', 'RESULT_UNKNOWN', 'UNAVAILABLE']),
    message: z.string(),
  }),
]);
export type Contact = z.infer<typeof contactSchema>;
export type ContactsRequest = z.infer<typeof contactsRequestSchema>;
export type ContactsResponse = z.infer<typeof contactsResponseSchema>;
