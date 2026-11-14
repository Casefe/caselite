import { describe, expect, it } from 'vitest';
import { documentInspectorStartsCollapsed } from './document-workspace-inspector';

describe('文档工作区侧栏首次展示', () => {
  it.each([
    ['documents:doc-1', true],
    ['documents:list', false],
    ['documents', false],
    ['projects:project-1:documents', true],
    ['projects:project-1:overview', false],
    ['tasks:task-1:document:成果正文', true],
    ['calendar:task-1:document:成果正文', true],
    ['tasks:task-1:内容', false],
    ['knowledge:doc-1', false],
    ['contacts', false],
  ] as const)('%s 的默认收起为 %s', (pageKey, expected) => {
    expect(documentInspectorStartsCollapsed(pageKey)).toBe(expected);
  });
});
