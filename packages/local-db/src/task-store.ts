import {
  calendarColumns,
  decodeCalendar,
  calendarTypes,
  calendarValues,
  queryCalendar,
  type CalendarRow,
} from './task-calendar';
import { createDocumentReviewReader } from './document-review-reader';
import { createAgentPageReader } from './agent-page-reader';
import { createDeliverySnapshotStore } from './delivery-snapshot-store';
import { createDeliveryExportStore } from './delivery-export-store';
import { createReminderStore } from './reminder-store';
import { createMaterialStore } from './material-store';
import { createHash, randomUUID } from 'node:crypto';
import { validateBody, bodyPlainText } from './body-schema';
import {
  type ReviewRange,
  type Task,
  type TaskRequest,
  type TaskListQuery,
  type TaskResponse,
  type DeliverySnapshot,
  taskResponseSchema,
  tagListSchema,
} from '@caselite/contracts';
import { openToolchainProbe } from './connection';
import { createContactsStore } from './contacts-store';
import { createLocalPreferencesStore } from './local-preferences-store';
import { createFinanceStore } from './finance-store';
import { createCatalogStore } from './catalog-store';
import { createAgentHistoryStore } from './agent-history-store';
import { createImportantDateStore } from './important-date-store';

type Row = Omit<Task, 'tags' | 'assignee' | 'subscribed'> & {
  tags: string;
  subscribed?: number;
  assignee: string | null;
} & Partial<CalendarRow>;
const decodeTask = (input: Row): Task => {
  const {
    tags,
    subscribed,
    planned_date,
    schedule_date,
    schedule_start,
    schedule_end,
    schedule_timezone,
    is_important,
    important_type_id,
    attention_source,
    attention_date,
    attention_time,
    attention_timezone,
    ...row
  } = input;
  return {
    ...row,
    ...(subscribed !== undefined ? { subscribed: subscribed === 1 } : {}),
    tags: tagListSchema.parse(JSON.parse(tags)),
    ...(planned_date !== undefined
      ? {
          calendar: decodeCalendar({
            planned_date,
            schedule_date,
            schedule_start,
            schedule_end,
            schedule_timezone,
            is_important,
            important_type_id,
            attention_source,
            attention_date,
            attention_time,
            attention_timezone,
          } as CalendarRow),
        }
      : {}),
  };
};
const baseSelect = `SELECT t.id,t.title,t.objective,t.status,t.priority,t.due_date,t.assignee,t.tags,t.subscribed,t.version,t.updated_at,d.id AS document_id,d.metadata_version AS document_metadata_version,d.body_id,d.body_revision,d.editor_schema,d.archived_at AS document_archived_at,p.matter_id,m.title AS matter_title FROM task_items t JOIN documents d ON d.task_id=t.id LEFT JOIN task_projects p ON p.task_id=t.id LEFT JOIN matters m ON m.id=p.matter_id`;
const from = `FROM task_items t JOIN documents d ON d.task_id=t.id LEFT JOIN task_projects p ON p.task_id=t.id LEFT JOIN matters m ON m.id=p.matter_id`;
const creation =
  "(SELECT min(a.created_at) FROM task_activity a WHERE a.task_id=t.id AND a.operation='create')";

const fail = (
  code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INVALID_REQUEST',
  message: string,
): TaskResponse => ({ ok: false, code, message });
export function openTaskStore(file: string, migrations: string, workspace = 'local') {
  const connection = openToolchainProbe(file, migrations);
  const db = connection.sqlite;
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  const hasSubscription = (
    db.prepare('PRAGMA table_info(task_items)').all() as Array<{ name: string }>
  ).some((v) => v.name === 'subscribed');
  const hasCalendar = (
    db.prepare('PRAGMA table_info(task_items)').all() as Array<{ name: string }>
  ).some((v) => v.name === 'planned_date');
  const hasTimezone = (
    db.prepare('PRAGMA table_info(task_items)').all() as Array<{ name: string }>
  ).some((c) => c.name === 'attention_timezone');
  const select = (hasSubscription ? baseSelect : baseSelect.replace(',t.subscribed', '')).replace(
    ' FROM task_items',
    `${hasCalendar ? calendarColumns : ''}${hasTimezone ? ',t.attention_timezone' : ''} FROM task_items`,
  );
  // 完整宿主先应用全部迁移；旧版迁移夹具尚无导出意图表，不能因此破坏已有Task读写。
  const hasExportIntents = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_export_intents'")
    .get();
  const get = (id: string) => {
    const row = db.prepare(`${select} WHERE t.id=? AND t.workspace_id=?`).get(id, workspace) as
      Row | undefined;
    return row ? decodeTask(row) : null;
  };
  const review = createDocumentReviewReader(db, workspace, get);
  const snapshots = createDeliverySnapshotStore(db, workspace, get);
  const objectiveState = (id: string, version: number) =>
    (
      db
        .prepare(
          'SELECT state FROM task_objective_revisions WHERE task_id=? AND task_version<=? ORDER BY task_version DESC LIMIT 1',
        )
        .get(id, version) as { state: Buffer } | undefined
    )?.state;
  const ok = (
    tasks: Task[],
    state: number[] | null = null,
    receipt: string | null = null,
  ): Extract<TaskResponse, { ok: true }> => ({ ok: true, tasks, state, receipt });
  const isListScopeAvailable = (q: TaskListQuery) =>
    q.scope.type === 'workspace' ||
    Boolean(
      db
        .prepare('SELECT id FROM matters WHERE id=? AND workspace_id=? AND archived_at IS NULL')
        .get(q.scope.id, workspace),
    );
  const listFilter = (q: TaskListQuery) => {
    const clauses = ['t.workspace_id=?'],
      params: (string | number)[] = [workspace];
    if (q.scope.type === 'project') {
      clauses.push('p.matter_id=?');
      params.push(q.scope.id);
    }
    if (q.view === 'created') clauses.push(`${creation} IS NOT NULL`);
    if (q.view === 'subscribed') clauses.push(hasSubscription ? 't.subscribed=1' : '0');
    if (q.text) {
      clauses.push("instr(lower(t.title || ' ' || t.objective),lower(?)) > 0");
      params.push(q.text);
    }
    if (q.status !== null) {
      clauses.push('t.status=?');
      params.push(q.status);
    }
    if (q.priority !== null) {
      clauses.push('t.priority=?');
      params.push(q.priority);
    }
    if (q.dates !== 'all')
      clauses.push(q.dates === 'dated' ? 't.due_date IS NOT NULL' : 't.due_date IS NULL');
    if (q.from) {
      clauses.push('t.due_date>=?');
      params.push(q.from);
    }
    if (q.to) {
      clauses.push('t.due_date<=?');
      params.push(q.to);
    }
    if (q.body !== 'all')
      clauses.push(q.body === 'written' ? 'd.body_revision>0' : 'd.body_revision=0');
    const order =
      q.view === 'created' && q.sort === 'updated'
        ? `${creation} DESC,t.id`
        : {
            updated: 't.updated_at DESC,t.id',
            title: 't.title COLLATE NOCASE,t.id',
            priority: '(t.priority=0),t.priority,t.id',
            due_date: '(t.due_date IS NULL),t.due_date,t.id',
          }[q.sort];
    return { where: `WHERE ${clauses.join(' AND ')}`, params, order };
  };
  const navigation = (id: string, q: TaskListQuery) => {
    if (!isListScopeAvailable(q)) return undefined;
    const { where, params, order } = listFilter(q);
    // 列表和相邻任务使用同一组筛选和排序；窗口查询覆盖分页边界。
    return db
      .prepare(
        `
      WITH ordered AS (
        SELECT t.id, row_number() OVER (ORDER BY ${order}) - 1 AS "index",
          count(*) OVER () AS total, lag(t.id) OVER (ORDER BY ${order}) AS previous,
          lead(t.id) OVER (ORDER BY ${order}) AS next
        ${from} ${where}
      ) SELECT "index",total,previous,next FROM ordered WHERE id=?
    `,
      )
      .get(...params, id) as
      NonNullable<Extract<TaskResponse, { ok: true }>['navigation']> | undefined;
  };
  const executeTask = (r: TaskRequest, confirmation?: boolean): TaskResponse =>
    api.execute(r, confirmation);
  const dates = createImportantDateStore(db, workspace, get, (r) => executeTask(r, true));
  const api = {
    agentPage: createAgentPageReader(db, workspace, get),
    dates,
    localPreferences: createLocalPreferencesStore(db, workspace),
    deliveryExports: createDeliveryExportStore(db, workspace),
    reviewDocumentExists: review.reviewDocumentExists,
    reviewSaved(range: ReviewRange, receipt: string) {
      return review.reviewSaved(range, receipt, (request) => this.execute(request));
    },
    reviewState: review.reviewState,
    materials: createMaterialStore(db, workspace),
    reminders: createReminderStore(db, workspace),
    finance: createFinanceStore(db, workspace),
    contacts: createContactsStore(db, workspace),
    catalog: createCatalogStore(db, workspace),
    agentHistory: createAgentHistoryStore(db, workspace),
    execute(request: TaskRequest, calendarConfirmation = false): TaskResponse {
      if (request.operation === 'calendar_query')
        return hasCalendar
          ? queryCalendar(db, workspace, select, decodeTask, request.query)
          : fail('CONFLICT', '此工作区尚未升级日历格式。');
      if (
        !hasCalendar &&
        (request.operation === 'update_calendar' || request.operation === 'set_calendar_type')
      )
        return fail('CONFLICT', '此工作区尚未升级日历格式。');
      if (
        request.operation === 'export_snapshot' ||
        request.operation === 'save_export' ||
        request.operation === 'cancel_export' ||
        request.operation === 'open_export' ||
        request.operation === 'read_export'
      )
        return fail('INVALID_REQUEST', '导出操作须经受控交付 Application。');
      if (request.operation === 'list_snapshots' || request.operation === 'read_snapshot')
        return snapshots.query(request);
      if (request.operation === 'list') {
        const q = request.query;
        if (q) {
          if (!isListScopeAvailable(q))
            return fail('NOT_FOUND', '项目不存在、已归档或不在当前工作区。');
          const { where, params, order } = listFilter(q);
          const filtered = `${select} ${where}`;
          const total = (
            db.prepare(`SELECT count(*) AS n FROM (${filtered})`).get(...params) as { n: number }
          ).n;
          const rows = db
            .prepare(`${filtered} ORDER BY ${order} LIMIT 20 OFFSET ?`)
            .all(...params, q.offset) as Row[];
          return {
            ...ok(rows.map(decodeTask)),
            page: { offset: q.offset, total, has_more: q.offset + rows.length < total },
          };
        }
        const rows = db
          .prepare(`${select} WHERE t.workspace_id=? ORDER BY t.updated_at DESC,t.id`)
          .all(workspace) as Row[];
        return ok(rows.map(decodeTask));
      }
      if (request.operation === 'status') {
        const row = db
          .prepare('SELECT result FROM task_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as { result: string } | undefined;
        return row
          ? taskResponseSchema.parse(JSON.parse(row.result))
          : fail('NOT_FOUND', '尚未查到该提交；请保留输入并再次核对。');
      }
      if (request.operation === 'read') {
        const task = get(request.task_id);
        if (!task) return fail('NOT_FOUND', '任务不存在或不在当前工作区。');
        if (task.editor_schema !== 1)
          return fail('CONFLICT', '正文格式版本暂不兼容，原始数据已保留。');
        const row = db
          .prepare('SELECT state FROM body_revisions WHERE body_id=? AND revision=?')
          .get(task.body_id, task.body_revision) as { state: Buffer } | undefined;
        if (task.body_revision > 0 && !row) throw new Error('Missing committed body');
        if (row) validateBody(row.state, true);
        const objective = objectiveState(task.id, task.version);
        if (objective && bodyPlainText(objective) !== task.objective)
          throw new Error('Invalid task description projection');
        return {
          ...ok([task], row ? Array.from(row.state) : null),
          objective_state: objective ? Array.from(objective) : null,
          ...(request.navigation ? { navigation: navigation(task.id, request.navigation) } : {}),
        };
      }
      // 幂等结果、对象/正文修订和成功事件同事务提交；异常不留下半个成功结果。
      const commit = db.transaction((): TaskResponse => {
        if (
          hasExportIntents &&
          db
            .prepare('SELECT key FROM delivery_export_intents WHERE workspace_id=? AND key=?')
            .get(workspace, request.idempotency_key)
        )
          return fail('CONFLICT', '该提交身份已用于固定版本导出。');
        const { request_id: diagnosticId, ...content } = request;
        void diagnosticId;
        const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
        const old = db
          .prepare('SELECT digest,result FROM task_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, request.idempotency_key) as
          { digest: string; result: string } | undefined;
        if (old)
          return old.digest === digest
            ? taskResponseSchema.parse(JSON.parse(old.result))
            : fail('CONFLICT', '同一提交身份已用于不同内容，请核对原结果。');
        if (request.operation === 'set_calendar_type') {
          const types = calendarTypes(db, workspace),
            previous = types.find((v) => v.id === request.type.id);
          if ((previous?.version ?? 0) !== request.type.version)
            return fail('CONFLICT', '类型已有更新，请核对后再保存。');
          if (types.some((v) => v.id !== request.type.id && v.name === request.type.name))
            return fail('INVALID_REQUEST', '类型名称已存在。');
          db.prepare(
            'INSERT INTO calendar_types(workspace_id,id,name,enabled,show_home,version) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,show_home=excluded.show_home,version=excluded.version',
          ).run(
            workspace,
            request.type.id,
            request.type.name,
            +request.type.enabled,
            +request.type.show_home,
            request.type.version + 1,
          );
          const result = {
            ...ok([], null, request.idempotency_key),
            calendar_types: calendarTypes(db, workspace),
          };
          db.prepare(
            'INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)',
          ).run(workspace, request.idempotency_key, digest, JSON.stringify(result));
          return result;
        }
        let taskId: string;
        let savedSnapshots: DeliverySnapshot[] | undefined;
        let snapshotCreated: boolean | undefined;
        let objective = 'objective' in request ? request.objective : '';
        const rich = 'objective_state' in request ? request.objective_state : undefined;
        if (rich) {
          try {
            objective = bodyPlainText(Uint8Array.from(rich));
          } catch {
            return fail('INVALID_REQUEST', '任务说明格式不支持，输入已保留。');
          }
          if (objective.length > 4000)
            return fail('INVALID_REQUEST', '任务说明超过4000字符，输入已保留。');
        }
        if (request.operation === 'create') {
          if (
            request.matter_id &&
            !db
              .prepare(
                'SELECT id FROM matters WHERE id=? AND workspace_id=? AND archived_at IS NULL',
              )
              .get(request.matter_id, workspace)
          )
            return fail('NOT_FOUND', '项目不存在、已归档或不在当前工作区。请核对所选项目。');
          taskId = randomUUID();
          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO task_items(id,workspace_id,title,objective,version,updated_at,status,priority,due_date,tags${hasSubscription ? ',subscribed' : ''}) VALUES(?,?,?,?,1,?,?,?,?,?${hasSubscription ? ',1' : ''})`,
          ).run(
            taskId,
            workspace,
            request.title,
            objective,
            now,
            request.status ?? 'todo',
            request.priority ?? 0,
            request.due_date ?? null,
            JSON.stringify(request.tags ?? []),
          );
          if (request.matter_id)
            db.prepare('INSERT INTO task_projects(task_id,matter_id) VALUES(?,?)').run(
              taskId,
              request.matter_id,
            );
          db.prepare(
            'INSERT INTO documents(id,task_id,body_id,body_revision,editor_schema) VALUES(?,?,?,0,1)',
          ).run(randomUUID(), taskId, randomUUID());
        } else {
          taskId = request.task_id;
          const task = get(taskId);
          if (!task) return fail('NOT_FOUND', '任务不存在或不在当前工作区。');
          if (request.operation === 'set_subscription') {
            if (!hasSubscription) return fail('CONFLICT', '此工作区尚未升级订阅格式。');
            if (task.subscribed !== request.expected_subscribed)
              return fail('CONFLICT', '订阅状态已更新，请重新读取任务后核对。');
            db.prepare('UPDATE task_items SET subscribed=? WHERE id=? AND workspace_id=?').run(
              Number(request.subscribed),
              taskId,
              workspace,
            );
          } else if (request.operation === 'create_snapshot') {
            const fixed = snapshots.create(request, task);
            if (!fixed.ok) return fixed;
            savedSnapshots = [fixed.snapshot];
            snapshotCreated = fixed.created;
          } else if (request.operation === 'update') {
            if (task.version !== request.expected_version)
              return fail('CONFLICT', '任务已更新，请重新读取后核对。');
            if (!rich && objective !== task.objective && objectiveState(task.id, task.version))
              return fail(
                'CONFLICT',
                '任务说明包含富文本，请用支持富文本的编辑器修改，原格式已保留。',
              );
            db.prepare(
              'UPDATE task_items SET title=?,objective=?,version=version+1,updated_at=? WHERE id=?',
            ).run(request.title, objective, new Date().toISOString(), taskId);
          } else if (request.operation === 'update_calendar') {
            if (task.version !== request.expected_version)
              return fail('CONFLICT', '任务已更新，请重新读取后核对。');
            const type = calendarTypes(db, workspace).find(
              (v) => v.id === request.calendar.type_id,
            );
            if (
              request.calendar.type_id &&
              (!type ||
                (!type.enabled &&
                  (request.calendar.type_id !== task.calendar?.type_id ||
                    (!task.calendar?.important && request.calendar.important))))
            )
              return fail('INVALID_REQUEST', '请选择启用的重要类型；原停用引用可以保留。');
            if (
              !calendarConfirmation &&
              JSON.stringify(task.calendar) === JSON.stringify(request.calendar)
            )
              return fail('INVALID_REQUEST', '日历属性没有变化。');
            db.prepare(
              `UPDATE task_items SET planned_date=?,schedule_date=?,schedule_start=?,schedule_end=?,schedule_timezone=?,is_important=?,important_type_id=?,attention_source=?,attention_date=?,attention_time=?${hasTimezone ? ',attention_timezone=?' : ''},version=version+1,updated_at=? WHERE id=? AND workspace_id=?`,
            ).run(
              ...calendarValues(request.calendar),
              ...(hasTimezone
                ? [
                    request.calendar.attention_timezone === undefined &&
                    request.calendar.attention_source === task.calendar?.attention_source &&
                    request.calendar.attention_date === task.calendar?.attention_date &&
                    request.calendar.attention_time === task.calendar?.attention_time
                      ? (task.calendar?.attention_timezone ?? null)
                      : (request.calendar.attention_timezone ?? null),
                  ]
                : []),
              new Date().toISOString(),
              taskId,
              workspace,
            );
          } else if (request.operation === 'update_attributes') {
            if (task.version !== request.expected_version)
              return fail('CONFLICT', '任务已更新，请重新读取后核对。');
            // 旧请求省略属性时保留当前值；null 是明确清空，不能按省略处理。
            const assignee = request.assignee === undefined ? task.assignee : request.assignee;
            const tags = JSON.stringify(request.tags ?? task.tags);
            if (
              task.priority === request.priority &&
              task.due_date === request.due_date &&
              assignee === task.assignee &&
              tags === JSON.stringify(task.tags)
            )
              return fail('INVALID_REQUEST', '任务属性没有变化。');
            db.prepare(
              'UPDATE task_items SET priority=?,due_date=?,tags=?,assignee=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=?',
            ).run(
              request.priority,
              request.due_date,
              tags,
              assignee,
              new Date().toISOString(),
              taskId,
              workspace,
            );
          } else if (request.operation === 'change_status') {
            if (task.version !== request.expected_version)
              return fail('CONFLICT', '任务已更新，请重新读取后核对。');
            if (task.status === request.status)
              return fail('INVALID_REQUEST', '任务状态没有变化。');
            db.prepare(
              'UPDATE task_items SET status=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=?',
            ).run(request.status, new Date().toISOString(), taskId, workspace);
          } else {
            if (task.document_archived_at) return fail('CONFLICT', '正文已归档，请恢复后再保存。');
            if (task.document_id !== request.document_id || task.body_id !== request.body_id)
              return fail('FORBIDDEN', '正文与当前任务不匹配。');
            if (task.editor_schema !== 1 || task.body_revision !== request.expected_revision)
              return fail('CONFLICT', '正文已有新修订或格式不兼容，请核对后再保存。');
            try {
              validateBody(Uint8Array.from(request.state), true);
            } catch {
              return fail('INVALID_REQUEST', '正文结构或格式不支持，原修订已保留。');
            }
            const next = task.body_revision + 1;
            db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,?,?)').run(
              task.body_id,
              next,
              Buffer.from(request.state),
            );
            db.prepare('UPDATE documents SET body_revision=? WHERE id=?').run(
              next,
              task.document_id,
            );
            db.prepare('UPDATE task_items SET updated_at=? WHERE id=?').run(
              new Date().toISOString(),
              taskId,
            );
          }
        }
        const updated = get(taskId)!;
        if (rich)
          db.prepare(
            'INSERT INTO task_objective_revisions(task_id,task_version,state) VALUES(?,?,?)',
          ).run(taskId, updated.version, Buffer.from(rich));
        const result = {
          ...ok([updated], null, request.idempotency_key),
          ...(savedSnapshots
            ? { snapshots: savedSnapshots, snapshot_created: snapshotCreated }
            : {}),
        };
        if (snapshotCreated !== false)
          db.prepare(
            'INSERT INTO task_activity(id,task_id,operation,created_at) VALUES(?,?,?,?)',
          ).run(
            randomUUID(),
            taskId,
            request.operation === 'set_subscription'
              ? request.subscribed
                ? 'subscribe_task'
                : 'unsubscribe_task'
              : request.operation,
            new Date().toISOString(),
          );
        db.prepare('INSERT INTO task_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)').run(
          workspace,
          request.idempotency_key,
          digest,
          JSON.stringify(result),
        );
        return result;
      });
      // 创建先锁定写事务，保证校验项目与归组之间不会插入并发归档。
      return request.operation === 'create' ||
        request.operation === 'create_snapshot' ||
        request.operation === 'update_calendar' ||
        request.operation === 'set_calendar_type'
        ? commit.immediate()
        : commit();
    },
    close() {
      db.close();
    },
  };
  return api;
}
