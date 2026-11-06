import type Database from 'better-sqlite3';
import {
  materialSchema,
  materialPreviewSchema,
  type Material,
  type MaterialPreview,
  type MaterialScope,
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
};
export function createMaterialStore(db: Database.Database, workspace: string) {
  const stage = (token: string): StagedMaterial | undefined => {
    const row = db
      .prepare('SELECT payload FROM material_stages WHERE token=? AND workspace_id=?')
      .get(token, workspace) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as StagedMaterial) : undefined;
  };
  const putStage = (value: StagedMaterial) => {
    db.prepare(
      'INSERT INTO material_stages(token,workspace_id,payload) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload WHERE workspace_id=excluded.workspace_id',
    ).run(value.token, workspace, JSON.stringify(value));
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
        `SELECT s.id,s.task_id,s.asset_version_id,s.name,s.sha256,s.bytes,s.page_count,s.derivation_id,d.status,d.pages FROM material_sources s LEFT JOIN material_derivations d ON d.id=s.derivation_id WHERE s.id=? AND s.workspace_id=?`,
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
    stage,
    putStage,
    task,
    get,
    pending(scope: MaterialScope) {
      const row = db
        .prepare(
          "SELECT payload FROM material_stages WHERE workspace_id=? AND json_extract(payload,'$.scope')=? AND json_extract(payload,'$.state')='staged' ORDER BY rowid DESC LIMIT 1",
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
            'SELECT configuration FROM material_derivations WHERE id=? AND source_id IN (SELECT id FROM material_sources WHERE workspace_id=?)',
          )
          .get(id, workspace) as { configuration: string } | undefined
      )?.configuration;
    },
    recover() {
      db.prepare(
        "UPDATE material_derivations SET status='interrupted' WHERE status='processing' AND source_id IN (SELECT id FROM material_sources WHERE workspace_id=?)",
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
