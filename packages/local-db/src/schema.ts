import {
  uniqueIndex,
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

export const localPreferences = sqliteTable(
  'local_preferences',
  {
    workspaceId: text('workspace_id').primaryKey(),
    value: text('value').notNull(),
    version: integer('version').notNull(),
  },
  (table) => [
    check('local_preferences_version', sql`${table.version} > 0`),
    check('local_preferences_json', sql`json_valid(${table.value})`),
  ],
);
export const localPreferenceReceipts = sqliteTable(
  'local_preference_receipts',
  {
    workspaceId: text('workspace_id').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    result: text('result').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.key] })],
);

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
    startDate: text('start_date'),
    plannedDate: text('planned_date'),
    scheduleDate: text('schedule_date'),
    scheduleStart: text('schedule_start'),
    scheduleEnd: text('schedule_end'),
    scheduleTimezone: text('schedule_timezone'),
    isImportant: integer('is_important').notNull().default(0),
    importantTypeId: text('important_type_id'),
    attentionSource: text('attention_source').notNull().default('unknown'),
    attentionDate: text('attention_date'),
    attentionTime: text('attention_time'),
    attentionTimezone: text('attention_timezone'),
    assignee: text('assignee').default('本人'),
    subscribed: integer('subscribed', { mode: 'boolean' }).notNull().default(false),
    tags: text('tags', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    version: integer('version').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('task_calendar_planned').on(table.workspaceId, table.plannedDate),
    index('task_calendar_timed').on(table.workspaceId, table.scheduleDate),
    index('task_calendar_important').on(table.workspaceId, table.isImportant),
    check(
      'task_attention_timezone_valid',
      sql.raw(
        "attention_timezone IS NULL OR (attention_source='custom' AND attention_time IS NOT NULL AND typeof(attention_timezone)='text' AND length(attention_timezone) BETWEEN 1 AND 100)",
      ),
    ),
    check(
      'task_calendar_planned_date_valid',
      sql.raw(
        "planned_date IS NULL OR (typeof(planned_date)='text' AND length(planned_date)=10 AND planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(planned_date,1,4)<>'0000' AND date(planned_date) IS NOT NULL AND date(planned_date)=planned_date)",
      ),
    ),
    check(
      'task_calendar_schedule_date_valid',
      sql.raw(
        "schedule_date IS NULL OR (typeof(schedule_date)='text' AND length(schedule_date)=10 AND schedule_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(schedule_date,1,4)<>'0000' AND date(schedule_date) IS NOT NULL AND date(schedule_date)=schedule_date)",
      ),
    ),
    check(
      'task_calendar_schedule_start_valid',
      sql.raw(
        "schedule_start IS NULL OR (typeof(schedule_start)='text' AND schedule_start GLOB '[0-2][0-9]:[0-5][0-9]' AND schedule_start<'24:00')",
      ),
    ),
    check(
      'task_calendar_schedule_end_valid',
      sql.raw(
        "schedule_end IS NULL OR (typeof(schedule_end)='text' AND schedule_end GLOB '[0-2][0-9]:[0-5][0-9]' AND schedule_end<'24:00')",
      ),
    ),
    check(
      'task_calendar_schedule_complete_valid',
      sql.raw(
        "(schedule_date IS NULL AND schedule_start IS NULL AND schedule_end IS NULL AND schedule_timezone IS NULL) OR (schedule_date IS NOT NULL AND schedule_start IS NOT NULL AND schedule_end IS NOT NULL AND schedule_start<schedule_end AND typeof(schedule_timezone)='text' AND length(schedule_timezone) BETWEEN 1 AND 100)",
      ),
    ),
    check('task_calendar_important_flag_valid', sql.raw('is_important IN (0,1)')),
    check(
      'task_calendar_important_type_valid',
      sql.raw(
        "(important_type_id IS NULL AND is_important=0) OR (typeof(important_type_id)='text' AND length(important_type_id) BETWEEN 1 AND 80)",
      ),
    ),
    check(
      'task_calendar_attention_source_valid',
      sql.raw("attention_source IN ('unknown','schedule','planned','due','custom')"),
    ),
    check(
      'task_calendar_attention_date_valid',
      sql.raw(
        "attention_date IS NULL OR (typeof(attention_date)='text' AND length(attention_date)=10 AND attention_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(attention_date,1,4)<>'0000' AND date(attention_date) IS NOT NULL AND date(attention_date)=attention_date)",
      ),
    ),
    check(
      'task_calendar_attention_complete_valid',
      sql.raw(
        "(attention_source='custom' OR (attention_date IS NULL AND attention_time IS NULL)) AND (attention_time IS NULL OR (attention_date IS NOT NULL AND (typeof(attention_time)='text' AND attention_time GLOB '[0-2][0-9]:[0-5][0-9]' AND attention_time<'24:00')))",
      ),
    ),
    check('task_subscribed_valid', sql`${table.subscribed} IN (0, 1)`),
    check(
      'task_assignee_valid',
      sql`${table.assignee} IS NULL OR (typeof(${table.assignee}) = 'text' AND instr(${table.assignee}, char(0)) = 0 AND length(trim(${table.assignee})) BETWEEN 1 AND 80)`,
    ),
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
    check(
      'task_start_date_valid',
      sql`${table.startDate} IS NULL OR (length(${table.startDate}) = 10 AND ${table.startDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(${table.startDate},1,4) <> '0000' AND date(${table.startDate}) IS NOT NULL AND date(${table.startDate}) = ${table.startDate})`,
    ),
    check(
      'task_date_range_valid',
      sql`${table.startDate} IS NULL OR ${table.dueDate} IS NULL OR ${table.startDate} <= ${table.dueDate}`,
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
// 输出身份独立于可编辑工作副本；ready 后不得改写或删除。
export const deliveryExports = sqliteTable(
  'delivery_exports',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => deliverableSnapshots.id),
    format: text('format').notNull(),
    converter: text('converter').notNull(),
    configurationJson: text('configuration_json'),
    configurationFingerprint: text('configuration_fingerprint').notNull().default(''),
    status: text('status').notNull(),
    sha256: text('sha256'),
    bytes: integer('bytes'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('delivery_exports_snapshot_format').on(
      t.workspaceId,
      t.snapshotId,
      t.format,
      t.converter,
      t.configurationFingerprint,
    ),
  ],
);
export const deliveryExportIntents = sqliteTable(
  'delivery_export_intents',
  {
    workspaceId: text('workspace_id').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    exportId: text('export_id')
      .notNull()
      .references(() => deliveryExports.id),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
export const deliverableSnapshots = sqliteTable(
  'deliverable_snapshots',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id),
    taskId: text('task_id')
      .notNull()
      .references(() => taskItems.id),
    bodyId: text('body_id').notNull(),
    bodyRevision: integer('body_revision').notNull(),
    editorSchema: integer('editor_schema').notNull(),
    metadataVersion: integer('metadata_version').notNull(),
    taskVersion: integer('task_version').notNull(),
    title: text('title').notNull(),
    collection: text('collection').notNull(),
    tags: text('tags').notNull(),
    note: text('note').notNull(),
    contentSha256: text('content_sha256').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    kind: text('kind').notNull(),
    sourceRefs: text('source_refs').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.bodyId, table.bodyRevision],
      foreignColumns: [bodyRevisions.bodyId, bodyRevisions.revision],
    }),
    unique('delivery_fixed_revision').on(
      table.documentId,
      table.bodyRevision,
      table.metadataVersion,
      table.taskVersion,
    ),
    index('delivery_workspace_document').on(table.workspaceId, table.documentId),
    check(
      'delivery_snapshot_versions_valid',
      sql`${table.bodyRevision}>0 AND ${table.metadataVersion}>0 AND ${table.taskVersion}>0 AND ${table.editorSchema}=1`,
    ),
    check(
      'delivery_snapshot_kind_valid',
      sql`${table.kind}='draft' AND ${table.createdBy}='local' AND ${table.sourceRefs}='[]'`,
    ),
    check(
      'delivery_snapshot_text_valid',
      sql`length(${table.title}) BETWEEN 1 AND 160 AND length(${table.note})<=200 AND length(${table.collection})<=80 AND length(${table.contentSha256})=64`,
    ),
    check(
      'delivery_snapshot_tags_valid',
      sql`CASE WHEN json_valid(${table.tags}) THEN json_type(${table.tags})='array' AND json_array_length(${table.tags})<=20 ELSE 0 END`,
    ),
  ],
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
export const taskActivity = sqliteTable(
  'task_activity',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => taskItems.id),
    operation: text('operation').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('task_activity_created_scope').on(table.taskId, table.operation, table.createdAt),
  ],
);

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
    health: text('health', { enum: ['on_track', 'at_risk', 'off_track'] }),
    updateId: text('update_id'),
    bodyId: text('body_id').notNull().unique(),
    bodyRevision: integer('body_revision').notNull().default(1),
    committedAt: text('committed_at').notNull(),
  },
  (table) => [
    check(
      'project_discussion_health_valid',
      sql`${table.health} IS NULL OR (${table.kind} = 'update' AND ${table.health} IN ('on_track', 'at_risk', 'off_track'))`,
    ),
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
export const taskProjects = sqliteTable(
  'task_projects',
  {
    taskId: text('task_id')
      .primaryKey()
      .references(() => taskItems.id),
    matterId: text('matter_id')
      .notNull()
      .references(() => matters.id),
  },
  (table) => [unique('task_projects_task_matter').on(table.taskId, table.matterId)],
);
export const projectMilestones = sqliteTable(
  'project_milestones',
  {
    id: text('id').primaryKey().notNull(),
    matterId: text('matter_id')
      .notNull()
      .references(() => matters.id),
    title: text('title').notNull(),
    targetDate: text('target_date'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (table) => [
    unique().on(table.id, table.matterId),
    index('project_milestones_matter').on(table.matterId, table.targetDate),
    check(
      'milestone_title_valid',
      sql`length(trim(${table.title})) BETWEEN 1 AND 160 AND instr(${table.title}, char(0)) = 0`,
    ),
    check('milestone_version_valid', sql`${table.version} > 0`),
  ],
);
export const taskMilestones = sqliteTable(
  'task_milestones',
  {
    taskId: text('task_id').primaryKey().notNull(),
    matterId: text('matter_id').notNull(),
    milestoneId: text('milestone_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.taskId, table.matterId],
      foreignColumns: [taskProjects.taskId, taskProjects.matterId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.milestoneId, table.matterId],
      foreignColumns: [projectMilestones.id, projectMilestones.matterId],
    }),
    index('task_milestones_milestone').on(table.milestoneId),
  ],
);
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

export const financeContracts = sqliteTable(
  'finance_contracts',
  {
    projectId: text('project_id')
      .primaryKey()
      .notNull()
      .references(() => matters.id),
    number: text('number').notNull(),
    amount: integer('amount_cents').notNull(),
  },
  (t) => [
    check('finance_contract_number', sql`length(trim(${t.number})) BETWEEN 1 AND 120`),
    check(
      'finance_contract_amount',
      sql`typeof(${t.amount}) = 'integer' AND ${t.amount} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
export const financeInstallments = sqliteTable(
  'finance_installments',
  {
    id: text('id').primaryKey().notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => financeContracts.projectId),
    amount: integer('amount_cents').notNull(),
    dueDate: text('due_date').notNull(),
  },
  (t) => [
    index('finance_installment_project').on(t.projectId, t.dueDate),
    check(
      'finance_installment_amount',
      sql`typeof(${t.amount}) = 'integer' AND ${t.amount} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      'finance_installment_date',
      sql`length(${t.dueDate}) = 10 AND substr(${t.dueDate},1,4) <> '0000' AND date(${t.dueDate}) IS NOT NULL AND date(${t.dueDate}) = ${t.dueDate}`,
    ),
  ],
);
export const financePayments = sqliteTable(
  'finance_payments',
  {
    id: text('id').primaryKey().notNull(),
    installmentId: text('installment_id')
      .notNull()
      .references(() => financeInstallments.id),
    amount: integer('amount_cents').notNull(),
    committedAt: text('committed_at').notNull(),
  },
  (t) => [
    index('finance_payment_installment').on(t.installmentId),
    check(
      'finance_payment_amount',
      sql`typeof(${t.amount}) = 'integer' AND ${t.amount} BETWEEN 1 AND 9007199254740991`,
    ),
  ],
);
export const financeReversals = sqliteTable('finance_reversals', {
  paymentId: text('payment_id')
    .primaryKey()
    .notNull()
    .references(() => financePayments.id),
  committedAt: text('committed_at').notNull(),
});
export const financeReceipts = sqliteTable(
  'finance_receipts',
  {
    workspaceId: text('workspace_id').notNull(),
    key: text('key').notNull(),
    digest: text('digest').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => matters.id),
    operation: text('operation').notNull(),
    targetId: text('target_id').notNull(),
    activityId: text('activity_id')
      .notNull()
      .unique()
      .references(() => catalogActivity.id),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.key] }),
    check(
      'finance_receipt_operation',
      sql`${t.operation} IN ('register_contract','record_payment','reverse_payment')`,
    ),
  ],
);

export const calendarTypes = sqliteTable(
  'calendar_types',
  {
    workspaceId: text('workspace_id').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    enabled: integer('enabled').notNull(),
    showHome: integer('show_home').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    check(
      'calendar_type_name',
      sql`typeof(${t.name})='text' AND length(trim(${t.name})) BETWEEN 1 AND 30 AND instr(${t.name},char(0))=0`,
    ),
    check(
      'calendar_type_flags',
      sql`${t.enabled} IN (0,1) AND ${t.showHome} IN (0,1) AND ${t.version}>0`,
    ),
  ],
);

export const taskDateConfirmations = sqliteTable(
  'task_date_confirmations',
  {
    workspaceId: text('workspace_id').notNull(),
    receiptKey: text('receipt_key').notNull(),
    taskId: text('task_id')
      .notNull()
      .references(() => taskItems.id),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id),
    taskVersion: integer('task_version').notNull(),
    payload: text('payload').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.receiptKey] }),
    index('task_date_confirmation_task').on(table.workspaceId, table.taskId, table.taskVersion),
    check('task_date_confirmation_version', sql`${table.taskVersion}>0`),
    check(
      'task_date_confirmation_payload',
      sql`json_valid(${table.payload}) AND length(${table.payload})<=120000`,
    ),
  ],
);
