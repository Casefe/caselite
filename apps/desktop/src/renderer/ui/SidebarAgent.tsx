import AgentPanel from './AgentPanel';

export default function SidebarAgent({
  taskId,
  blocked = false,
}: {
  taskId: string;
  blocked?: boolean;
}) {
  return (
    <div className="sidebar-agent" inert={blocked}>
      <AgentPanel key={taskId} scope={taskId} variant="compact" />
    </div>
  );
}
