import { z } from 'zod';
import { ordinaryDateSchema, tagListSchema } from './task';
export const projectProfessionalTypeSchema = z.enum([
  'civil_litigation',
  'criminal_litigation',
  'commercial_arbitration',
  'non_litigation',
]);
export type ProjectProfessionalType = z.infer<typeof projectProfessionalTypeSchema>;
export function legacyProjectType(type: ProjectProfessionalType) {
  return type === 'civil_litigation' || type === 'criminal_litigation' ? 'litigation' : 'general';
}
export const projectProfessionalTextLimit = 240;
const projectText = z
  .string()
  .max(projectProfessionalTextLimit)
  .refine((v) => !v.includes('\0'))
  .optional();
export const projectProfessionalFieldsSchema = z.strictObject({
  civil_litigation: z
    .strictObject({
      case_number: projectText,
      court: projectText,
      cause: projectText,
      stage: projectText,
    })
    .optional(),
  criminal_litigation: z
    .strictObject({
      case_number: projectText,
      authority: projectText,
      suspected_offense: projectText,
      stage: projectText,
    })
    .optional(),
  commercial_arbitration: z
    .strictObject({
      case_number: projectText,
      institution: projectText,
      dispute: projectText,
      stage: projectText,
    })
    .optional(),
  non_litigation: z
    .strictObject({
      service_type: projectText,
      topic: projectText,
      scope: projectText,
      deliverables: projectText,
    })
    .optional(),
  contract_review: z
    .strictObject({ contract_type: projectText, subject: projectText, review_focus: projectText })
    .optional(),
});
export type ProjectProfessionalFields = z.infer<typeof projectProfessionalFieldsSchema>;
export const projectAttributesSchema = z
  .object({
    project_type: z.enum(['general', 'litigation', 'contract_review']),
    assignee: z.string().trim().min(1).max(80).nullable(),
    priority: z.number().int().min(0).max(4),
    start_date: ordinaryDateSchema.nullable(),
    target_date: ordinaryDateSchema.nullable(),
    tags: tagListSchema,
    professional_type: projectProfessionalTypeSchema.nullable().optional(),
    professional_fields: projectProfessionalFieldsSchema.optional(),
  })
  .strict()
  .refine((a) => !a.start_date || !a.target_date || a.start_date <= a.target_date, {
    message: '目标日不能早于开始日',
  })
  .refine((a) => !a.professional_type || a.project_type === legacyProjectType(a.professional_type));
export type ProjectAttributes = z.infer<typeof projectAttributesSchema>;
const id = z.string().uuid();
const version = z.number().int().positive();
const bytes = z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000);
const base = { protocol_version: z.literal(1) };
const mutation = { ...base, request_id: id, idempotency_key: id };
export const activityScopeSchema = z.object({ type: z.enum(['project', 'task']), id }).strict();
export const activityEventSchema = z.object({
  id,
  origin: z.enum(['task', 'catalog']),
  target_id: id,
  target_type: z.enum(['project', 'task', 'document']),
  operation: z.string(),
  committed_at: z.string(),
  actor: z.null(),
  recorded_version: z.null(),
});
export const matterSchema = z.object({
  id,
  title: z.string(),
  status: z.enum(['planned', 'active', 'done']),
  version,
  archived_at: z.string().nullable(),
  body_id: id,
  body_revision: z.number().int().nonnegative(),
  editor_schema: z.literal(1),
  updated_at: z.string(),
  task_count: z.number().int().nonnegative(),
  attributes: projectAttributesSchema.optional(),
});
export const catalogDocumentSchema = z.object({
  id,
  task_id: id,
  title: z.string(),
  matter_id: id.nullable(),
  body_id: id,
  body_revision: z.number().int().nonnegative(),
  version,
  archived_at: z.string().nullable(),
  collection: z.string(),
  tags: z.array(z.string()),
  favorite: z.boolean(),
  in_library: z.boolean(),
  updated_at: z.string(),
});
const discussionState = z.array(z.number().int().min(0).max(255)).min(1).max(32768);
const discussionScope = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('project_comment'), project_id: id }),
  z.strictObject({ kind: z.literal('update'), project_id: id }),
  z.strictObject({ kind: z.literal('update_comment'), project_id: id, update_id: id }),
]);
const discussionEntry = z.strictObject({
  id,
  committed_at: z.iso.datetime(),
  state: discussionState,
});
const discussionCursor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export type DiscussionScope = z.infer<typeof discussionScope>;
export type DiscussionEntry = z.infer<typeof discussionEntry>;
export const catalogRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    ...base,
    operation: z.literal('list_discussion'),
    scope: discussionScope,
    before: discussionCursor.optional(),
  }),
  z.strictObject({
    ...mutation,
    operation: z.literal('publish_discussion'),
    scope: discussionScope,
    state: discussionState,
  }),
  z
    .object({
      ...base,
      operation: z.literal('list_activity'),
      scope: activityScopeSchema,
      offset: z.number().int().min(0).max(1_000_000),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('activity_target'),
      scope: activityScopeSchema,
      event_id: id,
      origin: z.enum(['task', 'catalog']),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('list'),
      project_properties: z.literal(true).optional(),
    })
    .strict(),
  z.object({ ...base, operation: z.literal('read_project'), id }).strict(),
  z.object({ ...base, operation: z.literal('status'), idempotency_key: id }).strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('create_project'),
      title: z.string().trim().min(1).max(160),
      status: z.enum(['planned', 'active', 'done']).optional(),
      attributes: projectAttributesSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('promote_task'),
      task_id: id,
      expected_version: version,
      title: z.string().trim().min(1).max(160),
      status: z.enum(['planned', 'active', 'done']).optional(),
      attributes: projectAttributesSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('update_project'),
      id,
      expected_version: version,
      title: z.string().trim().min(1).max(160),
      status: z.enum(['planned', 'active', 'done']),
      expected_body_revision: z.number().int().nonnegative(),
      state: bytes.optional(),
      attributes: projectAttributesSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('archive_project'),
      id,
      expected_version: version,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('assign_task'),
      task_id: id,
      expected_version: version,
      matter_id: id.nullable(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('archive_document'),
      id,
      expected_version: version,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('organize_document'),
      id,
      expected_version: version,
      collection: z.string().trim().max(80),
      tags: tagListSchema,
      favorite: z.boolean(),
      in_library: z.boolean(),
    })
    .strict(),
]);
export const catalogResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    projects: z.array(matterSchema),
    documents: z.array(catalogDocumentSchema),
    state: bytes.nullable(),
    target_id: id.nullable(),
    receipt: id.nullable(),
    discussion: z
      .strictObject({
        entries: z.array(discussionEntry).max(10),
        next: discussionCursor.nullable(),
      })
      .optional(),
    activity: z.array(activityEventSchema).optional(),
    activity_has_more: z.boolean().optional(),
    activity_target: z
      .object({
        type: z.enum(['project', 'task', 'document']),
        id,
        task_id: id.nullable(),
        current_version: version,
      })
      .optional(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'INVALID_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'FORBIDDEN',
      'UNAVAILABLE',
      'RESULT_UNKNOWN',
    ]),
    message: z.string(),
  }),
]);
export const CATALOG_CHANNEL = 'caselite:catalog:v1';
export type CatalogRequest = z.infer<typeof catalogRequestSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export type Matter = z.infer<typeof matterSchema>;
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
export type ActivityEvent = z.infer<typeof activityEventSchema>;
export type ActivityScope = z.infer<typeof activityScopeSchema>;
