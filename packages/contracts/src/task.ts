import { z } from 'zod';
import { deliverySnapshotSchema } from './delivery-snapshot';
import { deliveryExportSchema, deliveryFormatSchema } from './delivery-export';
import { exportStyleSchema } from './export-style';

export const taskIdSchema = z.string().uuid();
export const taskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'canceled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export const taskPrioritySchema = z.number().int().min(0).max(4);
const taskAssigneeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !value.includes('\0'))
  .nullable();
export const tagListSchema = z.array(z.string().trim().min(1).max(40)).max(20);
export const ordinaryDateSchema = z.iso.date().refine((value) => !value.startsWith('0000-'));
export const calendarTypeIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const calendarTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const calendarZoneSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/)
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
export const taskCalendarSchema = z
  .object({
    planned_date: ordinaryDateSchema.nullable(),
    schedule: z
      .object({
        date: ordinaryDateSchema,
        start: calendarTimeSchema,
        end: calendarTimeSchema,
        timezone: calendarZoneSchema,
      })
      .strict()
      .refine((v) => v.start < v.end)
      .nullable(),
    important: z.boolean(),
    type_id: calendarTypeIdSchema.nullable(),
    attention_source: z.enum(['unknown', 'schedule', 'planned', 'due', 'custom']),
    attention_date: ordinaryDateSchema.nullable(),
    attention_time: calendarTimeSchema.nullable(),
    attention_timezone: calendarZoneSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.important || v.type_id !== null) &&
      (v.attention_source === 'custom' ||
        (v.attention_date === null && v.attention_time === null)) &&
      (!v.attention_time || v.attention_date !== null) &&
      (!v.attention_timezone || (v.attention_source === 'custom' && v.attention_time !== null)),
  );
export type TaskCalendar = z.infer<typeof taskCalendarSchema>;
export const emptyTaskCalendar: TaskCalendar = {
  planned_date: null,
  schedule: null,
  important: false,
  type_id: null,
  attention_source: 'unknown',
  attention_date: null,
  attention_time: null,
};
export const calendarTypeSchema = z
  .object({
    id: calendarTypeIdSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .refine((v) => !v.includes('\0')),
    enabled: z.boolean(),
    show_home: z.boolean(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type CalendarType = z.infer<typeof calendarTypeSchema>;
export const defaultCalendarTypes: CalendarType[] = [
  ['meeting', '会议'],
  ['hearing', '开庭'],
  ['payment', '缴费'],
  ['court-submission', '法庭资料提交'],
  ['evidence', '举证／证据交换'],
  ['filing', '立案／补正'],
  ['appraisal', '鉴定／勘验'],
  ['negotiation', '调解／重要谈判'],
  ['remedy', '救济程序申请'],
  ['preservation', '保全／续保'],
  ['execution', '执行申请／异议'],
  ['period-check', '时效／期间核对'],
].map(([id, name]) => ({ id, name, enabled: true, show_home: true, version: 0 }));
export const calendarQuerySchema = z
  .object({
    view: z.enum(['important', 'day', 'untimed', 'timed', 'undated', 'counts', 'types']),
    date: ordinaryDateSchema,
    from: ordinaryDateSchema,
    to: ordinaryDateSchema,
    home: z.boolean(),
    include_closed: z.boolean(),
    include_overdue: z.boolean(),
    offset: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .refine((q) => q.from <= q.to && (Date.parse(q.to) - Date.parse(q.from)) / 86400000 <= 62);
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export const taskListQuerySchema = z
  .object({
    scope: z.discriminatedUnion('type', [
      z.object({ type: z.literal('workspace') }).strict(),
      z.object({ type: z.literal('project'), id: taskIdSchema }).strict(),
    ]),
    view: z.enum(['all', 'created', 'subscribed']).optional(),
    text: z.string().trim().max(160),
    status: taskStatusSchema.nullable(),
    priority: taskPrioritySchema.nullable(),
    dates: z.enum(['all', 'dated', 'undated']),
    from: ordinaryDateSchema.nullable(),
    to: ordinaryDateSchema.nullable(),
    body: z.enum(['all', 'written', 'empty']),
    sort: z.enum(['updated', 'title', 'priority', 'due_date']),
    offset: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .refine(
    (q) => (!q.from || !q.to || q.from <= q.to) && (q.dates !== 'undated' || (!q.from && !q.to)),
  );
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export const taskSchema = z.object({
  id: taskIdSchema,
  title: z.string().min(1).max(160),
  objective: z.string().max(4000),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default(0),
  due_date: ordinaryDateSchema.nullable().default(null),
  tags: tagListSchema.optional(),
  subscribed: z.boolean().optional(),
  assignee: taskAssigneeSchema.optional(),
  calendar: taskCalendarSchema.optional(),
  matter_id: taskIdSchema.nullable(),
  document_archived_at: z.string().nullable().optional(),
  matter_title: z.string().nullable().optional(),
  version: z.number().int().positive(),
  document_id: taskIdSchema,
  document_metadata_version: z.number().int().positive().optional(),
  body_id: taskIdSchema,
  body_revision: z.number().int().nonnegative(),
  editor_schema: z.literal(1),
  updated_at: z.string(),
});
export const taskQuerySchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('calendar_query'),
      protocol_version: z.literal(1),
      query: calendarQuerySchema,
    })
    .strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('save_export'),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
      export_id: taskIdSchema,
      format: deliveryFormatSchema,
    })
    .strict(),
  z
    .object({
      protocol_version: z.literal(1),
      operation: z.literal('cancel_export'),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
      idempotency_key: taskIdSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('read_export'),
      format: deliveryFormatSchema.optional(),
      export_style: exportStyleSchema.optional(),
      include_history: z.boolean().optional(),
      protocol_version: z.literal(1),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('preview_export'),
      format: z.literal('pdf'),
      protocol_version: z.literal(1),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
      export_id: taskIdSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('open_export'),
      format: deliveryFormatSchema.optional(),
      protocol_version: z.literal(1),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
      export_id: taskIdSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('list_snapshots'),
      protocol_version: z.literal(1),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      offset: z.number().int().min(0).max(1_000_000),
    })
    .strict(),
  z
    .object({
      operation: z.literal('read_snapshot'),
      protocol_version: z.literal(1),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal('list'),
      protocol_version: z.literal(1),
      query: taskListQuerySchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('read'),
      protocol_version: z.literal(1),
      task_id: taskIdSchema,
      navigation: taskListQuerySchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('status'),
      protocol_version: z.literal(1),
      idempotency_key: taskIdSchema,
    })
    .strict(),
]);
const richState = z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000);
const mutation = {
  protocol_version: z.literal(1),
  request_id: taskIdSchema,
  idempotency_key: taskIdSchema,
};
export const taskMutationSchema = z.discriminatedUnion('operation', [
  z
    .object({
      ...mutation,
      operation: z.literal('update_calendar'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      calendar: taskCalendarSchema,
    })
    .strict(),
  z
    .object({ ...mutation, operation: z.literal('set_calendar_type'), type: calendarTypeSchema })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('export_snapshot'),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      snapshot_id: taskIdSchema,
      format: deliveryFormatSchema,
      export_style: exportStyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('create_snapshot'),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      body_id: taskIdSchema,
      expected_revision: z.number().int().positive(),
      expected_metadata_version: z.number().int().positive(),
      expected_task_version: z.number().int().positive(),
      note: z
        .string()
        .trim()
        .max(200)
        .refine((value) => !value.includes('\0')),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('set_subscription'),
      task_id: taskIdSchema,
      subscribed: z.boolean(),
      expected_subscribed: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('update_attributes'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      priority: taskPrioritySchema,
      due_date: ordinaryDateSchema.nullable(),
      tags: tagListSchema.optional(),
      assignee: taskAssigneeSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('change_status'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      status: taskStatusSchema,
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('create'),
      status: taskStatusSchema.optional(),
      priority: taskPrioritySchema.optional(),
      due_date: ordinaryDateSchema.nullable().optional(),
      tags: tagListSchema.optional(),
      matter_id: taskIdSchema.optional(),
      title: z.string().trim().min(1).max(160),
      objective: z.string().max(4000),
      objective_state: richState.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('update'),
      task_id: taskIdSchema,
      expected_version: z.number().int().positive(),
      title: z.string().trim().min(1).max(160),
      objective: z.string().max(4000),
      objective_state: richState.optional(),
    })
    .strict(),
  z
    .object({
      ...mutation,
      operation: z.literal('save'),
      task_id: taskIdSchema,
      document_id: taskIdSchema,
      body_id: taskIdSchema,
      expected_revision: z.number().int().nonnegative(),
      editor_schema: z.literal(1),
      state: z.array(z.number().int().min(0).max(255)).min(1).max(2_000_000),
    })
    .strict(),
]);
export const taskRequestSchema = z.union([taskQuerySchema, taskMutationSchema]);
export const taskResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    tasks: z.array(taskSchema),
    calendar_types: z.array(calendarTypeSchema).optional(),
    calendar_pending_count: z.number().int().nonnegative().optional(),
    calendar_counts: z
      .array(z.object({ date: ordinaryDateSchema, count: z.number().int().nonnegative() }))
      .max(63)
      .optional(),
    state: z.array(z.number().int().min(0).max(255)).nullable(),
    receipt: taskIdSchema.nullable(),
    snapshots: z.array(deliverySnapshotSchema).max(20).optional(),
    snapshot_created: z.boolean().optional(),
    exports: z.array(deliveryExportSchema).max(1).optional(),
    export_history: z.array(deliveryExportSchema).max(20).optional(),
    export_created: z.boolean().optional(),
    export_opened: z.boolean().optional(),
    export_saved: z.boolean().optional(),
    export_data: z
      .instanceof(Uint8Array)
      .refine(
        (bytes) =>
          bytes.byteLength > 5 &&
          bytes.byteLength <= 20_000_000 &&
          bytes[0] === 37 &&
          bytes[1] === 80 &&
          bytes[2] === 68 &&
          bytes[3] === 70 &&
          bytes[4] === 45,
      )
      .optional(),
    objective_state: richState.nullable().optional(),
    navigation: z
      .object({
        index: z.number().int().nonnegative(),
        total: z.number().int().positive(),
        previous: taskIdSchema.nullable(),
        next: taskIdSchema.nullable(),
      })
      .optional(),
    page: z
      .object({
        offset: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        has_more: z.boolean(),
      })
      .optional(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      'CANCELLED',
      'INVALID_REQUEST',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'WRITE_FAILED',
      'READ_FAILED',
      'RESULT_UNKNOWN',
    ]),
    message: z.string().max(240),
  }),
]);
export type Task = z.infer<typeof taskSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export const TASK_CHANNEL = 'caselite:task:v1';
