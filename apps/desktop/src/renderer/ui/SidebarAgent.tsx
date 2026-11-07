import AgentPanel, { UnavailableAgentPanel } from './AgentPanel';

export default function SidebarAgent({
  taskId,
  blocked = false,
  unavailable = '当前没有可用的关联任务。',
}: {
  taskId?: string;
  blocked?: boolean;
  unavailable?: string;
}) {
  return (
    <div className="sidebar-agent" inert={blocked}>
      {taskId ? (
        <AgentPanel key={taskId} scope={taskId} variant="compact" />
      ) : (
        <UnavailableAgentPanel reason={unavailable} />
      )}
    </div>
  );
}
