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
