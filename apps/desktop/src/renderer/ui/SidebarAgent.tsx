import AgentPanel, { UnavailableAgentPanel } from './AgentPanel';

export default function SidebarAgent({
  taskId,
  taskVersion,
  project,
  document,
  blocked = false,
  unavailable = '当前没有可用的关联任务。',
}: {
  taskId?: string;
  taskVersion?: number;
  project?: { id: string; version: number; archived: boolean };
  document?: { id: string; revision: number; archived: boolean };
  blocked?: boolean;
  unavailable?: string;
}) {
  return (
    <div className="sidebar-agent" inert={blocked}>
      {project ? (
        <AgentPanel
          key={`project:${project.id}`}
          scope={`project:${project.id}`}
          variant="compact"
          project={project}
          page={{ version: String(project.version), archived: project.archived }}
        />
      ) : document ? (
        <AgentPanel
          key={`document:${document.id}`}
          scope={`document:${document.id}`}
          variant="compact"
          page={{ version: String(document.revision), archived: document.archived }}
        />
      ) : taskId ? (
        <AgentPanel
          key={taskId}
          scope={taskId}
          variant="compact"
          page={{ version: String(taskVersion ?? taskId), archived: false }}
        />
      ) : (
        <UnavailableAgentPanel reason={unavailable} />
      )}
    </div>
  );
}
