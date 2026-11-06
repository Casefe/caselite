import { sqliteTable, text, integer, blob, primaryKey, check } from 'drizzle-orm/sqlite-core';
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
    version: integer('version').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('task_status_valid', sql`${table.status} IN ('todo', 'in_progress', 'done', 'canceled')`),
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

export const matters = sqliteTable('matters', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('planned'),
  version: integer('version').notNull(),
  archivedAt: text('archived_at'),
  bodyId: text('body_id').notNull().unique(),
  bodyRevision: integer('body_revision').notNull().default(0),
  editorSchema: integer('editor_schema').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
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
