import type { CatalogRequest, CatalogResponse } from '../../../preload/caselite-api';
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { Matter, Task } from '../../../preload/caselite-api';
import ProjectVisualization from './ProjectVisualization';
import {
  defaultProjectVisualizationConfig,
  type ProjectGraph,
} from './project-visualization-view-model';
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
      onMoveEnd,
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
      onMoveEnd(event: unknown, viewport: { x: number; y: number; zoom: number }): void;
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
        <button type="button" onClick={() => onMoveEnd(null, { x: 77, y: 35, zoom: 1.5 })}>
          模拟平移视口
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
  { id: '11111111-1111-4111-8111-111111111112', title: '当前任务', matter_id: project.id },
  { id: '22222222-2222-4222-8222-222222222223', title: '其他项目任务', matter_id: 'other-project' },
] as Task[];
const documents = [
  {
    id: '11111111-1111-4111-8111-111111111113',
    title: '当前文档',
    task_id: '11111111-1111-4111-8111-111111111112',
    matter_id: project.id,
  },
  {
    id: '22222222-2222-4222-8222-222222222224',
    title: '越界文档',
    task_id: '22222222-2222-4222-8222-222222222223',
    matter_id: 'other-project',
  },
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

let source: ProjectGraph;
let saved = structuredClone(defaultProjectVisualizationConfig);
let revision = 0;
function response(receipt?: string): CatalogResponse {
  return {
    ok: true,
    projects: [],
    documents: [],
    state: null,
    target_id: project.id,
    receipt: receipt ?? null,
    project_graph: source,
    project_visualization_view: {
      project_id: project.id,
      view_id: 'current',
      format_version: 1,
      revision,
      config: saved,
      saved_source_fingerprint: revision ? source.fingerprint : null,
      current_source_fingerprint: source.fingerprint,
      read_only: source.read_only,
      scope_pruned: false,
    },
    ...(receipt
      ? {
          visualization_receipt: {
            operation: 'save_project_visualization_view',
            project_id: project.id,
            view_id: 'current',
            idempotency_key: receipt,
            committed_revision: revision,
          },
        }
      : {}),
  };
}
beforeEach(() => {
  source = {
    project_id: project.id,
    depth: 2,
    node_limit: 200,
    fingerprint: 'a'.repeat(64),
    read_only: false,
    truncated: false,
    nodes: [
      {
        kind: 'project',
        id: project.id,
        title: project.title,
        version: 1,
        status: 'planned',
        project_type: 'general',
        professional_type: null,
        professional_fields: [],
      },
      { kind: 'task', id: tasks[0].id, title: '当前任务', version: 1 },
      {
        kind: 'document',
        id: documents[0].id,
        title: '当前任务',
        task_id: tasks[0].id,
        task_version: 1,
        metadata_version: 1,
        body_revision: 0,
      },
    ],
    edges: [
      {
        kind: 'project_task',
        from: { kind: 'project', id: project.id },
        to: { kind: 'task', id: tasks[0].id },
      },
      {
        kind: 'task_document',
        from: { kind: 'task', id: tasks[0].id },
        to: { kind: 'document', id: documents[0].id },
      },
    ],
  };
  saved = structuredClone(defaultProjectVisualizationConfig);
  revision = 0;
  window.caselite = {
    catalog: vi.fn(async (request: CatalogRequest) => {
      if (request.operation === 'save_project_visualization_view') {
        saved = request.config;
        revision++;
        return response(request.idempotency_key);
      }
      return response();
    }),
  } as unknown as Window['caselite'];
});
async function mount(p = props()) {
  const result = render(<ProjectVisualization {...p} />);
  await screen.findByRole('button', { name: '项目 · 当前合成项目' });
  return result;
}
function bump() {
  source = {
    ...source,
    fingerprint: (source.fingerprint === 'a'.repeat(64) ? 'b' : 'c').repeat(64),
  };
}
describe('项目可视化的数据边界与交互', () => {
  it('真实记录仅包含当前项目，选中查看属性，双击仍回原有记录', async () => {
    const p = props();
    await mount(p);
    expect(screen.queryByText(/其他项目任务|越界文档|星桥设备公司/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '文档 · 当前任务' }));
    await waitFor(() =>
      expect(p.onInspect.mock.lastCall?.[0].selected.destination).toEqual({
        taskId: tasks[0].id,
        documentId: documents[0].id,
      }),
    );
    expect(p.onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByRole('button', { name: '文档 · 当前任务' }));
    expect(p.onOpen).toHaveBeenCalledWith(tasks[0].id, documents[0].id);
  });
  it('六个目录保留真实空态；只有显式打开才使用独立虚构示例', async () => {
    const p = props();
    await mount(p);
    expect(
      within(screen.getByRole('tablist'))
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['关系', '证据', '时间轴', '庭审对抗', '大事记', '统计']);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: '暂无可展示的证据数据' })).toBeTruthy();
    expect(screen.queryByText('E01 买卖合同')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '查看虚构示例' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'E01 买卖合同' }));
    expect(p.onInspect.mock.lastCall?.[0]).toMatchObject({
      sample: true,
      selected: { id: 'sample:E01', destination: undefined },
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'E01 买卖合同' }));
    expect(p.onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回项目数据' }));
    expect(screen.queryByText('E01 买卖合同')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '关系' }));
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '统计' }));
    expect(screen.getByRole('table', { name: '当前范围记录统计' })).toBeTruthy();
    expect(screen.queryByText('合同金额')).toBeNull();
  });
  it('读失败不投影项目数据，收展辅助栏不重建当前画布', async () => {
    window.caselite.catalog = vi.fn(async () => ({
      ok: false,
      code: 'UNAVAILABLE',
      message: '合成读取失败',
    }));
    const p = props();
    const result = render(<ProjectVisualization {...p} />);
    await screen.findByRole('heading', { name: '暂时无法读取项目记录' });
    expect(screen.queryByText('项目 · 当前合成项目')).toBeNull();
    const flow = screen.getByTestId('flow');
    fireEvent.click(screen.getByRole('button', { name: '收起可视化辅助栏' }));
    expect(p.onToggleSidebar).toHaveBeenCalledTimes(1);
    result.rerender(<ProjectVisualization {...p} sidebarCollapsed />);
    expect(screen.getByTestId('flow')).toBe(flow);
    expect(screen.getByRole('button', { name: '展开可视化辅助栏' })).toBeTruthy();
  });
  it('版面改动可撤销重做；重新排布先预览，取消不改变位置', async () => {
    await mount();
    const root = () => screen.getByRole('button', { name: '项目 · 当前合成项目' });
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    expect(root().getAttribute('data-x')).toBe('80');
    const flow = screen.getByTestId('flow');
    fireEvent.click(screen.getByRole('button', { name: '重新排布' }));
    expect(screen.getByRole('region', { name: '重新排布预览' })).toBeTruthy();
    expect(root().getAttribute('data-x')).toBe('0');
    expect(screen.getByTestId('flow')).toBe(flow);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(root().getAttribute('data-x')).toBe('80');
    fireEvent.click(screen.getByRole('button', { name: '重新排布' }));
    fireEvent.click(screen.getByRole('button', { name: '应用版面' }));
    await waitFor(() => expect(revision).toBe(1));
    expect(root().getAttribute('data-x')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    await waitFor(() => expect(root().getAttribute('data-x')).toBe('80'));
    fireEvent.click(screen.getByRole('button', { name: '重做版面' }));
    await waitFor(() => expect(root().getAttribute('data-x')).toBe('0'));
  });
  it('切换目录保留选择和位置，真实与示例的版面历史相互隔离', async () => {
    const p = props();
    await mount(p);
    fireEvent.click(screen.getByRole('button', { name: '项目 · 当前合成项目' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    fireEvent.click(screen.getByRole('tab', { name: '统计' }));
    expect(screen.getByRole('table', { name: '当前范围记录统计' })).toBeTruthy();
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
  it('键盘选择更新属性，键盘移动也可撤销', async () => {
    const p = props();
    await mount(p);
    fireEvent.click(screen.getByRole('button', { name: '模拟键盘移动' }));
    expect(p.onInspect.mock.lastCall?.[0].selected.id).toBe(`project:${project.id}`);
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' }).getAttribute('data-x')).toBe(
      '5',
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '项目 · 当前合成项目' }).getAttribute('data-x'),
      ).toBe('0'),
    );
  });
  it('预览期间图示变化时拒绝应用旧版面，Escape取消后回焦', async () => {
    const p = props();
    const result = await mount(p);
    const trigger = screen.getByRole('button', { name: '重新排布' });
    fireEvent.click(trigger);
    source.nodes[0] = { ...source.nodes[0], title: '更新后的项目' };
    bump();
    result.rerender(<ProjectVisualization {...p} project={{ ...project, version: 2 }} />);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '应用版面' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(screen.getByText('来源或视图已变化，请取消后重新预览。')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('region', { name: '重新排布预览' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '重新排布预览' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('六种示例渲染对应内容，表格和统计不会冒充项目真实数据', async () => {
    await mount();
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
        .map((c) => c.textContent),
    ).toEqual(['争点', '原告主张', '被告抗辩', '待核实']);
    fireEvent.click(screen.getByRole('tab', { name: '大事记' }));
    expect(within(screen.getByRole('table')).getByText('E03 · 第2页')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '统计' }));
    expect(screen.getByRole('img', { name: '已付60万元，占60%；未付40万元，占40%' })).toBeTruthy();
    expect(screen.getByText('虚构示例 · 不计入项目')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存视图' })).toBeNull();
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

  it('已有版面缓存时新加入的项目任务仍可移动，并可撤销', async () => {
    const p = props();
    const result = await mount(p);
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    const added = {
      ...tasks[0],
      id: '33333333-3333-4333-8333-333333333333',
      title: '新增归组任务',
    };
    source.nodes.push({ kind: 'task', id: added.id, title: added.title, version: 1 });
    source.edges.push({
      kind: 'project_task',
      from: { kind: 'project', id: project.id },
      to: { kind: 'task', id: added.id },
    });
    bump();
    result.rerender(<ProjectVisualization {...p} tasks={[...tasks, added]} />);
    const target = () => screen.getByRole('button', { name: '任务 · 新增归组任务' });
    await screen.findByRole('button', { name: '任务 · 新增归组任务' });
    const x = Number(target().getAttribute('data-x'));
    fireEvent.keyDown(target(), { key: 'ArrowRight' });
    expect(Number(target().getAttribute('data-x'))).toBe(x + 5);
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    await waitFor(() => expect(Number(target().getAttribute('data-x'))).toBe(x));
    expect(target()).toBeTruthy();
  });
  it('删除任务后选中对象清空，撤销版面不恢复已删除的任务或文档', async () => {
    const p = props();
    const result = await mount(p);
    fireEvent.click(screen.getByRole('button', { name: '文档 · 当前任务' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    source.nodes = source.nodes.filter((n) => n.kind === 'project');
    source.edges = [];
    bump();
    result.rerender(<ProjectVisualization {...p} tasks={[tasks[1]]} />);
    await waitFor(() => expect(p.onInspect.mock.lastCall?.[0].selected).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: '撤销版面' }));
    expect(screen.queryByRole('button', { name: '任务 · 当前任务' })).toBeNull();
    expect(screen.queryByRole('button', { name: '文档 · 当前任务' })).toBeNull();
    expect(screen.getByRole('button', { name: '项目 · 当前合成项目' })).toBeTruthy();
  });
  it.each([
    { label: '初始归属图', empty: false, select: false },
    { label: '空项目', empty: true, select: false },
    { label: '选中文档', empty: false, select: true },
  ])('$label 的属性回报写入父状态时不形成循环，等价重读保持幂等', async ({ empty, select }) => {
    const p = props();
    if (empty) {
      source.nodes = source.nodes.slice(0, 1);
      source.edges = [];
    }
    const reports = vi.fn();
    function Parent() {
      const [inspection, setInspection] = useState<VisualizationInspection | null>(null);
      const [refresh, setRefresh] = useState(0);
      const [version, setVersion] = useState(1);
      const report = useCallback((v: VisualizationInspection) => {
        reports(v);
        if (reports.mock.calls.length < 12) setInspection(v);
      }, []);
      return (
        <>
          <button onClick={() => setRefresh((v) => v + 1)}>父页面等价重读</button>
          <button onClick={() => setVersion(2)}>更新所属项目标题</button>
          <output data-testid="parent-inspection">
            {refresh}:{inspection?.selected?.id ?? 'none'}
          </output>
          <ProjectVisualization
            {...p}
            project={{ ...project, version }}
            tasks={empty ? [] : tasks}
            documents={empty ? [] : documents.filter(() => true)}
            onInspect={report}
          />
        </>
      );
    }
    render(<Parent />);
    await screen.findByRole('button', { name: '项目 · 当前合成项目' });
    // 按钮可以先于属性回报出现；先把已排队的回报刷完，再判断父页面重读会不会再报。
    await act(async () => {
      await Promise.resolve();
    });
    const initial = reports.mock.calls.length;
    expect(initial).toBeLessThan(5);
    if (select) {
      fireEvent.click(screen.getByRole('button', { name: '文档 · 当前任务' }));
      expect(screen.getByTestId('parent-inspection').textContent).toBe(
        `0:document:${documents[0].id}`,
      );
      await act(async () => {
        await Promise.resolve();
      });
    }
    const selectedCount = reports.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '父页面等价重读' }));
    expect(reports).toHaveBeenCalledTimes(selectedCount);
    if (select) {
      source.nodes[0] = { ...source.nodes[0], title: '更新后的项目' };
      bump();
      fireEvent.click(screen.getByRole('button', { name: '更新所属项目标题' }));
      await waitFor(() =>
        expect(reports.mock.lastCall?.[0].selected.data.properties).toContainEqual([
          '所属项目',
          '更新后的项目',
        ]),
      );
      expect(reports.mock.calls.length).toBeLessThan(initial + 4);
    }
  });
  it('同画布表示预览、过滤、统计、最大化和源字段均消费真实窄投影', async () => {
    const p = props();
    source.truncated = true;
    const result = await mount(p);
    fireEvent.change(screen.getByLabelText('表示方式'), { target: { value: 'grouped' } });
    expect(screen.getByRole('region', { name: '重新排布预览' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect((screen.getByLabelText('表示方式') as HTMLSelectElement).value).toBe('network');
    const flow = screen.getByTestId('flow');
    fireEvent.click(screen.getByRole('button', { name: '最大化可视化' }));
    expect(screen.getByTestId('flow')).toBe(flow);
    fireEvent.click(screen.getByRole('button', { name: '还原可视化' }));
    expect(screen.getByTestId('flow')).toBe(flow);
    fireEvent.click(screen.getByRole('button', { name: '文档 · 当前任务' }));
    const inspection = p.onInspect.mock.lastCall?.[0];
    expect(inspection.selected.data.fieldSources).toContainEqual([
      '标题',
      'Task.title · Task 修订 1',
    ]);
    result.rerender(
      <ProjectVisualizationInspector
        projectId={project.id}
        projectTitle={project.title}
        inspection={inspection}
        onOpen={p.onOpen}
      />,
    );
    expect(screen.getByText('字段来源与修订')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '显示标签' })).toBeTruthy();
  });
});

it.each(['重新读取', '并发读取', '重新载入已保存视图'] as const)(
  '%s接受其他节点的新标签后，保持选中对象的Inspector编辑不得回退已接受标签',
  async (entry) => {
    const p = props();
    const a = { kind: 'task' as const, id: tasks[0].id };
    const b = { kind: 'document' as const, id: documents[0].id };
    saved = {
      ...saved,
      selected: a,
      custom_labels: [
        { node: a, text: 'a1' },
        { node: b, text: 'b1' },
      ],
    };
    revision = 1;
    const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
      if (request.operation === 'save_project_visualization_view') {
        saved = request.config;
        revision++;
        return response(request.idempotency_key);
      }
      return response();
    });
    window.caselite.catalog = catalog;
    const reports = vi.fn();
    function Parent() {
      const [inspection, setInspection] = useState<VisualizationInspection | null>(null);
      const [refresh, setRefresh] = useState(0);
      const report = useCallback((next: VisualizationInspection) => {
        reports(next);
        setInspection(next);
      }, []);
      return (
        <>
          <button onClick={() => setRefresh((value) => value + 1)}>父页面等价重绘</button>
          <output>{refresh}</output>
          <ProjectVisualization {...p} onInspect={report} />
          <ProjectVisualizationInspector
            projectId={project.id}
            projectTitle={project.title}
            inspection={inspection}
            onOpen={p.onOpen}
          />
        </>
      );
    }
    const mounted = render(<Parent />);
    fireEvent.click(await screen.findByRole('button', { name: '任务 · a1' }));
    const label = screen.getByRole('textbox', { name: '显示标签' }) as HTMLInputElement;
    expect(label.value).toBe('a1');
    if (entry === '重新载入已保存视图')
      fireEvent.click(screen.getByRole('button', { name: '模拟移动节点' }));
    saved = {
      ...saved,
      custom_labels: [
        { node: a, text: 'a1' },
        { node: b, text: 'b2' },
      ],
    };
    revision = 2;
    if (entry === '并发读取') {
      const olderReply = response();
      let older!: (value: CatalogResponse) => void;
      let newer!: (value: CatalogResponse) => void;
      catalog.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve;
          }),
      );
      catalog.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            newer = resolve;
          }),
      );
      fireEvent.click(screen.getByRole('button', { name: '重新读取', exact: true }));
      fireEvent.click(screen.getByRole('button', { name: '重新读取', exact: true }));
      saved = {
        ...saved,
        custom_labels: [
          { node: a, text: 'a1' },
          { node: b, text: 'b3' },
        ],
      };
      revision = 3;
      await act(async () => {
        newer(response());
      });
      await act(async () => {
        older(olderReply);
      });
    } else {
      fireEvent.click(screen.getByRole('button', { name: '重新读取', exact: true }));
      if (entry === '重新载入已保存视图')
        fireEvent.click(await screen.findByRole('button', { name: entry, exact: true }));
    }
    const acceptedB = entry === '并发读取' ? 'b3' : 'b2';
    await screen.findByRole('button', { name: `文档 · ${acceptedB}` });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('textbox', { name: '显示标签' })).toBe(label);
    expect(label.value).toBe('a1');
    const reportCount = reports.mock.calls.length;
    expect(reportCount).toBeLessThan(10);
    fireEvent.click(screen.getByRole('button', { name: '父页面等价重绘' }));
    expect(reports).toHaveBeenCalledTimes(reportCount);
    fireEvent.change(label, { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存视图', exact: true }));
    await screen.findByText('已保存');
    const requests = catalog.mock.calls
      .map(([request]) => request)
      .filter((request) => request.operation === 'save_project_visualization_view');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      expected_view_revision: entry === '并发读取' ? 3 : 2,
      expected_source_fingerprint: source.fingerprint,
    });
    expect(requests[0].config.custom_labels.find((label) => label.node.id === b.id)?.text).toBe(
      acceptedB,
    );
    expect(requests[0].config.custom_labels).toContainEqual({ node: a, text: 'a2' });
    expect(saved.custom_labels).toHaveLength(2);
    mounted.unmount();
    render(<Parent />);
    await screen.findByRole('button', { name: `文档 · ${acceptedB}` });
    expect(
      ((await screen.findByRole('textbox', { name: '显示标签' })) as HTMLInputElement).value,
    ).toBe('a2');
  },
);

it('未知回执冻结显示编辑并按原身份核对，中文输入与原名称保持且选择浏览不脏', async () => {
  const p = props();
  const dirty = vi.fn();
  let pendingKey = '';
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'save_project_visualization_view') {
      saved = request.config;
      revision = 1;
      pendingKey = request.idempotency_key;
      throw new Error('synthetic lost acknowledgement');
    }
    if (request.operation === 'project_visualization_view_status') {
      expect(request).toMatchObject({
        project_id: project.id,
        view_id: 'current',
        idempotency_key: pendingKey,
      });
      return response(pendingKey);
    }
    return response();
  });
  window.caselite.catalog = catalog;
  function Parent() {
    const [inspection, setInspection] = useState<VisualizationInspection | null>(null);
    return (
      <>
        <ProjectVisualization {...p} onInspect={setInspection} onDirty={dirty} />
        <ProjectVisualizationInspector
          projectId={project.id}
          projectTitle={project.title}
          inspection={inspection}
          onOpen={p.onOpen}
        />
      </>
    );
  }
  render(<Parent />);
  fireEvent.click(await screen.findByRole('button', { name: '文档 · 当前任务' }));
  await waitFor(() => expect(dirty.mock.lastCall?.[0]).toBe(false));
  const label = screen.getByRole('textbox', { name: '显示标签' }) as HTMLInputElement;
  fireEvent.compositionStart(label);
  fireEvent.change(label, { target: { value: '中文手工标签' } });
  fireEvent.keyDown(label, { key: 'Escape', isComposing: true });
  fireEvent.compositionEnd(label);
  expect(label.value).toBe('中文手工标签');
  expect(screen.getByRole('heading', { name: '当前任务' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保存视图' }));
  await screen.findByRole('button', { name: '核对保存结果' });
  expect(label.disabled).toBe(true);
  expect(dirty.mock.lastCall?.[0]).toBe(true);
  fireEvent.doubleClick(screen.getByRole('button', { name: '文档 · 中文手工标签' }));
  expect(p.onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核对保存结果' }));
  await waitFor(() => expect(label.disabled).toBe(false));
  expect(dirty.mock.lastCall?.[0]).toBe(false);
  expect(
    catalog.mock.calls.filter(
      ([request]) => request.operation === 'save_project_visualization_view',
    ),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '恢复跟随来源' }));
  expect(label.value).toBe('');
  expect(screen.getByRole('button', { name: '文档 · 当前任务' })).toBeTruthy();
});

it('统计只呈现唯一对象计数表，关系表示控件保留给归属图；异项目临时会话不自动打开样例', async () => {
  await mount({
    ...props(),
    initialSession: {
      projectId: '99999999-9999-4999-8999-999999999999',
      config: defaultProjectVisualizationConfig,
      mode: 'statistics',
      sample: true,
    },
  });
  expect(screen.queryByText('虚构示例 · 不计入项目')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '统计' }));
  expect(screen.getByText('唯一对象计数表')).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: '表示方式' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '标签显示' })).toBeNull();
  expect((screen.getByRole('button', { name: '重新排布' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole('table', { name: '当前范围记录统计' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '关系' }));
  expect(screen.getByRole('combobox', { name: '表示方式' })).toBeTruthy();
});

it('已保存视图仅平移后明确保存失败，状态区分本次失败与上次回执', async () => {
  revision = 1;
  const p = props();
  const dirty = vi.fn();
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> =>
    request.operation === 'save_project_visualization_view'
      ? { ok: false, code: 'INVALID_REQUEST', message: '合成本次视口保存失败' }
      : response(),
  );
  window.caselite.catalog = catalog;
  render(<ProjectVisualization {...p} onDirty={dirty} />);
  await screen.findByText('已保存');
  fireEvent.click(screen.getByRole('button', { name: '模拟平移视口' }));
  expect(dirty.mock.lastCall?.[0]).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存视图' }));
  await screen.findByText('合成本次视口保存失败');
  expect(screen.getByText('本次保存失败')).toBeTruthy();
  expect(screen.queryByText('已保存')).toBeNull();
  expect(
    catalog.mock.calls.find(
      ([request]) => request.operation === 'save_project_visualization_view',
    )?.[0],
  ).toMatchObject({ config: { viewport: { x: 77, y: 35, zoom: 1.5 } } });
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '保存视图' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  await waitFor(() => expect(dirty.mock.lastCall?.[0]).toBe(false));
});

it('仅平移的未决提交失去scope后仍保护离页、保留原键核对，明确放弃不冒称取消保存', async () => {
  revision = 1;
  const p = props();
  const dirty = vi.fn();
  let lost = false;
  let original: CatalogRequest | undefined;
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'save_project_visualization_view') {
      original = request;
      lost = true;
      throw new Error('合成未知回执');
    }
    if (lost) return { ok: false, code: 'NOT_FOUND', message: '合成失scope' };
    return response();
  });
  window.caselite.catalog = catalog;
  render(<ProjectVisualization {...p} onDirty={dirty} />);
  await screen.findByText('已保存');
  fireEvent.click(screen.getByRole('button', { name: '模拟平移视口' }));
  expect(dirty.mock.lastCall?.[0]).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存视图' }));
  fireEvent.click(await screen.findByRole('button', { name: '核对保存结果' }));
  await screen.findByText(/项目范围已不可用/);
  expect(dirty.mock.lastCall?.[0]).toBe(true);
  expect(screen.getByText('保存结果仍未确认')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重新载入已保存视图' })).toBeNull();
  for (const button of screen.getAllByRole('button', { name: '查看虚构示例' }))
    expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('项目 · 当前合成项目')).toBeNull();
  expect((screen.getByRole('button', { name: '重试原提交' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '继续核对原提交' }));
  await screen.findByText(/项目范围已不可用/);
  expect(dirty.mock.lastCall?.[0]).toBe(true);
  const statuses = catalog.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === 'project_visualization_view_status');
  expect(statuses).toHaveLength(2);
  expect(statuses.map((request) => request.idempotency_key)).toEqual([
    original?.idempotency_key,
    original?.idempotency_key,
  ]);
  expect(
    catalog.mock.calls.filter(
      ([request]) => request.operation === 'save_project_visualization_view',
    ),
  ).toHaveLength(1);
  expect(screen.getByText(/不会取消可能已保存的结果/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '放弃本次输入与核对' }));
  await waitFor(() => expect(dirty.mock.lastCall?.[0]).toBe(false));
  expect(screen.getByText('已放弃本次输入 · 结果未确认')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '继续核对原提交' })).toBeNull();
  expect(screen.queryByText('已保存')).toBeNull();
  expect(
    catalog.mock.calls.filter(
      ([request]) => request.operation === 'save_project_visualization_view',
    ),
  ).toHaveLength(1);
});

it('首次读取迟到不能覆盖已接受的键盘目录选择，源字段刷新仍保留目录', async () => {
  let release!: (value: CatalogResponse) => void;
  const initialRead = new Promise<CatalogResponse>((resolve) => {
    release = resolve;
  });
  let refreshed = false;
  const catalog = vi.fn(async () => (refreshed ? response() : initialRead));
  window.caselite.catalog = catalog;
  const p = props();
  const mounted = render(<ProjectVisualization {...p} />);
  const evidence = screen.getByRole('tab', { name: '证据', exact: true });
  expect((evidence as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(evidence.getAttribute('aria-selected')).toBe('true');
  await act(async () => {
    release(response());
    await initialRead;
  });
  expect(evidence.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('heading', { name: '暂无可展示的证据数据' })).toBeTruthy();
  expect(screen.queryByText('E01 买卖合同')).toBeNull();
  expect(p.onOpen).not.toHaveBeenCalled();
  source = {
    ...source,
    fingerprint: 'b'.repeat(64),
    nodes: source.nodes.map((node) =>
      node.kind === 'project' ? { ...node, title: '来源已保存的新项目名', version: 2 } : node,
    ),
  };
  refreshed = true;
  mounted.rerender(<ProjectVisualization {...p} project={{ ...project, version: 2 }} />);
  await waitFor(() =>
    expect(p.onInspect.mock.lastCall?.[0].projectTitle).toBe('来源已保存的新项目名'),
  );
  expect(evidence.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('heading', { name: '暂无可展示的证据数据' })).toBeTruthy();
  expect(catalog.mock.calls.length).toBeGreaterThan(1);
});

it('读取前选定统计在范围就绪后仍保留，显式保存使用该显示方式', async () => {
  let release!: (value: CatalogResponse) => void;
  const initialRead = new Promise<CatalogResponse>((resolve) => {
    release = resolve;
  });
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> => {
    if (request.operation === 'read_project_visualization_view') return initialRead;
    if (request.operation === 'save_project_visualization_view') {
      saved = request.config;
      revision++;
      return response(request.idempotency_key);
    }
    return response();
  });
  window.caselite.catalog = catalog;
  render(<ProjectVisualization {...props()} />);
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
  const statistics = screen.getByRole('tab', { name: '统计', exact: true });
  expect(statistics.getAttribute('aria-selected')).toBe('true');
  await act(async () => {
    release(response());
    await initialRead;
  });
  expect(statistics.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('table', { name: '当前范围记录统计' })).toBeTruthy();
  expect(
    catalog.mock.calls.some(([request]) => request.operation === 'save_project_visualization_view'),
  ).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '保存视图', exact: true }));
  await waitFor(() =>
    expect(
      catalog.mock.calls.find(
        ([request]) => request.operation === 'save_project_visualization_view',
      )?.[0],
    ).toMatchObject({ config: { mode: 'statistics' } }),
  );
});

it('无人操作时恢复当前项目已保存的表示，切项目不沿用旧目录意图', async () => {
  saved = { ...saved, mode: 'statistics' };
  let first!: (value: CatalogResponse) => void;
  let second!: (value: CatalogResponse) => void;
  const a = new Promise<CatalogResponse>((resolve) => {
    first = resolve;
  });
  const b = new Promise<CatalogResponse>((resolve) => {
    second = resolve;
  });
  const secondId = '22222222-2222-4222-8222-222222222222';
  window.caselite.catalog = vi.fn((request: CatalogRequest) =>
    'project_id' in request && request.project_id === secondId ? b : a,
  );
  const p = props();
  const mounted = render(<ProjectVisualization {...p} />);
  await act(async () => {
    first(response());
    await a;
  });
  expect(screen.getByRole('tab', { name: '统计', exact: true }).getAttribute('aria-selected')).toBe(
    'true',
  );
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: '证据', exact: true }).getAttribute('aria-selected')).toBe(
    'true',
  );
  const next = { ...project, id: secondId, title: '第二项目' };
  const previous = response();
  if (!previous.ok) throw new Error('Unexpected fixture');
  const secondReply: CatalogResponse = {
    ...previous,
    target_id: secondId,
    project_graph: {
      ...source,
      project_id: secondId,
      nodes: [
        {
          kind: 'project',
          id: secondId,
          title: next.title,
          version: 1,
          status: 'planned',
          project_type: 'general',
          professional_type: null,
          professional_fields: [],
        },
      ],
      edges: [],
    },
    project_visualization_view: { ...previous.project_visualization_view!, project_id: secondId },
  };
  mounted.rerender(<ProjectVisualization {...p} project={next} tasks={[]} documents={[]} />);
  await act(async () => {
    second(secondReply);
    await b;
  });
  expect(screen.getByRole('tab', { name: '统计', exact: true }).getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(p.onInspect.mock.lastCall?.[0]).toMatchObject({
    projectId: secondId,
    projectTitle: next.title,
    mode: 'statistics',
  });
  expect(screen.queryByText('E01 买卖合同')).toBeNull();
});

it('保存中与回执未知时仍拒绝键盘切换，不派发第二次保存', async () => {
  let rejectSave!: (error: Error) => void;
  const pendingSave = new Promise<CatalogResponse>((_resolve, reject) => {
    rejectSave = reject;
  });
  const catalog = vi.fn(async (request: CatalogRequest): Promise<CatalogResponse> =>
    request.operation === 'save_project_visualization_view' ? pendingSave : response(),
  );
  window.caselite.catalog = catalog;
  await mount();
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('tab', { name: '统计', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '保存视图', exact: true }));
  const statistics = screen.getByRole('tab', { name: '统计', exact: true });
  expect((statistics as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
  expect(statistics.getAttribute('aria-selected')).toBe('true');
  await act(async () => {
    rejectSave(new Error('synthetic lost ACK'));
    await pendingSave.catch(() => {});
  });
  expect((statistics as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
  expect(statistics.getAttribute('aria-selected')).toBe('true');
  expect(
    catalog.mock.calls.filter(
      ([request]) => request.operation === 'save_project_visualization_view',
    ),
  ).toHaveLength(1);
});
