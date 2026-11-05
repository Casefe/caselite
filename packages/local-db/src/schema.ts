import { sqliteTable, text, integer, blob, primaryKey } from 'drizzle-orm/sqlite-core';

// Infrastructure-only fixture. Product tables are designed in later Issues.
export const toolchainProbe = sqliteTable('toolchain_probe', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
});

export const taskItems = sqliteTable('task_items', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  title: text('title').notNull(),
  objective: text('objective').notNull(),
  version: integer('version').notNull(),
  updatedAt: text('updated_at').notNull(),
});
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
