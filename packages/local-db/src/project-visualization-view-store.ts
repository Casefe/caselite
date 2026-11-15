import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  defaultProjectVisualizationConfig,
  projectVisualizationConfigSchema,
  projectVisualizationReceiptSchema,
  projectVisualizationViewSchema,
  type ProjectVisualizationRequest,
  type ProjectVisualizationConfig,
  type ProjectVisualizationView,
  type CatalogResponse,
  type ProjectGraph,
} from '@caselite/contracts';
import type { createProjectGraphReader } from './project-graph-reader';
const fail = (
  code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_REQUEST',
  message: string,
): CatalogResponse => ({ ok: false, code, message });
const key = (node: { kind: string; id: string }) => `${node.kind}:${node.id}`;
const references = (config: ProjectVisualizationConfig) => [
  ...config.hidden_nodes,
  ...config.positions.map((p) => p.node),
  ...config.custom_labels.map((p) => p.node),
  ...(config.selected ? [config.selected] : []),
];
export function createProjectVisualizationViewStore(
  db: Database.Database,
  workspace: string,
  reader: ReturnType<typeof createProjectGraphReader>,
) {
  const graphFor = (project_id: string) =>
    reader.read({
      protocol_version: 1,
      operation: 'read_project_graph',
      project_id,
      depth: 2,
      node_limit: 200,
    });
  const readView = (graph: ProjectGraph): ProjectVisualizationView => {
    const row = db
      .prepare(
        'SELECT revision,configuration,source_fingerprint FROM project_visualization_views WHERE workspace_id=? AND project_id=? AND view_id=?',
      )
      .get(workspace, graph.project_id, 'current') as
      { revision: number; configuration: string; source_fingerprint: string } | undefined;
    const original = projectVisualizationConfigSchema.parse(
      row ? JSON.parse(row.configuration) : defaultProjectVisualizationConfig,
    );
    const allowed = new Set(graph.nodes.map(key));
    const exists = (node: { kind: string; id: string }) => allowed.has(key(node));
    const config = {
      ...original,
      hidden_nodes: original.hidden_nodes.filter(exists),
      positions: original.positions.filter((p) => exists(p.node)),
      custom_labels: original.custom_labels.filter((p) => exists(p.node)),
      selected: original.selected && exists(original.selected) ? original.selected : null,
    };
    return projectVisualizationViewSchema.parse({
      project_id: graph.project_id,
      view_id: 'current',
      format_version: 1,
      revision: row?.revision ?? 0,
      config,
      saved_source_fingerprint: row?.source_fingerprint ?? null,
      current_source_fingerprint: graph.fingerprint,
      read_only: graph.read_only,
      scope_pruned: references(original).some((node) => !exists(node)),
    });
  };
  const execute = db.transaction((request: ProjectVisualizationRequest): CatalogResponse => {
    // 范围每次按宿主工作区重新读取；旧回执不能授权跨项目访问。
    const graph = graphFor(request.project_id);
    if (!graph) return fail('NOT_FOUND', '项目不属于当前工作区。');
    const response = (receipt?: unknown): CatalogResponse => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: request.project_id,
      project_graph: graph,
      receipt: receipt ? ('idempotency_key' in request ? request.idempotency_key : null) : null,
      project_visualization_view: readView(graph),
      ...(receipt
        ? { visualization_receipt: projectVisualizationReceiptSchema.parse(receipt) }
        : {}),
    });
    if (request.operation === 'read_project_visualization_view') return response();
    if (request.operation === 'save_project_visualization_view' && graph.read_only)
      return fail('CONFLICT', '项目已归档，视图只读。');
    const prior = db
      .prepare('SELECT digest,result FROM catalog_receipts WHERE workspace_id=? AND key=?')
      .get(workspace, request.idempotency_key) as { digest: string; result: string } | undefined;
    const scopeReceipt = () => {
      if (!prior) return null;
      const parsed = projectVisualizationReceiptSchema.safeParse(
        JSON.parse(prior.result).visualization_receipt,
      );
      return parsed.success &&
        parsed.data.project_id === request.project_id &&
        parsed.data.view_id === request.view_id &&
        parsed.data.idempotency_key === request.idempotency_key
        ? parsed.data
        : null;
    };
    if (request.operation === 'project_visualization_view_status') {
      const receipt = scopeReceipt();
      return receipt ? response(receipt) : fail('NOT_FOUND', '此项目视图尚未查到原提交。');
    }
    const { request_id: diagnostic, ...content } = request;
    void diagnostic;
    const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    if (prior) {
      const receipt = scopeReceipt();
      return receipt && prior.digest === digest
        ? response(receipt)
        : fail('CONFLICT', '同一提交身份已用于其他内容或范围。');
    }
    const current = readView(graph);
    if (
      current.revision !== request.expected_view_revision ||
      graph.fingerprint !== request.expected_source_fingerprint
    )
      return fail('CONFLICT', '来源或视图已经更新，请保留输入并重新核对。');
    const allowed = new Set(graph.nodes.map(key));
    if (references(request.config).some((node) => !allowed.has(key(node))))
      return fail('INVALID_REQUEST', '视图包含当前范围以外的对象。');
    const next = current.revision + 1;
    if (!Number.isSafeInteger(next)) return fail('CONFLICT', '视图修订超出范围。');
    if (current.revision === 0) {
      db.prepare(
        'INSERT INTO project_visualization_views(workspace_id,project_id,view_id,format_version,revision,configuration,source_fingerprint) VALUES(?,?,?,1,?,?,?)',
      ).run(
        workspace,
        request.project_id,
        request.view_id,
        next,
        JSON.stringify(request.config),
        graph.fingerprint,
      );
    } else {
      const updated = db
        .prepare(
          'UPDATE project_visualization_views SET revision=?,configuration=?,source_fingerprint=? WHERE workspace_id=? AND project_id=? AND view_id=? AND revision=?',
        )
        .run(
          next,
          JSON.stringify(request.config),
          graph.fingerprint,
          workspace,
          request.project_id,
          request.view_id,
          current.revision,
        );
      if (updated.changes !== 1) throw new Error('View CAS failed');
    }
    const receipt = projectVisualizationReceiptSchema.parse({
      operation: request.operation,
      project_id: request.project_id,
      view_id: request.view_id,
      idempotency_key: request.idempotency_key,
      committed_revision: next,
    });
    // 回执只存原提交身份与修订；标签留在唯一配置Owner，避免历史回执绕过当前权限。
    db.prepare('INSERT INTO catalog_receipts(workspace_id,key,digest,result) VALUES(?,?,?,?)').run(
      workspace,
      request.idempotency_key,
      digest,
      JSON.stringify({ visualization_receipt: receipt }),
    );
    return response(receipt);
  });
  return {
    execute(request: ProjectVisualizationRequest) {
      return request.operation === 'save_project_visualization_view'
        ? execute.immediate(request)
        : execute(request);
    },
  };
}
