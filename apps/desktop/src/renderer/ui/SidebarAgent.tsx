import AgentPanel, { UnavailableAgentPanel } from './AgentPanel';

export default function SidebarAgent({
  taskId,
  project,
  blocked = false,
  unavailable = '当前没有可用的关联任务。',
}: {
  taskId?: string;
  project?: { id: string; version: number; archived: boolean };
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
        />
      ) : taskId ? (
        <AgentPanel key={taskId} scope={taskId} variant="compact" />
      ) : (
        <UnavailableAgentPanel reason={unavailable} />
      )}
    </div>
  );
}
