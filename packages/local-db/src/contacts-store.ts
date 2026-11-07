import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  contactSchema,
  type Contact,
  type ContactsRequest,
  type ContactsResponse,
} from '@caselite/contracts';

export function createContactsStore(db: Database.Database, workspace: string) {
  type Row = Omit<Contact, 'project_ids'>;
  type Save = Extract<ContactsRequest, { operation: 'save' }>;
  const getLinks = () =>
    db.prepare(
      'SELECT cp.project_id FROM contact_projects cp JOIN matters m ON m.id=cp.project_id AND m.workspace_id=cp.workspace_id WHERE cp.workspace_id=? AND cp.contact_id=? ORDER BY cp.project_id',
    );
  const getContact = () =>
    db.prepare(
      'SELECT id,name,kind,phone,email,version,updated_at FROM contacts WHERE workspace_id=? AND id=?',
    );
  const decode = (row: Row) =>
    contactSchema.parse({
      ...row,
      project_ids: (getLinks().all(workspace, row.id) as { project_id: string }[]).map(
        (item) => item.project_id,
      ),
    });
  const conflict = (message: string): ContactsResponse => ({
    ok: false,
    code: 'CONFLICT',
    message,
  });

  // 联系人、关联和提交回执同事务。旧回执只证明原请求成功，返回当前已提交联系人版本。
  const save = db.transaction((request: Save): ContactsResponse => {
    const { contact_id, expected_version, receipt, name, kind, phone, email } = request;
    const projectIds = [...request.project_ids].sort();
    const digest = createHash('sha256')
      .update(JSON.stringify([contact_id, expected_version, name, kind, phone, email, projectIds]))
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
    const findProject = db.prepare('SELECT 1 FROM matters WHERE id=? AND workspace_id=?');
    if (projectIds.some((id) => !findProject.get(id, workspace)))
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
  return {
    execute(request: ContactsRequest): ContactsResponse {
      if (request.operation === 'save') return save.immediate(request);
      const rows = db
        .prepare(
          'SELECT id,name,kind,phone,email,version,updated_at FROM contacts WHERE workspace_id=? ORDER BY name COLLATE NOCASE,id',
        )
        .all(workspace) as Row[];
      return { ok: true, receipt: null, contacts: rows.map(decode) };
    },
  };
}
