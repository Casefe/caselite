import { describe, expect, it } from 'vitest';
import { projectRelationships } from './ProjectRelationshipGraph';

describe('项目关系图', () => {
  it('只显示当前项目归属与可打开的文档，并使用有类型的稳定节点标识', () => {
    const graph = projectRelationships(
      { id: 'p', title: '项目' },
      [
        { id: 'same', title: '任务', matter_id: 'p' },
        { id: 'external', title: '其他项目任务', matter_id: 'other' },
      ],
      [
        { id: 'same', title: '文档', task_id: 'same', matter_id: 'p' },
        { id: 'bad', title: '其他项目文档', task_id: 'same', matter_id: 'other' },
        { id: 'orphan', title: '未归属文档', task_id: 'external', matter_id: 'p' },
      ],
    );
    expect(graph.nodes.map((node) => node.id)).toEqual(['project:p', 'task:same', 'document:same']);
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      ['project:p', 'task:same'],
      ['task:same', 'document:same'],
    ]);
    expect(graph.destinations.get('document:same')).toEqual({
      taskId: 'same',
      documentId: 'same',
    });
  });
});
