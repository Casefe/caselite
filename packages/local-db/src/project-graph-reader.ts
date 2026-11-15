import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  projectGraphSchema,
  projectProfessionalFieldsSchema,
  type ProjectGraph,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type ProjectGraphRequest,
} from '@caselite/contracts';

// 复用原业务连接与工作区，只读取归属和版本，不读取正文、材料或另建图存储。
export function createProjectGraphReader(db: Database.Database, workspace: string) {
  const read = db.transaction((request: ProjectGraphRequest): ProjectGraph | null => {
    const project = db
      .prepare(
        'SELECT id,title,version,status,project_type,professional_type,professional_fields,archived_at FROM matters WHERE id=? AND workspace_id=?',
      )
      .get(request.project_id, workspace) as
      | {
          id: string;
          title: string;
          version: number;
          status: 'planned' | 'active' | 'done';
          project_type: 'general' | 'litigation' | 'contract_review';
          professional_type:
            | 'civil_litigation'
            | 'criminal_litigation'
            | 'commercial_arbitration'
            | 'non_litigation'
            | null;
          professional_fields: string;
          archived_at: string | null;
        }
      | undefined;
    if (!project) return null;
    const { archived_at, professional_fields, ...projectFields } = project;
    const fields = projectProfessionalFieldsSchema.parse(JSON.parse(professional_fields));
    const nodes: ProjectGraphNode[] = [
      {
        ...projectFields,
        kind: 'project',
        professional_fields: Object.entries(fields).flatMap(([section, values]) =>
          Object.entries(values)
            .filter(([, value]) => value !== undefined)
            .map(([field, value]) => ({ section, field, value })),
        ) as Extract<ProjectGraphNode, { kind: 'project' }>['professional_fields'],
      },
    ];
    const edges: ProjectGraphEdge[] = [];
    const tasks = db
      .prepare(
        `SELECT t.id,t.title,t.version FROM task_projects p
         JOIN task_items t ON t.id=p.task_id AND t.workspace_id=?
         JOIN matters m ON m.id=p.matter_id AND m.workspace_id=t.workspace_id
         WHERE p.matter_id=? ORDER BY t.id LIMIT ?`,
      )
      .all(workspace, project.id, request.node_limit) as {
      id: string;
      title: string;
      version: number;
    }[];
    const selected = tasks.slice(0, request.node_limit - 1);
    for (const task of selected) {
      nodes.push({ ...task, kind: 'task' });
      edges.push({
        kind: 'project_task',
        from: { kind: 'project', id: project.id },
        to: { kind: 'task', id: task.id },
      });
    }
    let truncated = tasks.length > selected.length;
    if (request.depth === 2 && !truncated && selected.length) {
      const remaining = request.node_limit - nodes.length;
      const documents = db
        .prepare(
          `SELECT d.id,t.title,d.metadata_version,d.body_revision,t.version AS task_version,t.id AS task_id
           FROM documents d JOIN task_items t ON t.id=d.task_id AND t.workspace_id=?
           JOIN task_projects p ON p.task_id=t.id
           JOIN matters m ON m.id=p.matter_id AND m.workspace_id=t.workspace_id
           WHERE p.matter_id=? AND d.archived_at IS NULL AND t.id IN (${selected.map(() => '?').join(',')})
           ORDER BY t.id,d.id LIMIT ?`,
        )
        .all(workspace, project.id, ...selected.map((task) => task.id), remaining + 1) as {
        id: string;
        title: string;
        metadata_version: number;
        task_version: number;
        body_revision: number;
        task_id: string;
      }[];
      truncated = documents.length > remaining;
      for (const document of documents.slice(0, remaining)) {
        nodes.push({ ...document, kind: 'document' });
        edges.push({
          kind: 'task_document',
          from: { kind: 'task', id: document.task_id },
          to: { kind: 'document', id: document.id },
        });
      }
    }
    const projection = {
      project_id: project.id,
      depth: request.depth,
      node_limit: request.node_limit,
      nodes,
      edges,
      truncated,
      read_only: archived_at !== null,
    };
    return projectGraphSchema.parse({
      ...projection,
      fingerprint: createHash('sha256')
        .update(JSON.stringify([workspace, projection]))
        .digest('hex'),
    });
  });
  return { read };
}
