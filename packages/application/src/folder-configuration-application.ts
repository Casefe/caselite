import {
  folderRequestSchema,
  type FolderRequest,
  type FolderResponse,
  type FolderScope,
} from '@caselite/contracts';
import type {
  FolderCaller,
  FolderConfigurationStorePort,
  FolderDefault,
  FolderGuard,
  FolderProject,
  FolderRootsPort,
} from './folder-ports';
import { folderFailure } from './folder-errors';

export function createFolderConfigurationApplication(input: {
  hash(text: string): string;
  store: FolderConfigurationStorePort;
  roots: FolderRootsPort;
}) {
  const { store, roots } = input;
  const callerValid = (caller: FolderCaller) => {
    if (caller.workspace !== store.workspace || !roots.isCurrent(caller))
      throw new Error('STALE_CALLER');
  };
  function scopeView(
    caller: FolderCaller,
    scope: FolderScope,
  ): {
    defaultRoot: FolderDefault | undefined;
    project: FolderProject | undefined;
    guard: FolderGuard;
  } {
    callerValid(caller);
    const defaultRoot = store.currentDefault();
    const project = scope.kind === 'project' ? store.project(scope.project_id) : undefined;
    const frozen = JSON.stringify({
      root: defaultRoot ? { id: defaultRoot.binding_id, revision: defaultRoot.revision } : null,
      project,
    });
    const guard = () => {
      callerValid(caller);
      const latest = store.currentDefault();
      const nextProject = scope.kind === 'project' ? store.project(scope.project_id) : undefined;
      if (
        JSON.stringify({
          root: latest ? { id: latest.binding_id, revision: latest.revision } : null,
          project: nextProject,
        }) !== frozen
      )
        throw new Error('CONFIGURATION_CHANGED');
    };
    guard();
    return { defaultRoot, project, guard };
  }
  const publicConfiguration = (root: FolderDefault) => ({
    binding_id: root.binding_id,
    display_name: root.display_name,
    revision: root.revision,
  });
  const digest = (request: FolderRequest) => {
    const { protocol_version, ...payload } = request;
    void protocol_version;
    return input.hash(JSON.stringify(payload));
  };
  async function execute(
    caller: FolderCaller,
    value: unknown,
  ): Promise<FolderResponse | undefined> {
    const parsed = folderRequestSchema.safeParse(value);
    if (!parsed.success) return folderFailure(new Error('INVALID_REQUEST'));
    const request = parsed.data;
    try {
      callerValid(caller);
      if (request.operation === 'configuration') {
        const view = scopeView(caller, request.scope);
        return {
          ok: true,
          state: view.defaultRoot ? 'configured' : 'not_configured',
          configuration: view.defaultRoot ? publicConfiguration(view.defaultRoot) : undefined,
          project_revision: view.project?.revision ?? 0,
          project_directory_name: view.project?.relative_directory,
        };
      }
      if (request.operation === 'choose_default' || request.operation === 'reselect_default') {
        const hash = digest(request),
          scope = { kind: 'workspace' as const };
        const previous = store.queryConfiguration({
          operation: 'set_default',
          scope,
          request_id: request.request_id,
          request_digest: hash,
        });
        if (previous) return previous;
        const view = scopeView(caller, scope);
        if ((view.defaultRoot?.revision ?? 0) !== request.expected_revision)
          throw new Error('REVISION_CONFLICT');
        const locator = await roots.select(caller, view.guard);
        view.guard();
        if (!locator)
          return store.recordConfigurationResult({
            operation: 'set_default',
            scope,
            request_id: request.request_id,
            request_digest: hash,
            result: { ok: true, state: 'cancelled', receipt: request.request_id },
          });
        await roots.validate(caller, locator, view.guard);
        view.guard();
        const result = store.setDefault({
          request_id: request.request_id,
          request_digest: hash,
          expected_revision: request.expected_revision,
          display_name: locator.private_path.split('/').filter(Boolean).at(-1) ?? '/',
          locator,
          reselect: request.operation === 'reselect_default',
        });
        roots.revokeRoots();
        callerValid(caller);
        return result;
      }
      if (request.operation === 'bind_project') {
        const scope = { kind: 'project' as const, project_id: request.project_id };
        const hash = digest(request);
        const previous = store.queryConfiguration({
          operation: 'bind_project',
          scope,
          request_id: request.request_id,
          request_digest: hash,
        });
        if (previous) return previous;
        const view = scopeView(caller, scope);
        if (!view.defaultRoot) throw new Error('ROOT_EXPIRED');
        if ((view.project?.revision ?? 0) !== request.expected_revision)
          throw new Error('REVISION_CONFLICT');
        const selection = await roots.selectProject(caller, view.defaultRoot.locator, view.guard);
        view.guard();
        if (!selection)
          return store.recordConfigurationResult({
            operation: 'bind_project',
            scope,
            request_id: request.request_id,
            request_digest: hash,
            result: { ok: true, state: 'cancelled', receipt: request.request_id },
          });
        const result = store.bindProject({
          request_id: request.request_id,
          request_digest: hash,
          expected_revision: request.expected_revision,
          project_id: request.project_id,
          root_binding_id: view.defaultRoot.binding_id,
          ...selection,
        });
        roots.revokeRoots();
        callerValid(caller);
        return result;
      }
      if (request.operation === 'query_configuration') {
        return (
          store.queryConfiguration({
            operation: request.configuration_operation,
            scope: request.scope,
            request_id: request.request_id,
          }) ?? folderFailure(new Error('NOT_FOUND'))
        );
      }
      if (request.operation === 'restore_default') {
        const view = scopeView(caller, request.scope);
        const unavailable: FolderResponse = {
          ok: true,
          state: view.defaultRoot ? 'needs_reselect' : 'not_configured',
          configuration: view.defaultRoot ? publicConfiguration(view.defaultRoot) : undefined,
          project_revision: view.project?.revision ?? 0,
          view_generation: request.view_generation,
        };
        if (
          !view.defaultRoot ||
          (request.scope.kind === 'project' &&
            (!view.project || view.project.root_binding_id !== view.defaultRoot.binding_id))
        )
          return unavailable;
        try {
          const root = await roots.issue(
            caller,
            view.defaultRoot.locator,
            request.scope,
            view.project,
            view.guard,
          );
          view.guard();
          return {
            ok: true,
            state: 'ready',
            root,
            configuration: publicConfiguration(view.defaultRoot),
            project_revision: view.project?.revision ?? 0,
            view_generation: request.view_generation,
          };
        } catch {
          try {
            view.guard();
          } catch (error) {
            roots.revokeRoots();
            throw error;
          }
          return unavailable;
        }
      }
      return undefined;
    } catch (error) {
      const result = folderFailure(error);
      if (
        request.operation === 'choose_default' ||
        request.operation === 'reselect_default' ||
        request.operation === 'bind_project'
      ) {
        try {
          callerValid(caller);
          return store.recordConfigurationResult({
            operation: request.operation === 'bind_project' ? 'bind_project' : 'set_default',
            scope:
              request.operation === 'bind_project'
                ? { kind: 'project', project_id: request.project_id }
                : { kind: 'workspace' },
            request_id: request.request_id,
            request_digest: digest(request),
            result,
          });
        } catch {
          /* 撤权或回执冲突时不覆盖原记录。 */
        }
      }
      return result;
    }
  }
  return { execute, scopeView, callerValid, workspace: store.workspace };
}
