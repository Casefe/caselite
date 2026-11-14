import { z } from 'zod';
import { MATERIAL_MAX_BYTES } from './material';
import { personalMaterialHeaderSchema, personalMaterialSchema } from './material-personal';

export const FOLDER_CHANNEL = 'caselite:folder:v1';
export const FOLDER_PAGE_SIZE = 32;
export const FOLDER_DIRECTORY_LIMIT = 256;
export const FOLDER_DEPTH_LIMIT = 8;
export const FOLDER_SNAPSHOT_LIMIT = 16;
const id = z.string().uuid();
const version = z.number().int().nonnegative();
export const folderScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('workspace') }),
  z.strictObject({ kind: z.literal('project'), project_id: id }),
]);
export type FolderScope = z.infer<typeof folderScopeSchema>;
const base = { protocol_version: z.literal(1) };
const scoped = { ...base, scope: folderScopeSchema };
const captureTarget = {
  ...scoped,
  root_id: id,
  entry_id: id,
  request_id: id,
  mapping_revision: version,
  view_generation: version,
};
export const folderRequestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...base, operation: z.literal('configuration'), scope: folderScopeSchema }),
  z.strictObject({
    ...base,
    operation: z.literal('choose_default'),
    request_id: id,
    expected_revision: version,
  }),
  z.strictObject({
    ...base,
    operation: z.literal('reselect_default'),
    request_id: id,
    expected_revision: version,
  }),
  z.strictObject({
    ...base,
    operation: z.literal('bind_project'),
    project_id: id,
    request_id: id,
    expected_revision: version,
  }),
  z.strictObject({ ...scoped, operation: z.literal('restore_default'), view_generation: version }),
  z.strictObject({
    ...scoped,
    operation: z.literal('list_directory'),
    root_id: id,
    entry_id: id,
    cursor: id.optional(),
    view_generation: version,
  }),
  z.strictObject({ ...captureTarget, operation: z.literal('open_entry') }),
  z.strictObject({
    ...scoped,
    operation: z.literal('resume_capture'),
    request_id: id,
    view_generation: version,
    root_id: id.optional(),
    entry_id: id.optional(),
    mapping_revision: version.optional(),
  }),
  z.strictObject({
    ...scoped,
    operation: z.literal('query_capture'),
    request_kind: z.literal('capture'),
    request_id: id,
  }),
  z.strictObject({
    ...scoped,
    operation: z.literal('cancel_capture'),
    request_kind: z.literal('capture'),
    request_id: id,
  }),
  z.strictObject({
    ...scoped,
    operation: z.literal('query_configuration'),
    request_kind: z.literal('configuration'),
    configuration_operation: z.enum(['set_default', 'bind_project']),
    request_id: id,
  }),
  z.strictObject({ ...scoped, operation: z.literal('list_saved') }),
  z.strictObject({ ...scoped, operation: z.literal('list_pending') }),
  z.strictObject({ ...scoped, operation: z.literal('open_saved'), mapping_id: id, source_id: id }),
  z.strictObject({ ...scoped, operation: z.literal('read_saved'), saved_handle: id }),
]);
export type FolderRequest = z.infer<typeof folderRequestSchema>;
export const folderEntrySchema = z.strictObject({
  entry_id: id,
  display_name: z.string().min(1).max(512),
  kind: z.enum(['directory', 'file', 'unsupported', 'blocked_link']),
  bytes: z.number().int().nonnegative().nullable(),
  mapping_revision: version,
});
export type FolderEntry = z.infer<typeof folderEntrySchema>;
export const folderRootSchema = z.strictObject({
  root_id: id,
  root_entry_id: id,
  generation: version,
  display_name: z.string().max(512),
});
export type FolderRoot = z.infer<typeof folderRootSchema>;
export const folderConfigurationSchema = z.strictObject({
  binding_id: id,
  display_name: z.string().max(512),
  revision: z.number().int().positive(),
});
export type FolderConfiguration = z.infer<typeof folderConfigurationSchema>;
export const capturePhaseSchema = z.enum([
  'reserved',
  'snapshot_planned',
  'staged',
  'placed',
  'ready',
  'cancelled',
]);
export type CapturePhase = z.infer<typeof capturePhaseSchema>;
const failure = z.strictObject({
  ok: z.literal(false),
  code: z.enum([
    'INVALID_REQUEST',
    'FORBIDDEN',
    'ROOT_EXPIRED',
    'ROOT_MISMATCH',
    'ENTRY_CHANGED',
    'DIRECTORY_LIMIT',
    'CURSOR_EXPIRED',
    'UNSUPPORTED_FORMAT',
    'FILE_LIMIT',
    'FILE_UNAVAILABLE',
    'BUSY',
    'CANCELLED',
    'CAPTURE_PENDING',
    'RECEIPT_CONFLICT',
    'SOURCE_UNAVAILABLE',
    'DATABASE_UNAVAILABLE',
    'REVISION_CONFLICT',
    'NOT_FOUND',
    'RESULT_UNKNOWN',
  ]),
  message: z.string().max(240),
  request_id: id.optional(),
});
const bytes = z.instanceof(Uint8Array).refine((value) => value.length <= MATERIAL_MAX_BYTES);
export const folderResponseSchema = z.discriminatedUnion('ok', [
  failure,
  z.strictObject({
    ok: z.literal(true),
    state: z.enum([
      'not_configured',
      'configured',
      'ready',
      'needs_reselect',
      'cancelled',
      'pending',
      'listed',
    ]),
    configuration: folderConfigurationSchema.optional(),
    project_revision: version.optional(),
    project_directory_name: z.string().max(512).optional(),
    root: folderRootSchema.optional(),
    entries: z.array(folderEntrySchema).max(FOLDER_PAGE_SIZE).optional(),
    next_cursor: id.nullable().optional(),
    view_generation: version.optional(),
    source: personalMaterialSchema.optional(),
    saved_handle: id.optional(),
    data: bytes.optional(),
    request_id: id.optional(),
    phase: capturePhaseSchema.optional(),
    needs_reselect: z.boolean().optional(),
    receipt: id.optional(),
    pending: z
      .array(
        z.strictObject({
          request_id: id,
          phase: capturePhaseSchema,
          needs_reselect: z.boolean(),
          relative_label: z.string().max(4096),
        }),
      )
      .max(FOLDER_DIRECTORY_LIMIT)
      .optional(),
    saved: z
      .array(
        z.strictObject({
          mapping_id: id,
          source: personalMaterialHeaderSchema,
          relative_label: z.string().max(4096),
        }),
      )
      .max(FOLDER_DIRECTORY_LIMIT)
      .optional(),
  }),
]);
export type FolderResponse = z.infer<typeof folderResponseSchema>;
