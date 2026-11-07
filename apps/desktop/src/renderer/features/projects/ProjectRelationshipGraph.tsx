import { useMemo } from 'react';
import { Background, Controls, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { Matter, Task } from '../../../preload/caselite-api';

type GraphDocument = { id: string; title: string; task_id: string; matter_id: string | null };
type Destination = { taskId: string; documentId?: string };

export function projectRelationships(
  project: Pick<Matter, 'id' | 'title'>,
  tasks: Pick<Task, 'id' | 'title' | 'matter_id'>[],
  documents: GraphDocument[],
) {
  const root = `project:${project.id}`;
  const nodes: Node[] = [
    {
      id: root,
      position: { x: 0, y: 0 },
      data: { label: project.title },
      type: 'input',
      sourcePosition: Position.Right,
    },
  ];
  const edges: Edge[] = [];
  const destinations = new Map<string, Destination>();
  let row = 0;
  // 只投影现有归属，拒绝跨项目或失去所属任务的文档。
  for (const task of tasks.filter((item) => item.matter_id === project.id)) {
    const id = `task:${task.id}`;
    const linked = documents.filter(
      (item) => item.matter_id === project.id && item.task_id === task.id,
    );
    nodes.push({
      id,
      position: { x: 235, y: row * 76 },
      data: { label: task.title },
      className: 'project-graph-task',
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });
    edges.push({ id: `${root}:${id}`, source: root, target: id });
    destinations.set(id, { taskId: task.id });
    linked.forEach((document, index) => {
      const target = `document:${document.id}`;
      nodes.push({
        id: target,
        type: 'output',
        targetPosition: Position.Left,
        position: { x: 470, y: (row + index) * 76 },
        data: { label: document.title },
        className: 'project-graph-document',
      });
      edges.push({ id: `${id}:${target}`, source: id, target });
      destinations.set(target, { taskId: task.id, documentId: document.id });
    });
    row += Math.max(1, linked.length);
  }
  return { nodes, edges, destinations };
}

export default function ProjectRelationshipGraph({
  project,
  tasks,
  documents,
  onOpen,
}: {
  project: Matter;
  tasks: Task[];
  documents: GraphDocument[];
  onOpen(taskId: string, documentId?: string): void;
}) {
  const { nodes, edges, destinations } = useMemo(
    () => projectRelationships(project, tasks, documents),
    [project, tasks, documents],
  );
  return (
    <>
      <p className="caption">
        仅显示当前项目已归组的任务和已关联的可编辑文档。选择节点可打开原记录。
      </p>
      {nodes.length === 1 && <p>项目暂无关联任务或文档。</p>}
      <div className="project-relationship-graph">
        <ReactFlow
          aria-label="项目关系图"
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          fitView
          onNodeClick={(_, node) => {
            const destination = destinations.get(node.id);
            if (destination) onOpen(destination.taskId, destination.documentId);
          }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {destinations.size > 0 && (
        <details className="project-graph-links">
          <summary>以列表打开任务或文档</summary>
          <ul className="project-document-list">
            {nodes
              .filter((node) => destinations.has(node.id))
              .map((node) => {
                const destination = destinations.get(node.id)!;
                return (
                  <li key={node.id}>
                    <button
                      data-project-task={destination.taskId}
                      data-project-document={destination.documentId}
                      onClick={() => onOpen(destination.taskId, destination.documentId)}
                    >
                      {destination.documentId ? '文档' : '任务'} · {String(node.data.label)}
                    </button>
                  </li>
                );
              })}
          </ul>
        </details>
      )}
    </>
  );
}
