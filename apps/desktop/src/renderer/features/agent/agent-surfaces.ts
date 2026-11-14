export type AgentSurfaceOptions = {
  taskId?: string;
  taskVersion?: number;
  project?: { id: string; version: number; archived: boolean };
  document?: { id: string; revision: number; archived: boolean };
  contact?: { id: string; version: number };
};

export function agentSurface({
  contact,
  project,
  document,
  taskId,
  taskVersion,
}: AgentSurfaceOptions) {
  if (contact)
    return {
      kind: 'contact' as const,
      scope: `contact:${contact.id}`,
      page: { version: String(contact.version), archived: false },
    };
  if (project)
    return {
      kind: 'project' as const,
      scope: `project:${project.id}`,
      project,
      page: { version: String(project.version), archived: project.archived },
    };
  if (document)
    return {
      kind: 'document' as const,
      scope: `document:${document.id}`,
      page: { version: String(document.revision), archived: document.archived },
    };
  if (taskId)
    return {
      kind: 'task' as const,
      scope: taskId,
      page: { version: String(taskVersion ?? taskId), archived: false },
    };
  return undefined;
}
