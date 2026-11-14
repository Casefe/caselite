import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { folderResponseSchema, folderScopeSchema, type FolderResponse } from '@caselite/contracts';
import type {
  FolderConfigurationStorePort,
  FolderDefault,
  FolderProject,
  PrivateRootLocator,
} from './folder-store-records';

type LocatorRow = PrivateRootLocator & {
  binding_id: string;
  revision: number;
  display_name: string;
};
type ReceiptRow = { digest: string; frozen_scope: string; result: string };
const equalLocator = (a: PrivateRootLocator, b: PrivateRootLocator) =>
  a.locator_version === b.locator_version &&
  a.private_path === b.private_path &&
  a.root_identity === b.root_identity &&
  a.ancestor_chain === b.ancestor_chain &&
  a.profile_identity === b.profile_identity;

export function createFolderConfigurationStore(
  db: Database.Database,
  workspace: string,
): FolderConfigurationStorePort {
  // 仅复用当前连接的 SQL 编译结果；每次仍读取最新配置，不缓存根授权或修订。
  let currentDefaultStatement: Database.Statement | undefined;
  const currentDefault = (): FolderDefault | undefined => {
    const row = (currentDefaultStatement ??= db.prepare(
      `SELECT d.binding_id,d.revision,b.name AS display_name,l.locator_version,
       l.private_path,l.root_identity,l.ancestor_chain,l.profile_identity
       FROM folder_workspace_defaults d
       JOIN folder_bindings b ON b.id=d.binding_id AND b.workspace_id=d.workspace_id
       JOIN folder_root_locators l ON l.workspace_id=d.workspace_id AND l.binding_id=d.binding_id
       AND l.revision=d.revision WHERE d.workspace_id=?`,
    )).get(workspace) as LocatorRow | undefined;
    if (!row) return;
    const { binding_id, revision, display_name, ...locator } = row;
    return { binding_id, revision, display_name, locator };
  };
  const ensureProject = (id: string) => {
    if (
      !db
        .prepare('SELECT id FROM matters WHERE id=? AND workspace_id=? AND archived_at IS NULL')
        .get(id, workspace)
    )
      throw new Error('PROJECT_UNAVAILABLE');
  };
  const project = (projectId: string): FolderProject | undefined => {
    ensureProject(projectId);
    return db
      .prepare(
        `SELECT root_binding_id,relative_directory,directory_identity,revision
       FROM folder_project_bindings WHERE workspace_id=? AND project_id=?`,
      )
      .get(workspace, projectId) as FolderProject | undefined;
  };
  const queryConfiguration: FolderConfigurationStorePort['queryConfiguration'] = (input) => {
    const row = db
      .prepare(
        `SELECT digest,frozen_scope,result FROM folder_scope_receipts
       WHERE workspace_id=? AND request_kind='configuration' AND operation=? AND request_key=?`,
      )
      .get(workspace, input.operation, input.request_id) as ReceiptRow | undefined;
    if (!row) return;
    const frozen = folderScopeSchema.parse(JSON.parse(row.frozen_scope));
    if (
      frozen.kind !== input.scope.kind ||
      (frozen.kind === 'project' &&
        (input.scope.kind !== 'project' || frozen.project_id !== input.scope.project_id))
    )
      throw new Error('FORBIDDEN');
    if (frozen.kind === 'project') ensureProject(frozen.project_id);
    if (input.request_digest && row.digest !== input.request_digest)
      throw new Error('DIGEST_CONFLICT');
    return folderResponseSchema.parse(JSON.parse(row.result));
  };
  const receipt = (
    operation: 'set_default' | 'bind_project',
    id: string,
    digest: string,
    scope: { kind: 'workspace' } | { kind: 'project'; project_id: string },
    result: FolderResponse,
  ) => {
    const checked = folderResponseSchema.parse(result);
    db.prepare(
      `INSERT INTO folder_scope_receipts
       (workspace_id,request_kind,request_key,digest,operation,frozen_scope,result)
       VALUES(?,'configuration',?,?,?,?,?)`,
    ).run(workspace, id, digest, operation, JSON.stringify(scope), JSON.stringify(checked));
    return checked;
  };
  const setDefault: FolderConfigurationStorePort['setDefault'] = (input) =>
    db
      .transaction(() => {
        const old = queryConfiguration({
          operation: 'set_default',
          scope: { kind: 'workspace' },
          request_id: input.request_id,
          request_digest: input.request_digest,
        });
        if (old) return old;
        const previous = currentDefault();
        if ((previous?.revision ?? 0) !== input.expected_revision)
          throw new Error('REVISION_CONFLICT');
        // 重选只恢复原目录访问，不把同名新对象登记为旧根，也不改变未决捕获的目标修订。
        if (input.reselect) {
          if (!previous || !equalLocator(previous.locator, input.locator))
            throw new Error('ROOT_MISMATCH');
          return receipt(
            'set_default',
            input.request_id,
            input.request_digest,
            { kind: 'workspace' },
            {
              ok: true,
              state: 'configured',
              receipt: input.request_id,
              configuration: {
                binding_id: previous.binding_id,
                revision: previous.revision,
                display_name: previous.display_name,
              },
            },
          );
        }
        const binding = randomUUID(),
          revision = input.expected_revision + 1;
        db.prepare('INSERT INTO folder_bindings VALUES(?,?,?,?,?)').run(
          binding,
          workspace,
          input.display_name,
          1,
          input.locator.root_identity,
        );
        const l = input.locator;
        db.prepare('INSERT INTO folder_root_locators VALUES(?,?,?,?,?,?,?,?)').run(
          workspace,
          binding,
          l.locator_version,
          revision,
          l.private_path,
          l.root_identity,
          l.ancestor_chain,
          l.profile_identity,
        );
        db.prepare(
          `INSERT INTO folder_workspace_defaults VALUES(?,?,?)
       ON CONFLICT(workspace_id) DO UPDATE SET binding_id=excluded.binding_id,revision=excluded.revision`,
        ).run(workspace, binding, revision);
        return receipt(
          'set_default',
          input.request_id,
          input.request_digest,
          { kind: 'workspace' },
          {
            ok: true,
            state: 'configured',
            receipt: input.request_id,
            configuration: { binding_id: binding, revision, display_name: input.display_name },
          },
        );
      })
      .immediate();
  const bindProject: FolderConfigurationStorePort['bindProject'] = (input) =>
    db
      .transaction(() => {
        const scope = { kind: 'project' as const, project_id: input.project_id };
        const old = queryConfiguration({
          operation: 'bind_project',
          scope,
          request_id: input.request_id,
          request_digest: input.request_digest,
        });
        if (old) return old;
        const previous = project(input.project_id);
        if ((previous?.revision ?? 0) !== input.expected_revision)
          throw new Error('REVISION_CONFLICT');
        if (currentDefault()?.binding_id !== input.root_binding_id)
          throw new Error('CONFIGURATION_CHANGED');
        const revision = input.expected_revision + 1;
        db.prepare(
          `INSERT INTO folder_project_bindings VALUES(?,?,?,?,?,?)
       ON CONFLICT(workspace_id,project_id) DO UPDATE SET
       root_binding_id=excluded.root_binding_id,relative_directory=excluded.relative_directory,
       directory_identity=excluded.directory_identity,revision=excluded.revision`,
        ).run(
          workspace,
          input.project_id,
          input.root_binding_id,
          input.relative_directory,
          input.directory_identity,
          revision,
        );
        return receipt('bind_project', input.request_id, input.request_digest, scope, {
          ok: true,
          state: 'configured',
          receipt: input.request_id,
          project_revision: revision,
        });
      })
      .immediate();
  const recordConfigurationResult: FolderConfigurationStorePort['recordConfigurationResult'] = (
    input,
  ) =>
    db
      .transaction(() => {
        const previous = queryConfiguration(input);
        if (previous) return previous;
        if (input.scope.kind === 'project') ensureProject(input.scope.project_id);
        return receipt(
          input.operation,
          input.request_id,
          input.request_digest,
          input.scope,
          input.result,
        );
      })
      .immediate();
  return {
    workspace,
    currentDefault,
    project,
    queryConfiguration,
    recordConfigurationResult,
    setDefault,
    bindProject,
  };
}
