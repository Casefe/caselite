import {
  sqliteTable,
  text,
  integer,
  blob,
  primaryKey,
  check,
  foreignKey,
  unique,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Infrastructure-only fixture. Product tables are designed in later Issues.
export const toolchainProbe = sqliteTable('toolchain_probe', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
});

export const taskItems = sqliteTable(
  'task_items',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    status: text('status', { enum: ['todo', 'in_progress', 'done', 'canceled'] })
      .notNull()
      .default('todo'),
    priority: integer('priority').notNull().default(0),
    dueDate: text('due_date'),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    version: integer('version').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'task_tags_valid',
      sql`CASE WHEN json_valid(${table.tags}) THEN json_type(${table.tags}) = 'array' AND json_array_length(${table.tags}) <= 20 ELSE 0 END`,
    ),
    check('task_status_valid', sql`${table.status} IN ('todo', 'in_progress', 'done', 'canceled')`),
    check(
      'task_priority_valid',
      sql`typeof(${table.priority}) = 'integer' AND ${table.priority} BETWEEN 0 AND 4`,
    ),
    check(
      'task_due_date_valid',
      sql`${table.dueDate} IS NULL OR (length(${table.dueDate}) = 10 AND ${table.dueDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(${table.dueDate},1,4) <> '0000' AND date(${table.dueDate}) IS NOT NULL AND date(${table.dueDate}) = ${table.dueDate})`,
    ),
  ],
);
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .unique()
    .references(() => taskItems.id),
  metadataVersion: integer('metadata_version').notNull().default(1),
  archivedAt: text('archived_at'),
  collection: text('collection').notNull().default(''),
  tags: text('tags').notNull().default('[]'),
  favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
  inLibrary: integer('in_library', { mode: 'boolean' }).notNull().default(false),
  bodyId: text('body_id').notNull().unique(),
  bodyRevision: integer('body_revision').notNull(),
  editorSchema: integer('editor_schema').notNull(),
});
export const bodyRevisions = sqliteTable(
  'body_revisions',
  {
    bodyId: text('body_id').notNull(),
    revision: integer('revision').notNull(),
    state: blob('state', { mode: 'buffer' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.bodyId, table.revision] })],
);
export const taskReceipts = sqliteTable(
  'task_receipts',
  {
    workspaceId: text('workspace_id').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    result: text('result').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
);
export const taskActivity = sqliteTable('task_activity', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => taskItems.id),
  operation: text('operation').notNull(),
  createdAt: text('created_at').notNull(),
});

export const taskObjectiveRevisions = sqliteTable(
  'task_objective_revisions',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => taskItems.id),
    taskVersion: integer('task_version').notNull(),
    state: blob('state', { mode: 'buffer' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.taskVersion] })],
);

export const matters = sqliteTable(
  'matters',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('planned'),
    projectType: text('project_type').notNull().default('general'),
    professionalType: text('professional_type'),
    professionalFields: text('professional_fields').notNull().default('{}'),
    assignee: text('assignee'),
    priority: integer('priority').notNull().default(0),
    startDate: text('start_date'),
    targetDate: text('target_date'),
    tags: text('tags').notNull().default('[]'),
    version: integer('version').notNull(),
    archivedAt: text('archived_at'),
    bodyId: text('body_id').notNull().unique(),
    bodyRevision: integer('body_revision').notNull().default(0),
    editorSchema: integer('editor_schema').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'project_professional_type_valid',
      sql`${table.professionalType} IN ('civil_litigation','criminal_litigation','commercial_arbitration','non_litigation')`,
    ),
    check(
      'project_professional_fields_valid',
      sql`CASE WHEN length(CAST(${table.professionalFields} AS blob)) <= 28000 AND json_valid(${table.professionalFields}) THEN json_type(${table.professionalFields}) = 'object' AND json_remove(${table.professionalFields}, '$.civil_litigation', '$.criminal_litigation', '$.commercial_arbitration', '$.non_litigation', '$.contract_review') = '{}' AND COALESCE(json_type(${table.professionalFields}, '$.civil_litigation'), 'object') = 'object' AND COALESCE(json_type(${table.professionalFields}, '$.criminal_litigation'), 'object') = 'object' AND COALESCE(json_type(${table.professionalFields}, '$.commercial_arbitration'), 'object') = 'object' AND COALESCE(json_type(${table.professionalFields}, '$.non_litigation'), 'object') = 'object' AND COALESCE(json_type(${table.professionalFields}, '$.contract_review'), 'object') = 'object' ELSE 0 END`,
    ),
    check(
      'project_type_valid',
      sql`${table.projectType} IN ('general','litigation','contract_review')`,
    ),
    check(
      'project_assignee_valid',
      sql`${table.assignee} IS NULL OR (length(trim(${table.assignee})) BETWEEN 1 AND 80)`,
    ),
    check(
      'project_priority_valid',
      sql`typeof(${table.priority}) = 'integer' AND ${table.priority} BETWEEN 0 AND 4`,
    ),
    check(
      'project_start_valid',
      sql`${table.startDate} IS NULL OR (length(${table.startDate}) = 10 AND ${table.startDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(${table.startDate},1,4) <> '0000' AND date(${table.startDate}) IS NOT NULL AND date(${table.startDate}) = ${table.startDate})`,
    ),
    check(
      'project_target_valid',
      sql`(${table.targetDate} IS NULL OR (length(${table.targetDate}) = 10 AND ${table.targetDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(${table.targetDate},1,4) <> '0000' AND date(${table.targetDate}) IS NOT NULL AND date(${table.targetDate}) = ${table.targetDate})) AND (${table.startDate} IS NULL OR ${table.targetDate} IS NULL OR ${table.startDate} <= ${table.targetDate})`,
    ),
    check(
      'project_tags_valid',
      sql`CASE WHEN json_valid(${table.tags}) THEN json_type(${table.tags}) = 'array' AND json_array_length(${table.tags}) <= 20 ELSE 0 END`,
    ),
  ],
);
export const projectDiscussion = sqliteTable(
  'project_discussion',
  {
    sequence: integer('sequence').primaryKey(),
    id: text('id').notNull().unique(),
    matterId: text('matter_id')
      .notNull()
      .references(() => matters.id),
    kind: text('kind').notNull(),
    updateId: text('update_id'),
    bodyId: text('body_id').notNull().unique(),
    bodyRevision: integer('body_revision').notNull().default(1),
    committedAt: text('committed_at').notNull(),
  },
  (table) => [
    unique().on(table.matterId, table.id),
    index('project_discussion_scope').on(table.matterId, table.kind, table.updateId),
    foreignKey({
      columns: [table.matterId, table.updateId],
      foreignColumns: [table.matterId, table.id],
    }),
    foreignKey({
      columns: [table.bodyId, table.bodyRevision],
      foreignColumns: [bodyRevisions.bodyId, bodyRevisions.revision],
    }),
    check(
      'discussion_target',
      sql`(${table.kind} IN ('project_comment','update') AND ${table.updateId} IS NULL) OR (${table.kind} = 'update_comment' AND ${table.updateId} IS NOT NULL)`,
    ),
    check('discussion_fixed_revision', sql`${table.bodyRevision} = 1`),
  ],
);
export const taskComment = sqliteTable(
  'task_comment',
  {
    sequence: integer('sequence').primaryKey(),
    id: text('id').notNull().unique(),
    taskId: text('task_id')
      .notNull()
      .references(() => taskItems.id),
    bodyId: text('body_id').notNull().unique(),
    bodyRevision: integer('body_revision').notNull().default(1),
    committedAt: text('committed_at').notNull(),
  },
  (table) => [
    index('task_comment_scope').on(table.taskId),
    foreignKey({
      columns: [table.bodyId, table.bodyRevision],
      foreignColumns: [bodyRevisions.bodyId, bodyRevisions.revision],
    }),
    check('task_comment_fixed_revision', sql`${table.bodyRevision} = 1`),
  ],
);
export const taskProjects = sqliteTable('task_projects', {
  taskId: text('task_id')
    .primaryKey()
    .references(() => taskItems.id),
  matterId: text('matter_id')
    .notNull()
    .references(() => matters.id),
});
export const catalogReceipts = sqliteTable(
  'catalog_receipts',
  {
    workspaceId: text('workspace_id').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    result: text('result').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
export const catalogActivity = sqliteTable('catalog_activity', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  targetId: text('target_id').notNull(),
  operation: text('operation').notNull(),
  createdAt: text('created_at').notNull(),
});

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  scope: text('scope').notNull(),
  sequence: integer('sequence').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  payload: text('payload').notNull(),
});

// 文件字节仍在不可变原件目录；SQLite 只拥有身份、恢复阶段和派生结果。
export const materialStages = sqliteTable('material_stages', {
  token: text('token').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  payload: text('payload').notNull(),
});
export const materialSources = sqliteTable('material_sources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  taskId: text('task_id')
    .notNull()
    .references(() => taskItems.id),
  assetVersionId: text('asset_version_id').notNull(),
  name: text('name').notNull(),
  sha256: text('sha256').notNull(),
  bytes: integer('bytes').notNull(),
  pageCount: integer('page_count').notNull(),
  derivationId: text('derivation_id'),
});
export const materialDerivations = sqliteTable('material_derivations', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references(() => materialSources.id),
  configuration: text('configuration').notNull(),
  status: text('status').notNull(),
  pages: text('pages').notNull(),
});
export const materialHome = sqliteTable('material_home', {
  workspaceId: text('workspace_id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => taskItems.id),
});
export const materialPreviews = sqliteTable('material_previews', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  scope: text('scope').notNull(),
  payload: text('payload').notNull(),
});

export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  taskId: text('task_id')
    .notNull()
    .unique()
    .references(() => taskItems.id),
  date: text('date').notNull(),
  time: text('time').notNull(),
  timezone: text('timezone').notNull(),
  instant: text('instant').notNull(),
  version: integer('version').notNull(),
  planRevision: integer('plan_revision').notNull(),
  status: text('status', { enum: ['scheduled', 'canceled'] }).notNull(),
  readAt: text('read_at'),
  updatedAt: text('updated_at').notNull(),
});
export const reminderAttempts = sqliteTable(
  'reminder_attempts',
  {
    reminderId: text('reminder_id')
      .notNull()
      .references(() => reminders.id),
    planRevision: integer('plan_revision').notNull(),
    status: text('status', { enum: ['unknown', 'shown', 'failed', 'unsupported'] }).notNull(),
    attemptedAt: text('attempted_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.reminderId, t.planRevision] })],
);
export const reminderReceipts = sqliteTable(
  'reminder_receipts',
  {
    workspaceId: text('workspace_id').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    result: text('result').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
