import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  capturePhaseSchema,
  folderScopeSchema,
  materialKind,
  personalMaterialSchema,
  personalMaterialHeaderSchema,
  MATERIAL_MAX_BYTES,
  type FolderScope,
  type PersonalMaterial,
  type PersonalMaterialHeader,
} from '@caselite/contracts';
import type {
  FolderCaptureTarget,
  PersonalCaptureJournal,
  PersonalMaterialStorePort,
} from './folder-store-records';
import { createFolderConfigurationStore } from './folder-configuration-store';

type Mapping = {
  id: string;
  binding_id: string;
  relative_name: string;
  entry_hint: string;
  revision: number;
  current_source_id: string | null;
};
const uuid = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const integer = (s: unknown) => typeof s === 'number' && Number.isSafeInteger(s) && s >= 0;
const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const sameScope = (a: FolderScope, b: FolderScope) => JSON.stringify(a) === JSON.stringify(b);
const safeRelative = (s: string) =>
  s.length > 0 &&
  s.length <= 4096 &&
  !s.includes('\\') &&
  s.split('/').every((p) => p && p !== '.' && p !== '..');

export function createPersonalMaterialStore(
  db: Database.Database,
  workspace: string,
): PersonalMaterialStorePort {
  const config = createFolderConfigurationStore(db, workspace);
  const key = (id: string) => {
    if (!uuid(id)) throw new Error('INVALID_REQUEST');
    return `personal-capture:v2:${id}`;
  };
  function parse(payload: string): PersonalCaptureJournal {
    const j = JSON.parse(payload) as PersonalCaptureJournal;
    if (
      !j ||
      j.kind !== 'personal_capture_v2' ||
      j.stage_schema_version !== 2 ||
      j.owner?.kind !== 'personal' ||
      j.owner.workspace_id !== workspace ||
      !uuid(j.request_id) ||
      !hash(j.wire_digest) ||
      !uuid(j.capture_token) ||
      !uuid(j.planned_source_id) ||
      !uuid(j.planned_derivation_id) ||
      !j.target ||
      !uuid(j.target.mapping_id) ||
      !uuid(j.target.binding_id) ||
      typeof j.target.relative_name !== 'string' ||
      !safeRelative(j.target.relative_name) ||
      typeof j.target.entry_hint !== 'string' ||
      !integer(j.target.mapping_revision) ||
      !integer(j.target.default_revision) ||
      !(j.target.project_revision === null || integer(j.target.project_revision)) ||
      typeof j.interrupted !== 'boolean' ||
      typeof j.needs_reselect !== 'boolean'
    )
      throw new Error('SOURCE_UNAVAILABLE');
    folderScopeSchema.parse(j.target.scope);
    capturePhaseSchema.parse(j.phase);
    if (
      j.snapshot &&
      (!hash(j.snapshot.sha256) ||
        !integer(j.snapshot.bytes) ||
        j.snapshot.bytes < 8 ||
        j.snapshot.bytes > MATERIAL_MAX_BYTES ||
        !j.snapshot.name ||
        j.snapshot.name.length > 512 ||
        materialKind(j.snapshot.name) !== j.snapshot.kind)
    )
      throw new Error('SOURCE_UNAVAILABLE');
    if (j.phase !== 'reserved' && j.phase !== 'cancelled' && !j.snapshot)
      throw new Error('SOURCE_UNAVAILABLE');
    if (j.reuse_source_id && !uuid(j.reuse_source_id)) throw new Error('SOURCE_UNAVAILABLE');
    if (
      j.phase === 'ready' &&
      (!j.result ||
        !uuid(j.result.source_id) ||
        !uuid(j.result.asset_version_id) ||
        !hash(j.result.sha256))
    )
      throw new Error('SOURCE_UNAVAILABLE');
    return j;
  }
  const read = (id: string) => {
    const row = db
      .prepare('SELECT payload FROM material_stages WHERE token=? AND workspace_id=?')
      .get(key(id), workspace) as { payload: string } | undefined;
    if (!row) return;
    const j = parse(row.payload);
    if (j.request_id !== id) throw new Error('RECEIPT_CONFLICT');
    return j;
  };
  const save = (j: PersonalCaptureJournal) => {
    const payload = JSON.stringify(j);
    parse(payload);
    const result = db
      .prepare(
        `INSERT INTO material_stages VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload
      WHERE workspace_id=excluded.workspace_id AND json_valid(payload)
      AND json_extract(payload,'$.kind')='personal_capture_v2' AND json_extract(payload,'$.stage_schema_version')=2`,
      )
      .run(key(j.request_id), workspace, payload);
    if (result.changes !== 1) throw new Error('RECEIPT_CONFLICT');
    return j;
  };
  function assertTarget(t: FolderCaptureTarget) {
    const root = config.currentDefault();
    if (!root || root.binding_id !== t.binding_id || root.revision !== t.default_revision)
      throw new Error('ROOT_EXPIRED');
    if (t.scope.kind === 'project') {
      const p = config.project(t.scope.project_id);
      if (
        !p ||
        p.root_binding_id !== t.binding_id ||
        p.revision !== t.project_revision ||
        !t.relative_name.startsWith(p.relative_directory + '/')
      )
        throw new Error('FORBIDDEN');
    } else if (t.project_revision !== null) throw new Error('FORBIDDEN');
  }
  function scopeMapping(scope: FolderScope, m: Mapping) {
    if (scope.kind === 'workspace') return true;
    const p = config.project(scope.project_id);
    return (
      !!p &&
      m.binding_id === p.root_binding_id &&
      m.relative_name.startsWith(p.relative_directory + '/')
    );
  }
  const mapping = (binding: string, name: string) =>
    db
      .prepare(
        'SELECT * FROM folder_mappings WHERE workspace_id=? AND binding_id=? AND relative_name=?',
      )
      .get(workspace, binding, name) as Mapping | undefined;
  const sourceFields =
    's.id,s.owner_kind,s.asset_version_id,s.name,s.sha256,s.bytes,s.page_count,s.derivation_id,d.status';
  const sourceHeader = (id: string): PersonalMaterialHeader | undefined => {
    const row = db
      .prepare(
        `SELECT ${sourceFields}
      FROM material_sources s JOIN material_derivations d ON d.id=s.derivation_id AND d.source_id=s.id
      WHERE s.workspace_id=? AND s.id=? AND s.owner_kind='personal' AND s.task_id IS NULL`,
      )
      .get(workspace, id) as Omit<PersonalMaterialHeader, 'kind'> | undefined;
    return row
      ? personalMaterialHeaderSchema.parse({ ...row, kind: materialKind(row.name) })
      : undefined;
  };
  const source = (id: string): PersonalMaterial | undefined => {
    const row = db
      .prepare(
        `SELECT s.id,s.owner_kind,s.asset_version_id,s.name,s.sha256,s.bytes,s.page_count,s.derivation_id,d.status,d.pages
      FROM material_sources s JOIN material_derivations d ON d.id=s.derivation_id AND d.source_id=s.id
      WHERE s.workspace_id=? AND s.id=? AND s.owner_kind='personal' AND s.task_id IS NULL`,
      )
      .get(workspace, id) as
      (Omit<PersonalMaterial, 'kind' | 'pages'> & { pages: string }) | undefined;
    return row
      ? personalMaterialSchema.parse({
          ...row,
          kind: materialKind(row.name),
          pages: JSON.parse(row.pages),
        })
      : undefined;
  };
  const currentSource = (t: FolderCaptureTarget) => {
    assertTarget(t);
    const m = mapping(t.binding_id, t.relative_name);
    return m && m.entry_hint === t.entry_hint && m.current_source_id
      ? source(m.current_source_id)
      : undefined;
  };
  function assertSourceScope(scope: FolderScope, id: string, mappingId?: string) {
    if (!sourceHeader(id)) throw new Error('FORBIDDEN');
    if (scope.kind === 'workspace' && !mappingId) return;
    const rows = db
      .prepare('SELECT * FROM folder_mappings WHERE workspace_id=? AND current_source_id=?')
      .all(workspace, id) as Mapping[];
    if (rows.some((m) => (!mappingId || m.id === mappingId) && scopeMapping(scope, m))) return;
    if (!mappingId && scope.kind === 'project') {
      const history = db
        .prepare(
          `SELECT payload FROM material_stages WHERE workspace_id=? AND json_valid(payload)
        AND json_extract(payload,'$.kind')='personal_capture_v2' AND json_extract(payload,'$.phase')='ready'
        AND json_extract(payload,'$.result.source_id')=?`,
        )
        .all(workspace, id) as Array<{ payload: string }>;
      if (
        history.some((row) => {
          const j = parse(row.payload);
          const m = mapping(j.target.binding_id, j.target.relative_name);
          return !!m && m.id === j.target.mapping_id && scopeMapping(scope, m);
        })
      )
        return;
    }
    throw new Error('FORBIDDEN');
  }
  const pending: PersonalMaterialStorePort['pending'] = (scope) => {
    if (scope.kind === 'project') config.project(scope.project_id);
    const rows = db
      .prepare(
        `SELECT payload FROM material_stages WHERE workspace_id=? AND json_valid(payload)
      AND json_extract(payload,'$.kind')='personal_capture_v2' AND json_extract(payload,'$.phase') NOT IN ('ready','cancelled')
      AND json_extract(payload,'$.target.scope.kind')=?
      AND (? IS NULL OR json_extract(payload,'$.target.scope.project_id')=?) ORDER BY rowid DESC LIMIT 257`,
      )
      .all(
        workspace,
        scope.kind,
        scope.kind === 'project' ? scope.project_id : null,
        scope.kind === 'project' ? scope.project_id : null,
      ) as Array<{ payload: string }>;
    const result = rows
      .map((r) => parse(r.payload))
      .filter((j) => sameScope(j.target.scope, scope));
    if (result.length > 256) throw new Error('DIRECTORY_LIMIT');
    return result.map((j) => ({
      request_id: j.request_id,
      phase: j.phase,
      needs_reselect: j.needs_reselect,
      relative_label: j.target.relative_name,
    }));
  };
  return {
    workspace,
    read,
    source,
    currentSource,
    pending,
    assertSourceScope,
    mappingRevision: (binding, name) => mapping(binding, name)?.revision ?? 0,
    reserve: (requestId, target, wireDigest) =>
      db
        .transaction(() => {
          const old = read(requestId);
          if (old) {
            if (old.wire_digest !== wireDigest || !sameScope(old.target.scope, target.scope))
              throw new Error('RECEIPT_CONFLICT');
            return old;
          }
          assertTarget(target);
          if (!safeRelative(target.relative_name)) throw new Error('INVALID_REQUEST');
          let m = mapping(target.binding_id, target.relative_name);
          if ((m?.revision ?? 0) !== target.mapping_revision) throw new Error('REVISION_CONFLICT');
          if (!m) {
            const id = randomUUID();
            db.prepare('INSERT INTO folder_mappings VALUES(?,?,?,?,1,?,0,NULL)').run(
              id,
              workspace,
              target.binding_id,
              target.relative_name,
              target.entry_hint,
            );
            m = mapping(target.binding_id, target.relative_name)!;
          }
          const active = db
            .prepare(
              `SELECT payload FROM material_stages WHERE workspace_id=? AND json_valid(payload)
        AND json_extract(payload,'$.kind') IN ('personal_capture_v1','personal_capture_v2') AND json_extract(payload,'$.target.mapping_id')=?
        AND json_extract(payload,'$.phase') IN ('reserved','snapshot_planned','staged','placed')`,
            )
            .get(workspace, m.id);
          if (active) throw new Error('BUSY');
          return save({
            kind: 'personal_capture_v2',
            stage_schema_version: 2,
            request_id: requestId,
            wire_digest: wireDigest,
            owner: { kind: 'personal', workspace_id: workspace },
            target: { ...target, mapping_id: m.id },
            capture_token: randomUUID(),
            planned_source_id: randomUUID(),
            planned_derivation_id: randomUUID(),
            phase: 'reserved',
            interrupted: false,
            needs_reselect: false,
          });
        })
        .immediate(),
    advance: (id, previous, update) =>
      db
        .transaction(() => {
          const j = read(id);
          if (!j) throw new Error('NOT_FOUND');
          if (j.phase === 'cancelled') throw new Error('CANCELLED');
          if (j.phase !== previous || j.phase === 'ready') throw new Error('REVISION_CONFLICT');
          assertTarget(j.target);
          const allowed: Record<string, string[]> = {
            reserved: ['snapshot_planned'],
            snapshot_planned: ['staged', 'placed'],
            staged: ['placed'],
            placed: [],
          };
          if (
            update.phase &&
            update.phase !== previous &&
            !allowed[previous]?.includes(update.phase)
          )
            throw new Error('REVISION_CONFLICT');
          if (
            update.phase === 'placed' &&
            previous === 'snapshot_planned' &&
            !update.reuse_source_id
          )
            throw new Error('REVISION_CONFLICT');
          return save({ ...j, ...update });
        })
        .immediate(),
    commit: (id, pageCount, configuration, pages) =>
      db
        .transaction(() => {
          const j = read(id);
          if (!j) throw new Error('NOT_FOUND');
          if (j.phase === 'ready') return { journal: j, source: source(j.result!.source_id)! };
          if (j.phase !== 'placed' || !j.snapshot)
            throw new Error(j.phase === 'cancelled' ? 'CANCELLED' : 'CAPTURE_PENDING');
          assertTarget(j.target);
          const m = mapping(j.target.binding_id, j.target.relative_name);
          if (!m || m.id !== j.target.mapping_id || m.revision !== j.target.mapping_revision)
            throw new Error('REVISION_CONFLICT');
          let value: PersonalMaterial;
          if (j.reuse_source_id) {
            const reused = currentSource(j.target);
            if (!reused || reused.id !== j.reuse_source_id || reused.sha256 !== j.snapshot.sha256)
              throw new Error('SOURCE_UNAVAILABLE');
            value = reused;
          } else {
            value = personalMaterialSchema.parse({
              id: j.planned_source_id,
              owner_kind: 'personal',
              asset_version_id: j.capture_token,
              ...j.snapshot,
              page_count: pageCount,
              derivation_id: j.planned_derivation_id,
              status: pages.some((p) => p.origin === 'needs_ocr') ? 'needs_ocr' : 'ready',
              pages,
            });
            db.prepare(
              `INSERT INTO material_sources(id,workspace_id,owner_kind,task_id,asset_version_id,name,sha256,bytes,page_count,derivation_id)
          VALUES(?,?,'personal',NULL,?,?,?,?,?,?)`,
            ).run(
              value.id,
              workspace,
              value.asset_version_id,
              value.name,
              value.sha256,
              value.bytes,
              value.page_count,
              value.derivation_id,
            );
            db.prepare('INSERT INTO material_derivations VALUES(?,?,?,?,?)').run(
              value.derivation_id,
              value.id,
              configuration,
              value.status,
              JSON.stringify(value.pages),
            );
            db.prepare(
              'UPDATE folder_mappings SET entry_hint=?,revision=revision+1,current_source_id=? WHERE id=? AND workspace_id=? AND revision=?',
            ).run(j.target.entry_hint, value.id, m.id, workspace, m.revision);
          }
          const journal = save({
            ...j,
            phase: 'ready',
            interrupted: false,
            needs_reselect: false,
            result: {
              source_id: value.id,
              asset_version_id: value.asset_version_id,
              sha256: value.sha256,
            },
          });
          return { journal, source: value };
        })
        .immediate(),
    interrupt(id, code) {
      db.transaction(() => {
        const j = read(id);
        if (!j || j.phase === 'ready' || j.phase === 'cancelled') return;
        save({
          ...j,
          interrupted: true,
          needs_reselect: j.phase === 'reserved',
          failure_code: code,
        });
      }).immediate();
    },
    cancel(id) {
      return db
        .transaction(() => {
          const j = read(id);
          if (!j || j.phase === 'ready' || j.phase === 'cancelled') return j;
          return save({ ...j, phase: 'cancelled', interrupted: false });
        })
        .immediate();
    },
    saved(scope) {
      const project = scope.kind === 'project' ? config.project(scope.project_id) : undefined;
      if (scope.kind === 'project' && !project) return [];
      const prefix = project ? project.relative_directory + '/' : null;
      // 列表只投影固定身份和属性，SQL有界且不选择d.pages；正文仅在明确打开时读取。
      const rows = db
        .prepare(
          `SELECT f.id AS mapping_id,f.relative_name AS relative_label,${sourceFields}
        FROM folder_mappings f JOIN material_sources s ON s.id=f.current_source_id AND s.workspace_id=f.workspace_id
        JOIN material_derivations d ON d.id=s.derivation_id AND d.source_id=s.id
        WHERE f.workspace_id=? AND s.owner_kind='personal' AND s.task_id IS NULL
        AND (? IS NULL OR (f.binding_id=? AND substr(f.relative_name,1,length(?))=?))
        ORDER BY f.rowid DESC LIMIT 257`,
        )
        .all(
          workspace,
          project?.root_binding_id ?? null,
          project?.root_binding_id ?? null,
          prefix,
          prefix,
        ) as Array<
        Omit<PersonalMaterialHeader, 'kind'> & { mapping_id: string; relative_label: string }
      >;
      if (rows.length > 256) throw new Error('DIRECTORY_LIMIT');
      return rows.map(({ mapping_id, relative_label, ...header }) => ({
        mapping_id,
        relative_label,
        source: personalMaterialHeaderSchema.parse({ ...header, kind: materialKind(header.name) }),
      }));
    },
  };
}
