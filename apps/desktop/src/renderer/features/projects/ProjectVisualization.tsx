import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Background,
  Controls,
  ControlButton,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  useViewport,
  type NodeChange,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import type { Matter, Task } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';
import { projectRelationships } from './ProjectRelationshipGraph';
import {
  sampleVisualization,
  captureVisualizationLayout,
  applyVisualizationLayout,
  rememberVisualizationLayout,
  stepVisualizationLayout,
  visualizationModes,
  type VisualizationLayout,
  type VisualizationLayoutHistory,
  type VisualizationMode,
  type VisualizationNode,
  type VisualizationInspection,
} from './project-visualization-model';

type GraphDocument = { id: string; title: string; task_id: string; matter_id: string | null };

const VisualCard = memo(function VisualCard({ data, selected }: NodeProps<VisualizationNode>) {
  const content = data.kind === 'matrix' || data.kind === 'chronicle';
  const icon =
    data.kind === 'entity'
      ? 'folder'
      : data.kind === 'claim'
        ? 'board'
        : data.kind === 'event'
          ? 'clock'
          : 'file';
  return (
    <div
      className={`visualization-card is-${data.kind} tone-${data.tone ?? 'neutral'}${selected ? ' is-selected' : ''}`}
    >
      {!content && data.kind !== 'statistics' && (
        <>
          <Handle id="left" type="target" position={Position.Left} />
          <Handle id="right" type="source" position={Position.Right} />
          <Handle id="top" type="target" position={Position.Top} />
          <Handle id="bottom" type="source" position={Position.Bottom} />
        </>
      )}
      <div className="visualization-card-heading drag-handle">
        <Icon
          name={content ? 'list' : data.kind === 'statistics' ? 'wallet' : icon}
          size={content ? 18 : 24}
        />
        <strong>{data.label}</strong>
      </div>
      {data.subtitle && <p>{data.subtitle}</p>}
      {data.tag && <span className="visualization-node-tag">{data.tag}</span>}
      {content && (
        <div
          className="visualization-table-scroll nodrag nopan nowheel"
          tabIndex={0}
          aria-label={`${data.label}内容`}
        >
          <table>
            <thead>
              <tr>
                {data.columns?.map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows?.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.kind === 'statistics' && (
        <div className="visualization-statistic nodrag nopan">
          <p>
            合同金额 <strong>100万元</strong>
          </p>
          <div
            className="visualization-amount-bar"
            role="img"
            aria-label="已付60万元，占60%；未付40万元，占40%"
          >
            <span>已付60万元 · 60%</span>
            <span>未付40万元 · 40%</span>
          </div>
          <div className="visualization-money-flow">
            <span>远川制造公司</span>
            <span>已付60万元 →</span>
            <span>星桥设备公司</span>
          </div>
          <small>统计口径：虚构合同与付款数据，单位为万元。</small>
        </div>
      )}
      {content && (
        <small className="visualization-table-note">
          {data.kind === 'matrix' ? '均为当事人主张，待审查。' : '示例出处尚未关联真实材料。'}
        </small>
      )}
    </div>
  );
});
const nodeTypes = { 'visual-card': VisualCard };
const canvasLabels = {
  'controls.zoomIn.ariaLabel': '放大画布',
  'controls.zoomOut.ariaLabel': '缩小画布',
  'controls.fitView.ariaLabel': '适应画布',
};

export default function ProjectVisualization({
  project,
  tasks,
  documents,
  readError,
  onOpen,
  onInspect,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  project: Matter;
  tasks: Task[];
  documents: GraphDocument[] | null;
  readError: boolean;
  onOpen(taskId: string, documentId?: string): void;
  onInspect(value: VisualizationInspection): void;
  sidebarCollapsed: boolean;
  onToggleSidebar(): void;
}) {
  const [mode, setMode] = useState<VisualizationMode>('relations');
  const [sample, setSample] = useState(false);
  const [positions, setPositions] = useState<Record<string, VisualizationNode[]>>({});
  const [histories, setHistories] = useState<Record<string, VisualizationLayoutHistory>>({});
  const [layoutPreview, setLayoutPreview] = useState<{
    key: string;
    nodes: VisualizationNode[];
  } | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const dragOrigin = useRef<VisualizationLayout | null>(null);
  const [selections, setSelections] = useState<Record<string, string | undefined>>({});
  const [viewports, setViewports] = useState<Record<string, Viewport>>({});
  const current = `${project.id}:${mode}:${sample}`;
  const history = histories[current] ?? { past: [], future: [] };
  const records = useMemo(
    () => projectRelationships(project, tasks, documents ?? []),
    [project, tasks, documents],
  );
  const graph = useMemo(() => {
    if (sample) return sampleVisualization(mode);
    if (mode !== 'relations' || readError || !documents) return { nodes: [], edges: [] };
    return {
      nodes: records.nodes.map((node): VisualizationNode => ({
        id: node.id,
        type: 'visual-card',
        position: { x: node.position.x * 1.35, y: node.position.y * 1.85 },
        data: {
          label: String(node.data.label),
          kind: 'record',
          description:
            '当前项目已归组任务及关联文档的只读投影。此连线表示记录归属，不表示法律关系。',
          properties: [
            [
              '对象类型',
              node.id.startsWith('project:')
                ? '项目'
                : node.id.startsWith('task:')
                  ? '任务'
                  : '文档',
            ],
            ['所属项目', project.title],
            ['关系含义', '项目记录归属'],
          ],
        },
      })),
      edges: records.edges,
    };
  }, [sample, mode, readError, documents, records, project.title]);
  // 只缓存本窗口的版面；业务数据始终来自受控读结果，不能被位置缓存覆盖。
  const nodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        const cached = positions[current]?.find((entry) => entry.id === node.id);
        return {
          ...node,
          position: cached?.position ?? node.position,
          selected: selections[current] === node.id,
          dragHandle: '.drag-handle',
        };
      }),
    [graph.nodes, positions, current, selections],
  );
  const selected = nodes.find((node) => node.id === selections[current]);
  const lastInspection = useRef('');
  useEffect(() => {
    const inspection: VisualizationInspection = {
      projectId: project.id,
      mode,
      sample,
      nodeCount: nodes.length,
      edgeCount: graph.edges.length,
      selected: selected
        ? {
            id: selected.id,
            data: selected.data,
            destination: sample ? undefined : records.destinations.get(selected.id),
          }
        : undefined,
    };
    // 父页重建等价查询数组不能形成回报循环；此处只去重通知，不缓存业务真源。
    const signature = JSON.stringify(inspection);
    if (lastInspection.current === signature) return;
    lastInspection.current = signature;
    onInspect(inspection);
  }, [
    project.id,
    mode,
    sample,
    nodes.length,
    graph.edges.length,
    selected,
    records.destinations,
    onInspect,
  ]);
  useEffect(() => {
    const dialog = previewDialog.current;
    if (!dialog) return;
    if (layoutPreview && !dialog.open) dialog.showModal();
    else if (!layoutPreview && dialog.open) {
      dialog.close();
      previewTrigger.current?.focus();
    }
  }, [layoutPreview]);
  const rememberLayout = (before: VisualizationLayout, after: VisualizationLayout) => {
    setHistories((previous) => ({
      ...previous,
      [current]: rememberVisualizationLayout(
        previous[current] ?? { past: [], future: [] },
        before,
        after,
      ),
    }));
  };
  const stepLayout = (direction: 'undo' | 'redo') => {
    const result = stepVisualizationLayout(history, captureVisualizationLayout(nodes), direction);
    if (!result) return;
    setPositions((previous) => ({
      ...previous,
      [current]: applyVisualizationLayout(graph.nodes, result.layout),
    }));
    setHistories((previous) => ({ ...previous, [current]: result.history }));
  };
  const changeNodes = useCallback(
    (changes: NodeChange<VisualizationNode>[]) => {
      const selectedChanges = changes.filter((change) => change.type === 'select');
      if (selectedChanges.length) {
        const next = selectedChanges.find((change) => change.selected);
        setSelections((previous) => ({
          ...previous,
          [current]:
            next?.id ??
            (selectedChanges.some((change) => change.id === previous[current])
              ? undefined
              : previous[current]),
        }));
      }
      const positionChanges = changes.filter((change) => change.type === 'position');
      if (!positionChanges.length) return;
      if (!dragOrigin.current) {
        const before = applyVisualizationLayout(
          graph.nodes,
          captureVisualizationLayout(positions[current] ?? graph.nodes),
        );
        const after = applyNodeChanges(positionChanges, before);
        setHistories((previous) => ({
          ...previous,
          [current]: rememberVisualizationLayout(
            previous[current] ?? { past: [], future: [] },
            captureVisualizationLayout(before),
            captureVisualizationLayout(after),
          ),
        }));
      }
      setPositions((previous) => ({
        ...previous,
        [current]: applyNodeChanges(
          positionChanges,
          applyVisualizationLayout(
            graph.nodes,
            captureVisualizationLayout(previous[current] ?? graph.nodes),
          ),
        ),
      }));
    },
    [current, graph.nodes, positions],
  );
  const changeSelection = useCallback(
    (id?: string) => setSelections((previous) => ({ ...previous, [current]: id })),
    [current],
  );
  const keyboardTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const keys = Object.keys(visualizationModes) as VisualizationMode[];
    const index = keys.indexOf(mode);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? keys.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    event.preventDefault();
    setMode(keys[next]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  };
  const empty = !sample && mode !== 'relations';
  const pending = !sample && mode === 'relations' && !documents && !readError;
  return (
    <div className="project-visualization" data-mode={mode} data-sample={sample}>
      <div className="visualization-toolbar">
        <div
          role="tablist"
          aria-label="图示类型"
          className="visualization-tabs"
          onKeyDown={keyboardTabs}
        >
          {Object.entries(visualizationModes).map(([id, item]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`visualization-tab-${id}`}
              aria-selected={mode === id}
              aria-controls="visualization-canvas"
              tabIndex={mode === id ? 0 : -1}
              onClick={() => setMode(id as VisualizationMode)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="visualization-actions">
          <button type="button" aria-pressed={sample} onClick={() => setSample((value) => !value)}>
            {sample ? '返回项目数据' : '查看虚构示例'}
          </button>
          <button
            ref={previewTrigger}
            type="button"
            disabled={nodes.length === 0}
            title="预览默认排布；确认后只调整节点位置"
            onClick={() => setLayoutPreview({ key: current, nodes: graph.nodes })}
          >
            重新排布
          </button>
          <button
            type="button"
            aria-label={sidebarCollapsed ? '展开可视化辅助栏' : '收起可视化辅助栏'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="project-visualization-auxiliary"
            title={
              sidebarCollapsed
                ? '展开辅助栏，保留原属性与 AI 草稿'
                : '收起辅助栏，扩大画布并保留 AI 草稿'
            }
            onClick={onToggleSidebar}
          >
            <Icon name="panel" size={17} />
          </button>
        </div>
      </div>
      <div className="visualization-context-line">
        <strong>
          {sample
            ? visualizationModes[mode].title
            : mode === 'relations'
              ? '项目记录关系图'
              : visualizationModes[mode].title}
        </strong>
        <span className={sample ? 'visualization-sample-badge' : ''}>
          {sample ? '虚构示例 · 不计入项目' : '当前项目'}
        </span>
        {mode === 'timeline' && sample && <span>非等比例示意</span>}
      </div>
      <div
        id="visualization-canvas"
        role="tabpanel"
        aria-labelledby={`visualization-tab-${mode}`}
        className="visualization-canvas"
      >
        <ReactFlow<VisualizationNode>
          key={current}
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={changeNodes}
          onNodeDragStart={() => {
            dragOrigin.current = captureVisualizationLayout(nodes);
          }}
          onNodeDragStop={(_, node) => {
            const before = dragOrigin.current;
            dragOrigin.current = null;
            if (!before) return;
            const after = captureVisualizationLayout(nodes);
            after[node.id] = { ...node.position };
            rememberLayout(before, after);
          }}
          onNodeClick={(_, node) => changeSelection(node.id)}
          onPaneClick={() => changeSelection()}
          onNodeDoubleClick={(_, node) => {
            const destination = !sample && records.destinations.get(node.id);
            if (destination) onOpen(destination.taskId, destination.documentId);
          }}
          defaultViewport={viewports[current]}
          fitView={!viewports[current]}
          fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
          onMoveEnd={(_, viewport) => {
            setViewports((previous) => ({ ...previous, [current]: viewport }));
          }}
          nodesConnectable={false}
          edgesReconnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          minZoom={0.25}
          maxZoom={1.6}
          aria-label={`${visualizationModes[mode].title}画布`}
          ariaLabelConfig={canvasLabels}
        >
          <Background gap={22} size={1} />
          <Controls showInteractive={false}>
            <CanvasZoomLabel />
            <ControlButton
              title="撤销上一次版面调整"
              aria-label="撤销版面"
              disabled={!history.past.length}
              onClick={() => stepLayout('undo')}
            >
              <Icon name="back" size={15} />
            </ControlButton>
            <ControlButton
              title="重做已撤销的版面调整"
              aria-label="重做版面"
              disabled={!history.future.length}
              onClick={() => stepLayout('redo')}
            >
              <span className="visualization-redo-icon">
                <Icon name="back" size={15} />
              </span>
            </ControlButton>
          </Controls>
        </ReactFlow>
        {(empty || pending || (!sample && readError)) && (
          <div className="visualization-empty">
            <Icon name={visualizationModes[mode].icon} size={32} />
            <h3>
              {readError
                ? '暂时无法读取项目记录'
                : pending
                  ? '正在读取项目记录…'
                  : `暂无可展示的${visualizationModes[mode].label}数据`}
            </h3>
            <p>
              {readError
                ? '请使用项目页的重新读取入口重试。'
                : pending
                  ? '读取完成后显示当前项目的任务与文档归属。'
                  : '专业事实、证据及图示数据接口尚未接入。可先查看独立虚构示例，审查图示与属性布局。'}
            </p>
            {!pending && (
              <button type="button" onClick={() => setSample(true)}>
                查看虚构示例
              </button>
            )}
          </div>
        )}
        <div className="visualization-canvas-status">
          {nodes.length} 个节点 · {graph.edges.length} 条连线<span>版面调整仅本次会话</span>
        </div>
      </div>
      <dialog
        ref={previewDialog}
        className="visualization-layout-preview"
        aria-labelledby="visualization-preview-title"
        onCancel={(event) => {
          event.preventDefault();
          setLayoutPreview(null);
        }}
      >
        <h3 id="visualization-preview-title">重新排布预览</h3>
        <p>确认后恢复当前图示的默认排布。只调整位置，日期、金额、主张与来源保持原样。</p>
        {layoutPreview && <LayoutPreview nodes={layoutPreview.nodes} />}
        {layoutPreview && layoutPreview.nodes !== graph.nodes && (
          <p role="status">当前图示已变化，请取消后重新预览。</p>
        )}
        <div className="visualization-preview-actions">
          <button type="button" onClick={() => setLayoutPreview(null)}>
            取消
          </button>
          <button
            type="button"
            disabled={layoutPreview?.key !== current || layoutPreview?.nodes !== graph.nodes}
            onClick={() => {
              if (
                !layoutPreview ||
                layoutPreview.key !== current ||
                layoutPreview.nodes !== graph.nodes
              )
                return;
              rememberLayout(
                captureVisualizationLayout(nodes),
                captureVisualizationLayout(layoutPreview.nodes),
              );
              setPositions((previous) => ({ ...previous, [current]: layoutPreview.nodes }));
              setLayoutPreview(null);
            }}
          >
            应用版面
          </button>
        </div>
      </dialog>
    </div>
  );
}

function LayoutPreview({ nodes }: { nodes: VisualizationNode[] }) {
  const width = Math.max(360, ...nodes.map((node) => node.position.x + 240));
  const height = Math.max(150, ...nodes.map((node) => node.position.y + 130));
  return (
    <svg
      className="visualization-layout-thumbnail"
      viewBox={`-20 -20 ${width + 40} ${height + 40}`}
      role="img"
      aria-label="应用后的节点位置预览"
    >
      {nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.position.x} ${node.position.y})`}>
          <rect width="220" height="110" rx="8" />
          <text x="110" y="58" textAnchor="middle">
            {node.data.label.length > 15 ? node.data.label.slice(0, 14) + '…' : node.data.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function CanvasZoomLabel() {
  const { zoom } = useViewport();
  return (
    <output className="visualization-zoom-label" aria-label="画布缩放比例">
      {Math.round(zoom * 100)}%
    </output>
  );
}
