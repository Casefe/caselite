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
}: {
  taskId?: string;
  taskVersion?: number;
  project?: { id: string; version: number; archived: boolean };
  document?: { id: string; revision: number; archived: boolean };
  contact?: { id: string; version: number };
  renderRun?(run: AgentRun, selectForEdit?: () => void): ReactNode;
  blocked?: boolean;
  unavailable?: string;
}) {
  return (
    <div className="sidebar-agent" inert={blocked}>
      {contact ? (
        <AgentPanel
          key={`contact:${contact.id}`}
          scope={`contact:${contact.id}`}
          variant="compact"
          page={{ version: String(contact.version), archived: false }}
          renderRun={renderRun}
        />
      ) : project ? (
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
