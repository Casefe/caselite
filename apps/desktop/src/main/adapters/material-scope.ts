import type { MaterialScope } from '@caselite/contracts';
import type { createCatalogApplication, createTaskApplication } from '@caselite/application';

export function createMaterialScopeWritable(ports: {
  task(scope: MaterialScope): string | undefined;
  tasks: ReturnType<typeof createTaskApplication>;
  catalog: ReturnType<typeof createCatalogApplication>;
}) {
  return (scope: MaterialScope): boolean => {
    const id = ports.task(scope);
    if (!id) return scope === 'home';
    const result = ports.tasks.execute({ protocol_version: 1, operation: 'read', task_id: id });
    if (!result.ok || !result.tasks[0] || result.tasks[0].document_archived_at) return false;
    const projectId = result.tasks[0].matter_id;
    if (!projectId) return true;
    const state = ports.catalog.execute({ protocol_version: 1, operation: 'list' });
    return (
      state.ok && state.projects.some((project) => project.id === projectId && !project.archived_at)
    );
  };
}
