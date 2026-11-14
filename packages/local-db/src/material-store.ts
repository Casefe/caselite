import type Database from 'better-sqlite3';
import {
  materialSchema,
  materialPreviewSchema,
  type Material,
  type MaterialPreview,
  type MaterialScope,
  materialBatchSchema,
  type MaterialBatch,
  creationDraftRecordSchema,
  type CreationDraftRecord,
} from '@caselite/contracts';
export type StagedMaterial = {
  token: string;
  scope: MaterialScope;
  name: string;
  bytes: number;
  sha256: string;
  state: 'staged' | 'committed' | 'cancelled';
  task_id?: string;
  restored_source_id?: string;
  batch_id?: string;
  creation_draft_id?: string;
};
export function createMaterialStore(db: Database.Database, workspace: string) {
  const hasOwners = (
    db.prepare('PRAGMA table_info(material_sources)').all() as Array<{ name: string }>
  ).some((c) => c.name === 'owner_kind');
  const taskOwner = (alias = '') => (hasOwners ? ` AND ${alias}owner_kind='task'` : '');
  const stage = (token: string): StagedMaterial | undefined => {
    const row = db
      .prepare(
        "SELECT payload FROM material_stages WHERE token=? AND workspace_id=? AND json_extract(payload,'$.kind') IS NULL",
      )
      .get(token, workspace) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as StagedMaterial) : undefined;
  };
  const putStage = (value: StagedMaterial) => {
    const saved = db
      .prepare(
        "INSERT INTO material_stages(token,workspace_id,payload) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload WHERE workspace_id=excluded.workspace_id AND json_valid(payload) AND json_extract(payload,'$.kind') IS NULL",
      )
      .run(value.token, workspace, JSON.stringify(value));
    if (saved.changes !== 1) throw new Error('Stage kind conflict');
  };
  const task = (scope: MaterialScope): string | undefined =>
    scope === 'home'
      ? (
          db.prepare('SELECT task_id FROM material_home WHERE workspace_id=?').get(workspace) as
            { task_id: string } | undefined
        )?.task_id
      : scope;
  const get = (id: string): Material | undefined => {
    const row = db
      .prepare(
        `SELECT s.id,s.task_id,s.asset_version_id,s.name,s.sha256,s.bytes,s.page_count,s.derivation_id,d.status,d.pages FROM material_sources s LEFT JOIN material_derivations d ON d.id=s.derivation_id WHERE s.id=? AND s.workspace_id=? ${taskOwner('s.')}`,
      )
      .get(id, workspace) as (Omit<Material, 'pages'> & { pages: string | null }) | undefined;
    return row
      ? materialSchema.parse({
          ...row,
          status: row.status ?? 'imported',
          pages: row.pages ? JSON.parse(row.pages) : [],
        })
      : undefined;
  };
  return {
    creationDraft(id: string): CreationDraftRecord | undefined {
      const row = db
        .prepare(
          "SELECT payload FROM material_stages WHERE token=? AND workspace_id=? AND json_extract(payload,'$.kind')='creation'",
        )
        .get(id, workspace) as { payload: string } | undefined;
      return row ? creationDraftRecordSchema.parse(JSON.parse(row.payload).draft) : undefined;
    },
    pendingCreationDraft(): CreationDraftRecord | undefined {
      const row = db
        .prepare(
          "SELECT payload FROM material_stages WHERE workspace_id=? AND json_extract(payload,'$.kind')='creation' AND json_extract(payload,'$.draft.state') IN ('open','bound') AND json_array_length(json_extract(payload,'$.draft.tokens'))>0 ORDER BY rowid DESC LIMIT 1",
        )
        .get(workspace) as { payload: string } | undefined;
      return row ? creationDraftRecordSchema.parse(JSON.parse(row.payload).draft) : undefined;
    },
    putCreationDraft(value: CreationDraftRecord, file?: StagedMaterial) {
      const draft = creationDraftRecordSchema.parse(value);
      db.transaction(() => {
        if (file) putStage(file);
        const saved = db
          .prepare(
            "INSERT INTO material_stages(token,workspace_id,payload) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload WHERE workspace_id=excluded.workspace_id AND json_extract(payload,'$.kind')='creation'",
          )
          .run(draft.id, workspace, JSON.stringify({ kind: 'creation', draft }));
        if (saved.changes !== 1) throw Error('Draft identity already reserved');
      })();
    },
    bindCreationDraft(value: CreationDraftRecord, taskId: string) {
      db.transaction(() => {
        for (const token of value.tokens) {
          const item = stage(token);
          if (!item || item.scope !== value.id || item.state !== 'staged')
            throw Error('Draft attachment changed');
          putStage({ ...item, scope: taskId, task_id: taskId });
        }
        db.prepare('UPDATE material_stages SET payload=? WHERE token=? AND workspace_id=?').run(
          JSON.stringify({
            kind: 'creation',
            draft: { ...value, state: 'bound', task_id: taskId },
          }),
          value.id,
          workspace,
        );
      })();
    },
    activeBatch(scope: MaterialScope): MaterialBatch | undefined {
      const row = db
        .prepare(
          "SELECT payload FROM material_stages WHERE workspace_id=? AND json_extract(payload,'$.kind')='batch' AND json_extract(payload,'$.scope')=? AND json_extract(payload,'$.batch.state')<>'dismissed' ORDER BY rowid DESC LIMIT 1",
        )
        .get(workspace, scope) as { payload: string } | undefined;
      return row ? materialBatchSchema.parse(JSON.parse(row.payload).batch) : undefined;
    },
    putBatch(value: MaterialBatch) {
      const batch = materialBatchSchema.parse(value);
      const saved = db
        .prepare(
          "INSERT INTO material_stages(token,workspace_id,payload) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload WHERE workspace_id=excluded.workspace_id AND json_valid(payload) AND json_extract(payload,'$.kind')='batch'",
        )
        .run(batch.id, workspace, JSON.stringify({ kind: 'batch', scope: batch.scope, batch }));
      if (saved.changes !== 1) throw new Error('Batch kind conflict');
    },
    stage,
    putStage,
    task,
    get,
    fixed(id: string, derivation: string): Material | undefined {
      const source = get(id);
      if (!source) return;
      const row = db
        .prepare('SELECT status,pages FROM material_derivations WHERE id=? AND source_id=?')
        .get(derivation, id) as { status: string; pages: string } | undefined;
      return row
        ? materialSchema.parse({
            ...source,
            derivation_id: derivation,
            status: row.status,
            pages: JSON.parse(row.pages),
          })
        : undefined;
    },
    projectSources(projectId: string): Material[] | undefined {
      if (
        !db
          .prepare('SELECT id FROM matters WHERE id=? AND workspace_id=? AND archived_at IS NULL')
          .get(projectId, workspace)
      )
        return undefined;
      const rows = db
        .prepare(
          `SELECT s.id FROM material_sources s
        JOIN task_items t ON t.id=s.task_id AND t.workspace_id=s.workspace_id
        JOIN task_projects p ON p.task_id=t.id
        WHERE s.workspace_id=? AND p.matter_id=? ORDER BY s.rowid`,
        )
        .all(workspace, projectId) as { id: string }[];
      return rows.map((row) => get(row.id)!);
    },
    pending(scope: MaterialScope) {
      const row = db
        .prepare(
          "SELECT payload FROM material_stages WHERE workspace_id=? AND json_extract(payload,'$.scope')=? AND json_extract(payload,'$.state')='staged' AND json_extract(payload,'$.batch_id') IS NULL AND json_extract(payload,'$.creation_draft_id') IS NULL ORDER BY rowid DESC LIMIT 1",
        )
        .get(workspace, scope) as { payload: string } | undefined;
      return row ? (JSON.parse(row.payload) as StagedMaterial) : undefined;
    },
    home(taskId: string) {
      db.prepare(
        'INSERT INTO material_home(workspace_id,task_id) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET task_id=excluded.task_id',
      ).run(workspace, taskId);
    },
    newHome() {
      db.prepare('DELETE FROM material_home WHERE workspace_id=?').run(workspace);
    },
    list(scope: MaterialScope): Material[] {
      const rows = db
        .prepare(
          'SELECT id FROM material_sources WHERE workspace_id=? AND task_id=? ORDER BY rowid',
        )
        .all(workspace, task(scope) ?? '') as { id: string }[];
      return rows.map((row) => get(row.id)!);
    },
    commit(value: StagedMaterial, taskId: string, pageCount: number) {
      return db.transaction(() => {
        const current = stage(value.token);
        if (!current || current.state === 'cancelled') throw new Error('Stage cancelled');
        const existing = get(value.token);
        if (existing) {
          if (existing.task_id !== taskId || existing.sha256 !== value.sha256)
            throw new Error('Identity conflict');
          return existing;
        }
        db.prepare(
          'INSERT INTO material_sources(id,workspace_id,task_id,asset_version_id,name,sha256,bytes,page_count) VALUES(?,?,?,?,?,?,?,?)',
        ).run(
          value.token,
          workspace,
          taskId,
          value.token,
          value.name,
          value.sha256,
          value.bytes,
          pageCount,
        );
        putStage({ ...value, state: 'committed', task_id: taskId });
        return get(value.token)!;
      })();
    },
    begin(sourceId: string, id: string, config: string, pages: Material['pages']) {
      db.transaction(() => {
        if (!get(sourceId)) throw new Error('Source missing');
        db.prepare(
          'INSERT INTO material_derivations(id,source_id,configuration,status,pages) VALUES(?,?,?,?,?)',
        ).run(id, sourceId, config, 'processing', JSON.stringify(pages));
        db.prepare('UPDATE material_sources SET derivation_id=? WHERE id=? AND workspace_id=?').run(
          id,
          sourceId,
          workspace,
        );
      })();
    },
    checkpoint(
      sourceId: string,
      derivationId: string,
      status: Material['status'],
      pages: Material['pages'],
    ) {
      const source = get(sourceId);
      if (source?.derivation_id !== derivationId || source.status !== 'processing') return false;
      materialSchema.parse({ ...source, status, pages });
      const r = db
        .prepare(
          'UPDATE material_derivations SET status=?,pages=? WHERE id=? AND source_id=? AND status=?',
        )
        .run(status, JSON.stringify(pages), derivationId, sourceId, 'processing');
      return r.changes === 1;
    },
    configuration(id: string) {
      return (
        db
          .prepare(
            `SELECT configuration FROM material_derivations WHERE id=? AND source_id IN (SELECT id FROM material_sources WHERE workspace_id=? ${taskOwner()})`,
          )
          .get(id, workspace) as { configuration: string } | undefined
      )?.configuration;
    },
    recover() {
      db.prepare(
        `UPDATE material_derivations SET status='interrupted' WHERE status='processing' AND source_id IN (SELECT id FROM material_sources WHERE workspace_id=? ${taskOwner()})`,
      ).run(workspace);
    },
    putPreview(scope: MaterialScope, preview: MaterialPreview) {
      db.prepare(
        'INSERT INTO material_previews(id,workspace_id,scope,payload) VALUES(?,?,?,?)',
      ).run(preview.id, workspace, scope, JSON.stringify(materialPreviewSchema.parse(preview)));
    },
    preview(id: string, scope: MaterialScope): MaterialPreview | undefined {
      const row = db
        .prepare('SELECT payload FROM material_previews WHERE id=? AND workspace_id=? AND scope=?')
        .get(id, workspace, scope) as { payload: string } | undefined;
      return row ? materialPreviewSchema.parse(JSON.parse(row.payload)) : undefined;
    },
  };
}
