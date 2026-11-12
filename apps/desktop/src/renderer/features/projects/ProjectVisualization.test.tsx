// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { Matter, Task } from '../../../preload/caselite-api';
import ProjectVisualization from './ProjectVisualization';
import ProjectVisualizationInspector from './ProjectVisualizationInspector';
import {
  applyVisualizationLayout,
  captureVisualizationLayout,
  rememberVisualizationLayout,
  sampleVisualization,
  stepVisualizationLayout,
  type VisualizationNode,
  type VisualizationInspection,
} from './project-visualization-model';

vi.mock('@xyflow/react', async (importOriginal) => {
  const { applyNodeChanges } = await importOriginal<typeof import('@xyflow/react')>();
  return {
    applyNodeChanges,
    Background: () => null,
    Controls: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ControlButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    ReactFlow: ({
      nodes,
      nodeTypes,
      children,
      onNodeClick,
      onNodeDoubleClick,
      onNodeDragStart,
      onNodeDragStop,
      onNodesChange,
    }: {
      nodes: VisualizationNode[];
      nodeTypes: Record<
        string,
        ComponentType<{ data: VisualizationNode['data']; selected?: boolean }>
      >;
      children: ReactNode;
      onNodeClick(e: unknown, node: unknown): void;
      onNodeDoubleClick(e: unknown, node: unknown): void;
      onNodeDragStart(e: unknown, node: unknown): void;
      onNodeDragStop(e: unknown, node: unknown): void;
      onNodesChange(changes: unknown[]): void;
    }) => (
      <div data-testid="flow">
        {nodes.map((node) => {
          const Content = nodeTypes['visual-card'];
          return (
            <button
              key={node.id}
              aria-label={node.data.label}
              data-x={node.position.x}
              onClick={(e) => onNodeClick(e, node)}
              onDoubleClick={(e) => onNodeDoubleClick(e, node)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight')
                  onNodesChange([
                    {
                      type: 'position',
                      id: node.id,
                      position: { x: node.position.x + 5, y: node.position.y },
                    },
                  ]);
              }}
            >
              <Content data={node.data} selected={node.selected} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            const node = nodes[0];
            if (!node) return;
            const position = { x: node.position.x + 80, y: node.position.y + 40 };
            onNodeDragStart({}, node);
            onNodesChange([{ type: 'position', id: node.id, position, dragging: true }]);
            onNodeDragStop({}, { ...node, position });
          }}
        >
          模拟移动节点
        </button>
        <button
          type="button"
          onClick={() => {
            const node = nodes[0];
            if (node)
              onNodesChange([
                { type: 'select', id: node.id, selected: true },
                {
                  type: 'position',
                  id: node.id,
                  position: { x: node.position.x + 5, y: node.position.y },
                  dragging: true,
                },
              ]);
          }}
        >
          模拟键盘移动
        </button>
        {children}
      </div>
    ),
  };
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
const project: Matter = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '当前合成项目',
  status: 'planned',
  version: 1,
  archived_at: null,
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-12',
  task_count: 1,
};
const tasks = [
  { id: 'task-a', title: '当前任务', matter_id: project.id },
  { id: 'task-b', title: '其他项目任务', matter_id: 'other-project' },
] as Task[];
const documents = [
  { id: 'doc-a', title: '当前文档', task_id: 'task-a', matter_id: project.id },
  { id: 'doc-b', title: '越界文档', task_id: 'task-b', matter_id: 'other-project' },
];
function props() {
  return {
    project,
    tasks,
    documents,
    readError: false,
    onOpen: vi.fn(),
    onInspect: vi.fn(),
    sidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
  };
}

describe('项目可视化的数据边界与交互', () => {
  it('真实记录仅包含当前项目，选中查看属性，双击仍回原有记录', async () => {
    const p = props();
    render(<ProjectVisualization {...p} />);
    expect(screen.queryByText(/其他项目任务|越界文档|星桥设备公司/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '文档 · 当前文档' }));
    await waitFor(() =>
      expect(p.onInspect.mock.lastCall?.[0].selected.destination).toEqual({
        taskId: 'task-a',
        documentId: 'doc-a',
      }),
    );
    expect(p.onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByRole('button', { name: '文档 · 当前文档' }));
    expect(p.onOpen).toHaveBeenCalledWith('task-a', 'doc-a');
  });
  it('六个目录保留真实空态；只有显式打开才使用独立虚构示例', async () => {
    const p = props();
    render(<ProjectVisualization {...p} />);
    expect(
      within(screen.getByRole('tablist'))
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['关系', '证据', '时间轴', '庭审对抗', '大事记', '统计']);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: '暂无可展示的证据数据' })).toBeTruthy();
    expect(screen.queryByText('E01 买卖合同')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '查看虚构示例' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'E01 买卖合同' }));
    await waitFor(() =>
      expect(p.onInspect.mock.lastCall?.[0]).toMatchObject({
        sample: true,
        selected: { id: 'sample:E01', destination: undefined },
      }),
    );
    fireEvent.doubleClick(screen.getByRole('button', { name: 'E01 买卖合同' }));
    expect(p.onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回项目数据' }));
    expect(screen.queryByText('E01 买卖合同')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '关系' }));
    expect(screen.getByText('项目 · 当前合成项目')).toBeTruthy();
  });
  it('读失败不投影项目数据，收展辅助栏不重建当前画布', () => {
    const p = { ...props(), readError: true };
    const view = render(<ProjectVisualization {...p} />);
    expect(screen.getByRole('heading', { name: '暂时无法读取项目记录' })).toBeTruthy();
    expect(screen.queryByText('项目 · 当前合成项目')).toBeNull();
    const flow = screen.getByTestId('flow');
    fireEvent.click(screen.getByRole('button', { name: '收起可视化辅助栏' }));
    expect(p.onToggleSidebar).toHaveBeenCalledTimes(1);
    view.rerender(<ProjectVisualization {...p} sidebarCollapsed />);
    expect(screen.getByTestId('flow')).toBe(flow);
    expect(screen.getByRole('button', { name: '展开可视化辅助栏' })).toBeTruthy();
  });
  it('版面改动可撤销重做；重新排布先预览，取消不改变位置', () => {
    render(<ProjectVisualization {...props()} />);
    const root = () => screen.getByRole('button', { name: '项目 · 当前合成项目' });
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    expect(root().getAttribute('data-x')).toBe('80');
    fireEvent.click(screen.getByRole('button', { name: '重新排布' }));
    expect(screen.getByRole('dialog', { name: '重新排布预览' })).toBeTruthy();
    expect(root().getAttribute('data-x')).toBe('80');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(root().getAttribute('data-x')).toBe('80');
    fireEvent.click(screen.getByRole('button', { name: '重新排布' }));
    fireEvent.click(screen.getByRole('button', { name: '应用版面' }));
    expect(root().getAttribute('data-x')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    expect(root().getAttribute('data-x')).toBe('80');
    fireEvent.click(screen.getByRole('button', { name: '重做版面' }));
    expect(root().getAttribute('data-x')).toBe('0');
  });
  it('切换目录保留选择和位置，真实与示例的版面历史相互隔离', () => {
    const p = props();
    render(<ProjectVisualization {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '项目 · 当前合成项目' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    fireEvent.click(screen.getByRole('tab', { name: '统计' }));
    expect((screen.getByRole('button', { name: '撤销版面' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('tab', { name: '关系' }));
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' }).getAttribute('data-x')).toBe(
      '80',
    );
    expect(p.onInspect.mock.lastCall?.[0].selected.id).toBe(`project:${project.id}`);
    fireEvent.click(screen.getByRole('button', { name: '查看虚构示例' }));
    expect((screen.getByRole('button', { name: '撤销版面' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '返回项目数据' }));
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' }).getAttribute('data-x')).toBe(
      '80',
    );
  });
  it('切项目时不在新项目属性中显示上一项目对象', () => {
    const old = sampleVisualization('relations').nodes[0];
    render(
      <ProjectVisualizationInspector
        projectId="new-project"
        projectTitle="新项目"
        onOpen={vi.fn()}
        inspection={{
          projectId: project.id,
          mode: 'relations',
          sample: true,
          nodeCount: 5,
          edgeCount: 4,
          selected: { id: old.id, data: old.data },
        }}
      />,
    );
    expect(screen.queryByText('星桥设备公司')).toBeNull();
    expect(screen.getByText('新项目')).toBeTruthy();
  });
  it('键盘选择更新属性，键盘移动也可撤销', () => {
    const p = props();
    render(<ProjectVisualization {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '模拟键盘移动' }));
    expect(p.onInspect.mock.lastCall?.[0].selected.id).toBe(`project:${project.id}`);
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' }).getAttribute('data-x')).toBe(
      '5',
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' }).getAttribute('data-x')).toBe(
      '0',
    );
  });
  it('预览期间图示变化时拒绝应用旧版面，Escape取消后回焦', () => {
    const p = props();
    const view = render(<ProjectVisualization {...p} />);
    const trigger = screen.getByRole('button', { name: '重新排布' });
    fireEvent.click(trigger);
    view.rerender(<ProjectVisualization {...p} project={{ ...project, title: '更新后的项目' }} />);
    expect((screen.getByRole('button', { name: '应用版面' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('当前图示已变化，请取消后重新预览。')).toBeTruthy();
    fireEvent(
      screen.getByRole('dialog', { name: '重新排布预览' }),
      new Event('cancel', { cancelable: true }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('六种示例渲染对应内容，表格和统计不会冒充项目真实数据', () => {
    render(<ProjectVisualization {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '查看虚构示例' }));
    expect(screen.getByRole('button', { name: '设备买卖合同' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '证据' }));
    expect(screen.getByRole('button', { name: 'E03 银行回单' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '时间轴' }));
    expect(screen.getByText('非等比例示意')).toBeTruthy();
    expect(screen.getByText('2026-04-10')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '庭审对抗' }));
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['争点', '原告主张', '被告抗辩', '待核实']);
    fireEvent.click(screen.getByRole('tab', { name: '大事记' }));
    expect(within(screen.getByRole('table')).getByText('E03 · 第2页')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '统计' }));
    expect(screen.getByRole('img', { name: '已付60万元，占60%；未付40万元，占40%' })).toBeTruthy();
    expect(screen.getByText('虚构示例 · 不计入项目')).toBeTruthy();
  });
  it('撤销布局只恢复坐标，保留最新日期、金额和来源字段', () => {
    const original = sampleVisualization('timeline').nodes;
    const before = captureVisualizationLayout(original);
    const moved = original.map((node) => ({
      ...node,
      position: { x: node.position.x + 50, y: node.position.y },
    }));
    const after = captureVisualizationLayout(moved);
    const history = rememberVisualizationLayout({ past: [], future: [] }, before, after);
    const result = stepVisualizationLayout(history, after, 'undo')!;
    const fresh = moved.map((node) => ({
      ...node,
      data: {
        ...node.data,
        subtitle: '2026-12-01',
        properties: [['来源', '新修订']] as [string, string][],
      },
    }));
    const restored = applyVisualizationLayout(fresh, result.layout);
    expect(captureVisualizationLayout(restored)).toEqual(before);
    expect(restored[0].data.subtitle).toBe('2026-12-01');
    expect(restored[0].data.properties).toEqual([['来源', '新修订']]);
    const latest = restored.map((node) => ({
      ...node,
      position: { x: node.position.x + 1, y: node.position.y },
    }));
    expect(
      rememberVisualizationLayout(result.history, before, captureVisualizationLayout(latest))
        .future,
    ).toEqual([]);
  });
  it('已有版面缓存时新加入的项目任务仍可移动，并可撤销', () => {
    const p = props();
    const view = render(<ProjectVisualization {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    const added = { ...tasks[0], id: 'task-new', title: '新增归组任务' };
    view.rerender(<ProjectVisualization {...p} tasks={[...tasks, added]} />);
    const target = () => screen.getByRole('button', { name: '任务 · 新增归组任务' });
    const initialX = Number(target().getAttribute('data-x'));
    fireEvent.keyDown(target(), { key: 'ArrowRight' });
    expect(Number(target().getAttribute('data-x'))).toBe(initialX + 5);
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    expect(Number(target().getAttribute('data-x'))).toBe(initialX);
    expect(target()).toBeTruthy();
  });
  it('删除任务后选中对象清空，撤销版面不恢复已删除的任务或文档', () => {
    const p = props();
    const view = render(<ProjectVisualization {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '文档 · 当前文档' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    view.rerender(<ProjectVisualization {...p} tasks={[tasks[1]]} />);
    expect(p.onInspect.mock.lastCall?.[0].selected).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    expect(screen.queryByRole('button', { name: '任务 · 当前任务' })).toBeNull();
    expect(screen.queryByRole('button', { name: '文档 · 当前文档' })).toBeNull();
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' })).toBeTruthy();
  });
  it.each([
    { label: '初始归属图', empty: false, select: false },
    { label: '空项目', empty: true, select: false },
    { label: '选中文档', empty: false, select: true },
  ])('$label 的属性回报写入父状态时不形成循环，等价重读保持幂等', ({ empty, select }) => {
    const p = props();
    const reports = vi.fn();
    function Parent() {
      const [inspection, setInspection] = useState<VisualizationInspection | null>(null);
      const [refresh, setRefresh] = useState(0);
      const [title, setTitle] = useState(project.title);
      const report = useCallback((value: VisualizationInspection) => {
        reports(value);
        if (reports.mock.calls.length < 12) setInspection(value);
      }, []);
      return (
        <>
          <button onClick={() => setRefresh((value) => value + 1)}>父页面等价重读</button>
          <button onClick={() => setTitle('更新后的项目')}>更新所属项目标题</button>
          <output data-testid="parent-inspection">
            {refresh}:{inspection?.selected?.id ?? 'none'}
          </output>
          <ProjectVisualization
            {...p}
            project={{ ...project, title }}
            tasks={empty ? [] : tasks}
            documents={empty ? [] : documents.filter(() => true)}
            onInspect={report}
          />
        </>
      );
    }
    render(<Parent />);
    expect(reports).toHaveBeenCalledTimes(1);
    if (select) {
      fireEvent.click(screen.getByRole('button', { name: '文档 · 当前文档' }));
      expect(reports).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('parent-inspection').textContent).toBe('0:document:doc-a');
    }
    fireEvent.click(screen.getByRole('button', { name: '父页面等价重读' }));
    expect(reports).toHaveBeenCalledTimes(select ? 2 : 1);
    if (select) {
      fireEvent.click(screen.getByRole('button', { name: '更新所属项目标题' }));
      expect(reports).toHaveBeenCalledTimes(3);
      expect(reports.mock.lastCall?.[0].selected.data.properties).toContainEqual([
        '所属项目',
        '更新后的项目',
      ]);
    }
  });
});
