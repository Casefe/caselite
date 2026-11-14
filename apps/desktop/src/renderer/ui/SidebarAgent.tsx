import { agentSurface, type AgentSurfaceOptions } from '../features/agent/agent-surfaces';
import AgentPanel, { UnavailableAgentPanel } from './AgentPanel';
import type { ReactNode } from 'react';
import type { AgentRun } from '../../preload/caselite-api';

export default function SidebarAgent({
  taskId,
  taskVersion,
  project,
  document,
  contact,
  renderRun,
  blocked = false,
  unavailable = '当前没有可用的关联任务。',
}: AgentSurfaceOptions & {
  renderRun?(run: AgentRun, selectForEdit?: () => void): ReactNode;
  blocked?: boolean;
  unavailable?: string;
}) {
  const surface = agentSurface({ taskId, taskVersion, project, document, contact });
  return (
    <div className="sidebar-agent" inert={blocked}>
      {surface ? (
        <AgentPanel
          key={surface.scope}
          scope={surface.scope}
          variant="compact"
          page={surface.page}
          project={surface.kind === 'project' ? surface.project : undefined}
          renderRun={surface.kind === 'contact' ? renderRun : undefined}
        />
      ) : (
        <UnavailableAgentPanel reason={unavailable} />
      )}
    </div>
  );
}
