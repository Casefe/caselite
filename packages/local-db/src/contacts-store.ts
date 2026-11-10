import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  contactSchema,
  contactEntrySchema,
  contactSourceRefSchema,
  parseContactRecord,
  agentRunSchema,
  type Contact,
  type ContactsRequest,
  type ContactsResponse,
} from '@caselite/contracts';
import { bodyPlainText } from './body-schema';

export function createContactsStore(db: Database.Database, workspace: string) {
  type Row = Omit<Contact, 'project_ids' | 'tags'> & { tags?: string };
  type Save = Extract<ContactsRequest, { operation: 'save' }>;
  const extended = (db.pragma('table_info(contacts)') as { name: string }[]).some(
    (v) => v.name === 'wechat',
  );
  const hasAddress = (db.pragma('table_info(contacts)') as { name: string }[]).some(
    (v) => v.name === 'address',
  );
  const columns = `${hasAddress ? 'address,' : ''}id,name,kind,phone,email,version,updated_at${extended ? ',wechat,company,position,city,relationship,tags' : ''}`;
  const getLinks = () =>
    db.prepare(
      'SELECT cp.project_id FROM contact_projects cp JOIN matters m ON m.id=cp.project_id AND m.workspace_id=cp.workspace_id WHERE cp.workspace_id=? AND cp.contact_id=? ORDER BY cp.project_id',
    );
  const getContact = () =>
    db.prepare(`SELECT ${columns} FROM contacts WHERE workspace_id=? AND id=?`);
  const decode = (row: Row) =>
    contactSchema.parse({
      ...row,
      tags: row.tags ? JSON.parse(row.tags) : [],
      last_contact: extended
        ? (
            db
              .prepare(
                "SELECT max(occurred_on) AS date FROM contact_entries WHERE workspace_id=? AND contact_id=? AND kind='communication'",
              )
              .get(workspace, row.id) as { date: string | null }
          ).date
        : null,
      project_ids: (getLinks().all(workspace, row.id) as { project_id: string }[]).map(
        (item) => item.project_id,
      ),
    });
  const conflict = (message: string): ContactsResponse => ({
    ok: false,
    code: 'CONFLICT',
    message,
  });
  const inaccessible = (): ContactsResponse => ({
    ok: false,
    code: 'FORBIDDEN',
    message: '联系人或关联对象不存在，或不属于当前工作区。',
  });
  const details = (contactId: string) => {
    const records = db
      .prepare(
        `SELECT e.*, b.state FROM contact_entries e JOIN body_revisions b ON b.body_id=e.body_id AND b.revision=e.body_revision WHERE e.workspace_id=? AND e.contact_id=? ORDER BY coalesce(e.occurred_on,substr(e.created_at,1,10)) DESC,e.created_at DESC,e.id`,
      )
      .all(workspace, contactId) as (Record<string, unknown> & { state: Buffer })[];
    const links = db
      .prepare('SELECT kind,target_id FROM contact_links WHERE workspace_id=? AND contact_id=?')
      .all(workspace, contactId) as { kind: string; target_id: string }[];
    return {
      contact_id: contactId,
      source_links: hasAddress
        ? db
            .prepare(
              'SELECT kind,source_id AS id,source_scope AS scope FROM contact_source_links WHERE workspace_id=? AND contact_id=? ORDER BY kind,source_id',
            )
            .all(workspace, contactId)
            .map((row) => contactSourceRefSchema.parse(row))
        : [],
      sources_unavailable: false,
      entries: records.map(({ state, workspace_id, ...row }) => {
        void workspace_id;
        return contactEntrySchema.parse({ ...row, content: bodyPlainText(state).trim() });
      }),
      task_ids: links.filter((v) => v.kind === 'task').map((v) => v.target_id),
      document_ids: links.filter((v) => v.kind === 'document').map((v) => v.target_id),
    };
  };
  const result = (contactId: string, receipt: string | null): ContactsResponse => {
    const row = getContact().get(workspace, contactId) as Row | undefined;
    return row
      ? {
          ok: true,
          receipt,
          contacts: [decode(row)],
          ...(extended ? { detail: details(contactId) } : {}),
        }
      : inaccessible();
  };

  // 联系人、关联和提交回执同事务。旧回执只证明原请求成功，返回当前已提交联系人版本。
  const save = db.transaction((request: Save): ContactsResponse => {
    const { contact_id, expected_version, receipt, name, kind, phone, email } = request;
    if (
      extended &&
      db
        .prepare('SELECT 1 FROM contact_workspace_receipts WHERE workspace_id=? AND key=?')
        .get(workspace, receipt)
    )
      return conflict('原提交身份已用于其他联系人操作。');
    const projectIds = [...request.project_ids].sort();
    const extras = Object.fromEntries(
      ['wechat', 'company', 'position', 'city', 'relationship', 'tags', 'address']
        .filter((key) => key in request)
        .map((key) => [key, request[key as keyof Save]]),
    );
    const digest = createHash('sha256')
      .update(
        JSON.stringify([
          contact_id,
          expected_version,
          name,
          kind,
          phone,
          email,
          projectIds,
          ...(Object.keys(extras).length ? [extras] : []),
        ]),
      )
      .digest('hex');
    const previous = db
      .prepare('SELECT digest, contact_id FROM contact_receipts WHERE workspace_id=? AND key=?')
      .get(workspace, receipt) as { digest: string; contact_id: string } | undefined;
    const current = getContact().get(workspace, contact_id) as Row | undefined;
    if (previous)
      return current && previous.digest === digest && previous.contact_id === contact_id
        ? { ok: true, receipt, contacts: [decode(current)] }
        : conflict('原提交身份与当前内容不符。');
    if ((current?.version ?? 0) !== expected_version) return conflict('联系人已更新，请重新读取。');
    const existingLinks = current ? decode(current).project_ids : [];
    const findProject = db.prepare('SELECT archived_at FROM matters WHERE id=? AND workspace_id=?');
    if (
      projectIds.some((id) => {
        const row = findProject.get(id, workspace) as { archived_at: string | null } | undefined;
        return !row || (row.archived_at && !existingLinks.includes(id));
      })
    )
      return { ok: false, code: 'FORBIDDEN', message: '关联项目不存在或不属于当前工作区。' };
    const updatedAt = new Date().toISOString();
    if (current) {
      db.prepare(
        'UPDATE contacts SET name=?,kind=?,phone=?,email=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=?',
      ).run(name, kind, phone, email, updatedAt, workspace, contact_id);
      db.prepare('DELETE FROM contact_projects WHERE workspace_id=? AND contact_id=?').run(
        workspace,
        contact_id,
      );
    } else {
      db.prepare(
        'INSERT INTO contacts(id,workspace_id,name,kind,phone,email,version,updated_at) VALUES(?,?,?,?,?,?,1,?)',
      ).run(contact_id, workspace, name, kind, phone, email, updatedAt);
    }
    if (extended && Object.keys(extras).length) {
      const original = current ? decode(current) : undefined;
      db.prepare(
        'UPDATE contacts SET wechat=?,company=?,position=?,city=?,relationship=?,tags=? WHERE workspace_id=? AND id=?',
      ).run(
        request.wechat ?? original?.wechat ?? '',
        request.company ?? original?.company ?? '',
        request.position ?? original?.position ?? '',
        request.city ?? original?.city ?? '',
        request.relationship ?? original?.relationship ?? '',
        JSON.stringify(request.tags ?? original?.tags ?? []),
        workspace,
        contact_id,
      );
    }
    if (hasAddress && request.address !== undefined)
      db.prepare('UPDATE contacts SET address=? WHERE workspace_id=? AND id=?').run(
        request.address,
        workspace,
        contact_id,
      );
    const addLink = db.prepare(
      'INSERT INTO contact_projects(workspace_id,contact_id,project_id) VALUES(?,?,?)',
    );
    for (const id of projectIds) addLink.run(workspace, contact_id, id);
    db.prepare(
      'INSERT INTO contact_receipts(workspace_id,key,digest,contact_id) VALUES(?,?,?,?)',
    ).run(workspace, receipt, digest, contact_id);
    return {
      ok: true,
      receipt,
      contacts: [decode(getContact().get(workspace, contact_id) as Row)],
    };
  });
  // 新记录、正文和回执同事务。AI 只能引用当前联系人的已落盘成功 Run，不能由 Renderer 伪造来源。
  const saveWorkspace = db.transaction(
    (
      request: Extract<
        ContactsRequest,
        { operation: 'save_entry' | 'set_links' | 'set_source_links' }
      >,
    ): ContactsResponse => {
      if (!extended)
        return { ok: false, code: 'UNAVAILABLE', message: '联系人工作区尚未升级，请重启后重试。' };
      const parent = getContact().get(workspace, request.contact_id) as Row | undefined;
      if (!parent) return inaccessible();
      const { receipt, ...payload } = request;
      const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const old = db
        .prepare(
          'SELECT digest,contact_id FROM contact_workspace_receipts WHERE workspace_id=? AND key=?',
        )
        .get(workspace, receipt) as { digest: string; contact_id: string } | undefined;
      if (old)
        return old.digest === digest && old.contact_id === request.contact_id
          ? result(request.contact_id, receipt)
          : conflict('同一提交身份已用于其他内容。');
      if (
        db
          .prepare('SELECT 1 FROM contact_receipts WHERE workspace_id=? AND key=?')
          .get(workspace, receipt)
      )
        return conflict('原提交身份已用于联系人资料。');
      if (request.operation === 'set_source_links') {
        if (!hasAddress)
          return { ok: false, code: 'UNAVAILABLE', message: '往来来源尚未升级，请重启后重试。' };
        if (parent.version !== request.expected_version)
          return conflict('联系人关联已变化，请重新读取。');
        const sourceExists = (
          source: Extract<
            ContactsRequest,
            { operation: 'set_source_links' }
          >['source_refs'][number],
        ) => {
          if (source.kind === 'run')
            return Boolean(
              db
                .prepare('SELECT 1 FROM agent_runs WHERE workspace_id=? AND id=? AND scope=?')
                .get(workspace, source.id, source.scope),
            );
          if (source.kind === 'material')
            return Boolean(
              db
                .prepare(
                  'SELECT 1 FROM material_sources WHERE workspace_id=? AND id=? AND task_id=?',
                )
                .get(workspace, source.id, source.scope),
            );
          return Boolean(
            db
              .prepare(
                'SELECT 1 FROM finance_payments p JOIN finance_installments i ON i.id=p.installment_id JOIN matters m ON m.id=i.project_id WHERE m.workspace_id=? AND m.id=? AND p.id=?',
              )
              .get(workspace, source.scope, source.id),
          );
        };
        if (request.source_refs.some((source) => !sourceExists(source))) return inaccessible();
        // 来源访问由 Application 调用原 Owner 核验；这里只保存关系，不复制正文或财务事实。
        db.prepare(
          'DELETE FROM contact_source_links WHERE workspace_id=? AND contact_id=? AND kind=?',
        ).run(workspace, parent.id, request.kind);
        const insert = db.prepare(
          'INSERT INTO contact_source_links(workspace_id,contact_id,kind,source_id,source_scope,linked_at) VALUES(?,?,?,?,?,?)',
        );
        const now = new Date().toISOString();
        for (const source of request.source_refs)
          insert.run(workspace, parent.id, source.kind, source.id, source.scope, now);
        db.prepare(
          'UPDATE contacts SET version=version+1,updated_at=? WHERE workspace_id=? AND id=?',
        ).run(now, workspace, parent.id);
      } else if (request.operation === 'set_links') {
        if (parent.version !== request.expected_version)
          return conflict('联系人关联已变化，请重新读取。');
        const existing = db
          .prepare(
            'SELECT target_id FROM contact_links WHERE workspace_id=? AND contact_id=? AND kind=?',
          )
          .all(workspace, parent.id, request.kind) as { target_id: string }[];
        const query =
          request.kind === 'task'
            ? 'SELECT 1 FROM task_items WHERE id=? AND workspace_id=?'
            : 'SELECT 1 FROM documents d JOIN task_items t ON t.id=d.task_id WHERE d.id=? AND t.workspace_id=? AND (d.archived_at IS NULL OR ?)';
        if (
          request.target_ids.some(
            (id) =>
              !db
                .prepare(query)
                .get(
                  id,
                  workspace,
                  ...(request.kind === 'document'
                    ? [Number(existing.some((v) => v.target_id === id))]
                    : []),
                ),
          )
        )
          return inaccessible();
        db.prepare(
          'DELETE FROM contact_links WHERE workspace_id=? AND contact_id=? AND kind=?',
        ).run(workspace, parent.id, request.kind);
        const insert = db.prepare(
          'INSERT INTO contact_links(workspace_id,contact_id,kind,target_id) VALUES(?,?,?,?)',
        );
        for (const id of request.target_ids) insert.run(workspace, parent.id, request.kind, id);
        db.prepare(
          'UPDATE contacts SET version=version+1,updated_at=? WHERE workspace_id=? AND id=?',
        ).run(new Date().toISOString(), workspace, parent.id);
      } else {
        const current = db
          .prepare(
            'SELECT contact_id,body_id,body_revision,version,kind,source_run_id FROM contact_entries WHERE workspace_id=? AND id=?',
          )
          .get(workspace, request.entry_id) as
          | {
              contact_id: string;
              body_id: string;
              body_revision: number;
              version: number;
              kind: string;
              source_run_id: string | null;
            }
          | undefined;
        if (current && current.contact_id !== parent.id) return inaccessible();
        if ((current?.version ?? 0) !== request.expected_version)
          return conflict('记录已保存或已更新，请重新读取。');
        if (
          current &&
          (current.kind !== request.kind ||
            current.source_run_id !== (request.source_run_id ?? null))
        )
          return conflict('记录类型与原来源不能改变。');
        if (request.source_run_id) {
          const row = db
            .prepare('SELECT scope,payload FROM agent_runs WHERE workspace_id=? AND id=?')
            .get(workspace, request.source_run_id) as
            { scope: string; payload: string } | undefined;
          if (!row || row.scope !== `contact:${parent.id}` || request.kind !== 'communication')
            return inaccessible();
          const stored = JSON.parse(row.payload);
          const run = agentRunSchema.safeParse({ ...stored, scope: row.scope });
          if (
            !run.success ||
            run.data.status !== 'succeeded' ||
            run.data.output_incomplete ||
            !parseContactRecord(run.data.output)
          )
            return conflict('AI 记录尚未成功完成，不能保存。');
          const duplicate = db
            .prepare('SELECT id FROM contact_entries WHERE workspace_id=? AND source_run_id=?')
            .get(workspace, request.source_run_id) as { id: string } | undefined;
          if (duplicate && duplicate.id !== request.entry_id)
            return conflict('本轮 AI 记录已保存，请查看原记录。');
        }
        const state = Buffer.from(request.state);
        let content: string;
        try {
          content = bodyPlainText(state).trim();
        } catch {
          return {
            ok: false,
            code: 'INVALID_REQUEST',
            message: '记录正文格式不支持，草稿已保留。',
          };
        }
        if (!content || content.length > 8000 || content.includes('\0'))
          return { ok: false, code: 'INVALID_REQUEST', message: '请输入1至8000字的记录内容。' };
        const bodyId = current?.body_id ?? randomUUID(),
          revision = (current?.body_revision ?? 0) + 1,
          now = new Date().toISOString();
        db.prepare('INSERT INTO body_revisions(body_id,revision,state) VALUES(?,?,?)').run(
          bodyId,
          revision,
          state,
        );
        if (current)
          db.prepare(
            'UPDATE contact_entries SET title=?,channel=?,occurred_on=?,body_revision=?,version=version+1,updated_at=? WHERE workspace_id=? AND id=?',
          ).run(
            request.title,
            request.channel,
            request.occurred_on,
            revision,
            now,
            workspace,
            request.entry_id,
          );
        else
          db.prepare(
            'INSERT INTO contact_entries(workspace_id,contact_id,id,kind,title,channel,occurred_on,body_id,body_revision,version,source_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)',
          ).run(
            workspace,
            parent.id,
            request.entry_id,
            request.kind,
            request.title,
            request.channel,
            request.occurred_on,
            bodyId,
            revision,
            request.source_run_id ?? null,
            now,
            now,
          );
      }
      db.prepare(
        'INSERT INTO contact_workspace_receipts(workspace_id,key,digest,contact_id) VALUES(?,?,?,?)',
      ).run(workspace, receipt, digest, parent.id);
      return result(parent.id, receipt);
    },
  );
  return {
    replay(
      request: Extract<ContactsRequest, { operation: 'set_source_links' }>,
    ): ContactsResponse | undefined {
      const previous = db
        .prepare(
          'SELECT digest,contact_id FROM contact_workspace_receipts WHERE workspace_id=? AND key=?',
        )
        .get(workspace, request.receipt) as { digest: string; contact_id: string } | undefined;
      if (!previous) return undefined;
      const { receipt, ...payload } = request;
      void receipt;
      const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      return previous.digest === digest && previous.contact_id === request.contact_id
        ? result(request.contact_id, request.receipt)
        : conflict('同一提交身份已用于其他内容。');
    },
    exists(id: string) {
      return Boolean(
        db.prepare('SELECT 1 FROM contacts WHERE workspace_id=? AND id=?').get(workspace, id),
      );
    },
    execute(request: ContactsRequest): ContactsResponse {
      if (request.operation === 'save') return save.immediate(request);
      if (
        request.operation === 'save_entry' ||
        request.operation === 'set_links' ||
        request.operation === 'set_source_links'
      )
        return saveWorkspace.immediate(request);
      if (request.operation === 'read') return result(request.contact_id, null);
      const rows = db
        .prepare(
          `SELECT ${columns} FROM contacts WHERE workspace_id=? ORDER BY name COLLATE NOCASE,id`,
        )
        .all(workspace) as Row[];
      return { ok: true, receipt: null, contacts: rows.map(decode) };
    },
  };
}
