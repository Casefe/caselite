import {
  projectGraphRequestSchema,
  projectGraphSchema,
  type ProjectGraph,
  type ProjectGraphRequest,
} from '@caselite/contracts';

export interface ProjectGraphPort {
  read(request: ProjectGraphRequest): ProjectGraph | null;
}
export function createProjectGraphApplication(port: ProjectGraphPort) {
  return {
    read(
      input: unknown,
    ):
      | { ok: true; graph: ProjectGraph }
      | { ok: false; code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'UNAVAILABLE'; message: string } {
      const request = projectGraphRequestSchema.safeParse(input);
      if (!request.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '关系查询范围或数量无效。' };
      try {
        const result = port.read(request.data);
        if (!result)
          return { ok: false, code: 'NOT_FOUND', message: '项目不存在或不属于当前工作区。' };
        const graph = projectGraphSchema.parse(result);
        // 存储返回值也必须绑定原查询；错误范围或迟到配置不能冒充本次读取。
        if (
          graph.project_id !== request.data.project_id ||
          graph.depth !== request.data.depth ||
          graph.node_limit !== request.data.node_limit
        )
          throw new Error('Unexpected project graph scope');
        return { ok: true, graph };
      } catch {
        return { ok: false, code: 'UNAVAILABLE', message: '关系暂时无法读取，请重试。' };
      }
    },
  };
}
