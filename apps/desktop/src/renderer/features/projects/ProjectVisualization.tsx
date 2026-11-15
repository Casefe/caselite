import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Background,
  Controls,
  ControlButton,
  Handle,
  Position,
  ReactFlow,
  useViewport,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import type { ProjectVisualizationConfig } from './project-visualization-view-model';
import type { Matter, Task } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';
import {
  sampleVisualization,
  visualizationModes,
  type VisualizationNode,
  type VisualizationInspection,
  type VisualizationMode,
} from './project-visualization-model';
import { useProjectVisualizationView } from './useProjectVisualizationView';
import {
  projectVisualizationRecords,
  recordDestination,
  recordKindNames,
} from './project-visualization-records';
import {
  visualizationRefKey,
  visualizationLayoutFields,
  type VisualizationSession,
} from './project-visualization-view-model';
type GraphDocument = {
  id: string;
  title: string;
  task_id: string;
  matter_id: string | null;
  version?: number;
  body_revision?: number;
};
const VisualCard = memo(function VisualCard({
  data,
  selected,
  isConnectable,
}: NodeProps<VisualizationNode>) {
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
          {/* 同一只读值必须同时控制普通、开始和结束，否则库仍会启动连接。 */}
          <Handle
            id="left"
            type="target"
            position={Position.Left}
            isConnectable={isConnectable}
            isConnectableStart={isConnectable}
            isConnectableEnd={isConnectable}
          />
          <Handle
            id="right"
            type="source"
            position={Position.Right}
            isConnectable={isConnectable}
            isConnectableStart={isConnectable}
            isConnectableEnd={isConnectable}
          />
          <Handle
            id="top"
            type="target"
            position={Position.Top}
            isConnectable={isConnectable}
            isConnectableStart={isConnectable}
            isConnectableEnd={isConnectable}
          />
          <Handle
            id="bottom"
            type="source"
            position={Position.Bottom}
            isConnectable={isConnectable}
            isConnectableStart={isConnectable}
            isConnectableEnd={isConnectable}
          />
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
  onOpen,
  onInspect,
  sidebarCollapsed,
  onToggleSidebar,
  onDirty,
  onSession,
  initialSession,
}: {
  project: Matter;
  tasks: Task[];
  documents: GraphDocument[] | null;
  readError: boolean;
  onOpen(taskId: string, documentId?: string): void;
  onInspect(value: VisualizationInspection): void;
  sidebarCollapsed: boolean;
  onToggleSidebar(): void;
  onDirty?(dirty: boolean): void;
  onSession?(session: VisualizationSession): void;
  initialSession?: VisualizationSession;
}) {
  const hint = JSON.stringify([
    project.version,
    project.title,
    project.archived_at,
    tasks
      .filter((t) => t.matter_id === project.id)
      .map((t) => [t.id, t.version, t.title, t.body_revision]),
    documents?.map((d) => [d.id, d.version, d.body_revision, d.title]),
  ]);
  const restoredSession = initialSession?.projectId === project.id ? initialSession : undefined;
  const view = useProjectVisualizationView(project.id, hint, restoredSession?.config);
  const updateConfiguration = view.edit;
  const [mode, setMode] = useState<VisualizationMode>(restoredSession?.mode ?? 'relations');
  const [sample, setSample] = useState(restoredSession?.sample ?? false);
  const [sampleSelection, setSampleSelection] = useState<string>();
  const [maximized, setMaximized] = useState(false);
  const [notice, setNotice] = useState('');
  const restored = useRef<string | null>(null);
  const requestedMode = useRef<{ projectId: string; mode: VisualizationMode } | null>(null);
  useEffect(() => {
    if (restored.current === project.id || !view.graph) return;
    restored.current = project.id;
    // 首个快照只补默认表示，不能覆盖当前项目已接受的目录操作；新项目独立恢复。
    const requested =
      requestedMode.current?.projectId === project.id ? requestedMode.current.mode : undefined;
    const next = requested ?? restoredSession?.mode ?? view.draft.mode;
    setMode(next);
    if (requested && next !== view.draft.mode && (next === 'relations' || next === 'statistics'))
      updateConfiguration({ mode: next }, true);
  }, [project.id, view.graph, view.draft.mode, updateConfiguration, restoredSession]);
  const [preview, setPreview] = useState<{
    config: ProjectVisualizationConfig;
    source: string;
    revision: number;
    before: ReturnType<typeof visualizationLayoutFields>;
  } | null>(null);
  const [history, setHistory] = useState<
    {
      before: ReturnType<typeof visualizationLayoutFields>;
      after: ReturnType<typeof visualizationLayoutFields>;
    }[]
  >([]);
  const [future, setFuture] = useState<typeof history>([]);
  const dragOrigin = useRef<ReturnType<typeof visualizationLayoutFields> | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const expired = Boolean(
    preview &&
    (preview.source !== view.graph?.fingerprint ||
      preview.revision !== view.committed?.revision ||
      view.externalChanged),
  );
  const effective = preview && !expired ? preview.config : view.draft;
  const real = useMemo(
    () =>
      view.graph ? projectVisualizationRecords(view.graph, effective) : { nodes: [], edges: [] },
    [view.graph, effective],
  );
  const graph = useMemo(
    () =>
      sample
        ? sampleVisualization(mode)
        : mode === 'relations' || mode === 'statistics'
          ? real
          : { nodes: [], edges: [] },
    [sample, mode, real],
  );
  const nodes = graph.nodes.map((node) => ({
    ...node,
    selected: sample ? sampleSelection === node.id : node.selected,
    dragHandle: '.drag-handle',
  }));
  const selected = nodes.find((node) => node.selected);
  const selectedRecord = view.graph?.nodes.find(
    (node) => visualizationRefKey(node) === selected?.id,
  );
  const writable = Boolean(
    view.graph &&
    !view.graph.read_only &&
    !view.locked &&
    !view.requiresReload &&
    !view.externalChanged &&
    !sample,
  );
  const editView = view.edit;
  const customLabels = view.draft.custom_labels;
  const sourceProjectTitle = view.graph?.nodes.find((node) => node.kind === 'project')?.title;
  const editLabel = useCallback(
    (text: string) => {
      if (!selectedRecord) return;
      const node = { kind: selectedRecord.kind, id: selectedRecord.id };
      const labels = customLabels.filter(
        (label) => visualizationRefKey(label.node) !== visualizationRefKey(node),
      );
      editView({ custom_labels: text.trim() ? [...labels, { node, text }] : labels });
    },
    [selectedRecord, customLabels, editView],
  );
  const inspectionSignature = JSON.stringify([
    project.id,
    sourceProjectTitle,
    mode,
    sample,
    nodes.length,
    graph.edges.length,
    selected?.id,
    selected?.data,
    // 父级保留编辑回调；其他节点标签更新后也须换新，避免旧闭包覆盖已接受的标签。
    customLabels,
    writable,
    view.locked,
  ]);
  const lastInspection = useRef('');
  useEffect(() => {
    if (lastInspection.current === inspectionSignature) return;
    lastInspection.current = inspectionSignature;
    onInspect({
      projectId: project.id,
      projectTitle: sourceProjectTitle,
      mode,
      sample,
      nodeCount: nodes.length,
      edgeCount: graph.edges.length,
      readOnly: !writable,
      busy: view.locked,
      editLabel: selectedRecord && !sample ? editLabel : undefined,
      selected: selected
        ? {
            id: selected.id,
            data: selected.data,
            destination: !sample && selectedRecord ? recordDestination(selectedRecord) : undefined,
          }
        : undefined,
    });
  }, [
    inspectionSignature,
    sourceProjectTitle,
    onInspect,
    project.id,
    mode,
    sample,
    nodes.length,
    graph.edges.length,
    writable,
    view.locked,
    editLabel,
    selected,
    selectedRecord,
  ]);
  const sessionSignature = JSON.stringify([project.id, mode, sample, view.draft]);
  const lastSession = useRef('');
  useEffect(() => {
    if (!view.committed || lastSession.current === sessionSignature) return;
    lastSession.current = sessionSignature;
    onSession?.({ projectId: project.id, config: view.draft, mode, sample });
  }, [sessionSignature, onSession, project.id, view.draft, view.committed, mode, sample]);
  useEffect(() => {
    onDirty?.(view.dirty || view.locked || Boolean(preview));
    return () => onDirty?.(false);
  }, [onDirty, view.dirty, view.locked, preview]);
  const chooseMode = (next: VisualizationMode) => {
    if (view.locked || preview) return;
    requestedMode.current = { projectId: project.id, mode: next };
    setMode(next);
    if (next === 'relations' || next === 'statistics') view.edit({ mode: next }, true);
  };
  const choose = (id?: string) => {
    if (sample) {
      setSampleSelection(id);
      return;
    }
    const record = view.graph?.nodes.find((node) => visualizationRefKey(node) === id);
    view.edit({ selected: record ? { kind: record.kind, id: record.id } : null }, true);
  };
  const openRecord = (id: string) => {
    if (sample) return;
    if (view.dirty || view.locked || preview) {
      setNotice('视图尚未保存或正在核对结果，请先保存视图再打开原记录。');
      return;
    }
    const record = view.graph?.nodes.find((node) => visualizationRefKey(node) === id);
    const destination = record && recordDestination(record);
    if (destination) onOpen(destination.taskId, destination.documentId);
  };
  const startPreview = (config: ProjectVisualizationConfig) => {
    if (!writable || !view.graph || !view.committed) return;
    setPreview({
      config,
      source: view.graph.fingerprint,
      revision: view.committed.revision,
      before: visualizationLayoutFields(view.draft),
    });
  };
  const cancelPreview = () => {
    if (view.locked) return;
    setPreview(null);
    queueMicrotask(() => previewTrigger.current?.focus());
  };
  const remember = (
    before: ReturnType<typeof visualizationLayoutFields>,
    after: ReturnType<typeof visualizationLayoutFields>,
  ) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      setHistory((old) => [...old, { before, after }].slice(-40));
      setFuture([]);
    }
  };
  const changeNodes = (changes: NodeChange<VisualizationNode>[]) => {
    const selection = changes.find((change) => change.type === 'select' && change.selected);
    if (selection?.type === 'select') choose(selection.id);
    if (!writable || preview) return;
    const changesOfPosition = changes.filter((change) => change.type === 'position');
    if (!changesOfPosition.length) return;
    const positions = [...view.draft.positions];
    for (const change of changesOfPosition) {
      if (!change.position) continue;
      const record = view.graph?.nodes.find((node) => visualizationRefKey(node) === change.id);
      if (!record) continue;
      const item = { node: { kind: record.kind, id: record.id }, ...change.position };
      const index = positions.findIndex((p) => visualizationRefKey(p.node) === change.id);
      if (index < 0) positions.push(item);
      else positions[index] = item;
    }
    const next = { ...view.draft, positions };
    if (!dragOrigin.current)
      remember(visualizationLayoutFields(view.draft), visualizationLayoutFields(next));
    view.edit({ positions });
  };
  const step = async (direction: 'undo' | 'redo') => {
    const item = (direction === 'undo' ? history : future).at(-1);
    if (!item || !writable || preview) return;
    const expected = direction === 'undo' ? item.after : item.before;
    if (JSON.stringify(visualizationLayoutFields(view.draft)) !== JSON.stringify(expected)) {
      setNotice('版面已有后续修改，不能覆盖；请重新核对当前视图。');
      return;
    }
    if (await view.save({ ...view.draft, ...(direction === 'undo' ? item.before : item.after) })) {
      if (direction === 'undo') {
        setHistory((old) => old.slice(0, -1));
        setFuture((old) => [...old, item]);
      } else {
        setFuture((old) => old.slice(0, -1));
        setHistory((old) => [...old, item]);
      }
    }
  };
  const keyboardTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.nativeEvent.isComposing ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
      view.locked ||
      preview
    )
      return;
    const keys = Object.keys(visualizationModes) as VisualizationMode[];
    const index = keys.indexOf(mode);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? keys.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
    event.preventDefault();
    chooseMode(keys[next]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  };
  const unavailable = !sample && !['relations', 'statistics'].includes(mode);
  const pending = !sample && view.phase === 'loading';
  const failed = !sample && !view.graph && !pending;
  const isList = !sample && mode === 'relations' && effective.representation === 'list';
  const visibleRecords =
    view.graph?.nodes.filter((record) =>
      real.nodes.some((node) => node.id === visualizationRefKey(record)),
    ) ?? [];
  const count = (kind: string) => visibleRecords.filter((node) => node.kind === kind).length;
  const activeNotice =
    notice.startsWith('视图尚未保存') && !view.dirty && !view.locked && !preview ? '' : notice;
  const stateText =
    view.phase === 'saving'
      ? '保存中…'
      : view.phase === 'checking'
        ? '正在核对结果…'
        : view.hasUnresolved
          ? '保存结果仍未确认'
          : view.phase === 'failed'
            ? '本次保存失败'
            : view.phase === 'abandoned'
              ? '已放弃本次输入 · 结果未确认'
              : view.dirty
                ? '视图未保存'
                : view.hasChanges
                  ? '浏览状态仅本次'
                  : view.committed?.revision
                    ? '已保存'
                    : '默认视图 · 尚未保存';
  const recordList = (label: string) => (
    <table className="visualization-record-list" aria-label={label}>
      <thead>
        <tr>
          <th>记录</th>
          <th>类型</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        {visibleRecords.map((record) => (
          <tr
            key={visualizationRefKey(record)}
            aria-selected={selected?.id === visualizationRefKey(record)}
          >
            <td>
              <button
                type="button"
                onClick={() => choose(visualizationRefKey(record))}
                aria-label={`选择${recordKindNames[record.kind]}：${record.title}`}
              >
                {record.title}
              </button>
            </td>
            <td>{recordKindNames[record.kind]}</td>
            <td>
              {recordDestination(record) ? (
                <button type="button" onClick={() => openRecord(visualizationRefKey(record))}>
                  打开原记录
                </button>
              ) : (
                '当前项目'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div
      className={`project-visualization${maximized ? ' is-maximized' : ''}`}
      data-mode={mode}
      data-sample={sample}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.nativeEvent.isComposing &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement) &&
          preview
        ) {
          event.preventDefault();
          cancelPreview();
        }
      }}
    >
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
              disabled={view.locked || Boolean(preview)}
              onClick={() => chooseMode(id as VisualizationMode)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="visualization-actions">
          <button
            type="button"
            aria-pressed={sample}
            disabled={view.locked || Boolean(preview)}
            onClick={() => setSample((value) => !value)}
          >
            {sample ? '返回项目数据' : '查看虚构示例'}
          </button>
          <button
            ref={previewTrigger}
            type="button"
            disabled={!writable || Boolean(preview) || mode !== 'relations'}
            onClick={() => startPreview({ ...view.draft, positions: [] })}
          >
            重新排布
          </button>
          <button
            type="button"
            aria-label={maximized ? '还原可视化' : '最大化可视化'}
            aria-pressed={maximized}
            onClick={() => setMaximized((value) => !value)}
          >
            {maximized ? '还原' : '最大化'}
          </button>
          <button
            type="button"
            aria-label={sidebarCollapsed ? '展开可视化辅助栏' : '收起可视化辅助栏'}
            aria-expanded={!sidebarCollapsed}
            aria-controls="project-visualization-auxiliary"
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
              ? '项目记录归属图'
              : mode === 'statistics'
                ? '当前范围记录统计'
                : visualizationModes[mode].title}
        </strong>
        <span className={sample ? 'visualization-sample-badge' : ''}>
          {sample ? '虚构示例 · 不计入项目' : '当前项目 · 记录归属'}
        </span>
        {mode === 'timeline' && sample && <span>非等比例示意</span>}
        {!sample && view.graph && (
          <span>
            {view.graph.nodes.length} 个已加载对象 · 最多200个
            {view.graph.truncated ? ' · 范围已截断' : ''}
          </span>
        )}
      </div>
      {!sample && (mode === 'relations' || mode === 'statistics') && (
        <div className="visualization-view-controls">
          {mode === 'relations' ? (
            <>
              <label>
                表示方式
                <select
                  aria-label="表示方式"
                  value={effective.representation}
                  disabled={!writable || Boolean(preview)}
                  onChange={(event) =>
                    startPreview({
                      ...view.draft,
                      representation: event.target
                        .value as ProjectVisualizationConfig['representation'],
                      grouping: event.target.value === 'grouped' ? 'kind' : 'none',
                      positions: [],
                    })
                  }
                >
                  <option value="network">归属网络</option>
                  <option value="grouped">按种类分组</option>
                  <option value="list">记录列表</option>
                </select>
              </label>
              <label>
                标签
                <select
                  aria-label="标签显示"
                  value={view.draft.labels}
                  disabled={!writable || Boolean(preview)}
                  onChange={(event) =>
                    view.edit({ labels: event.target.value as 'full' | 'compact' })
                  }
                >
                  <option value="full">完整标签</option>
                  <option value="compact">精简标签</option>
                </select>
              </label>
            </>
          ) : (
            <span>唯一对象计数表</span>
          )}
          <fieldset disabled={!writable || Boolean(preview)}>
            <legend>可见种类</legend>
            {(['project', 'task', 'document'] as const).map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={view.draft.visible_kinds.includes(kind)}
                  onChange={() => {
                    const kinds = view.draft.visible_kinds.includes(kind)
                      ? view.draft.visible_kinds.filter((value) => value !== kind)
                      : [...view.draft.visible_kinds, kind];
                    if (kinds.length) view.edit({ visible_kinds: kinds });
                  }}
                />
                {recordKindNames[kind]}
              </label>
            ))}
          </fieldset>
          <span role="status">{stateText}</span>
          <button
            type="button"
            disabled={
              !writable ||
              Boolean(preview) ||
              (!view.hasChanges && Boolean(view.committed?.revision))
            }
            onClick={() => void view.save()}
          >
            保存视图
          </button>
          <button type="button" disabled={view.locked} onClick={() => void view.refresh()}>
            重新读取
          </button>
          {(view.dirty || view.externalChanged) && !view.hasUnresolved && (
            <button type="button" disabled={view.locked} onClick={view.discard}>
              重新载入已保存视图
            </button>
          )}
        </div>
      )}
      {!sample && view.graph?.read_only && (
        <p className="visualization-caution" role="status">
          项目已归档，视图只读。
        </p>
      )}
      {!sample && view.graph?.truncated && (
        <p className="visualization-caution" role="status">
          已截断：仅展示当前有界读取的最多200个对象，统计不是全项目总数。
        </p>
      )}
      {!sample && (view.sourceChanged || view.latest?.scope_pruned) && (
        <p className="visualization-source-notice" role="status">
          {view.latest?.scope_pruned
            ? '部分对象已移出当前可读范围，相关标签、位置与选择已隐藏，保存历史仍保留。'
            : '来源已联动；自定义标签与手工位置已保留，请检查标签是否仍符合原意。'}
        </p>
      )}
      {(activeNotice || (!sample && view.error)) && (
        <p className="visualization-caution" role="status">
          {view.error || activeNotice}
        </p>
      )}
      {!sample && view.hasUnresolved && !view.busy && (
        <div className="visualization-recovery">
          <button type="button" onClick={() => void view.check()}>
            {view.phase === 'failed' ? '继续核对原提交' : '核对保存结果'}
          </button>
          <button type="button" disabled={!view.canRetry} onClick={() => void view.retry()}>
            重试原提交
          </button>
          <button type="button" onClick={view.abandon}>
            放弃本次输入与核对
          </button>
          <p>放弃只解除本地输入和核对保护，不会取消可能已保存的结果。</p>
        </div>
      )}
      {preview && (
        <div className="visualization-preview-bar" role="region" aria-label="重新排布预览">
          <strong>{expired ? '预览已过期' : '预览 · 仅调整视图表达'}</strong>
          <span>
            {expired
              ? '来源或视图已变化，请取消后重新预览。'
              : '取消恢复原配置、选择和视口；应用后真实保存。'}
          </span>
          <button type="button" disabled={view.locked} onClick={cancelPreview}>
            取消
          </button>
          <button
            type="button"
            disabled={expired || view.locked}
            onClick={async () => {
              const proposal = preview;
              setPreview(null);
              if (await view.save(proposal.config))
                remember(proposal.before, visualizationLayoutFields(proposal.config));
            }}
          >
            应用版面
          </button>
        </div>
      )}
      <div
        id="visualization-canvas"
        role="tabpanel"
        aria-labelledby={`visualization-tab-${mode}`}
        className="visualization-canvas"
      >
        {!sample && mode === 'statistics' && view.graph ? (
          <div className="visualization-record-statistics">
            <h3>当前范围唯一对象</h3>
            <p>
              当前加载 {view.graph.nodes.length} 个对象，可见 {visibleRecords.length}{' '}
              个；每个对象只计一次。
            </p>
            <table aria-label="当前范围记录统计">
              <thead>
                <tr>
                  <th>种类</th>
                  <th>唯一对象数</th>
                </tr>
              </thead>
              <tbody>
                {(['project', 'task', 'document'] as const).map((kind) => (
                  <tr key={kind}>
                    <th>{recordKindNames[kind]}</th>
                    <td>{count(kind)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : isList ? (
          recordList('项目记录列表')
        ) : (
          <ReactFlow<VisualizationNode>
            key={sample ? `sample:${mode}` : 'records'}
            nodes={nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            onNodesChange={changeNodes}
            onNodeClick={(_, node) => choose(node.id)}
            onPaneClick={() => choose()}
            onNodeDoubleClick={(_, node) => openRecord(node.id)}
            onNodeDragStart={() => {
              dragOrigin.current = visualizationLayoutFields(view.draft);
            }}
            onNodeDragStop={(_, node) => {
              const before = dragOrigin.current;
              dragOrigin.current = null;
              if (!before || !writable) return;
              const record = view.graph?.nodes.find(
                (entry) => visualizationRefKey(entry) === node.id,
              );
              if (!record) return;
              const positions = view.draft.positions.filter(
                (p) => visualizationRefKey(p.node) !== node.id,
              );
              positions.push({ node: { kind: record.kind, id: record.id }, ...node.position });
              remember(before, visualizationLayoutFields({ ...view.draft, positions }));
            }}
            viewport={sample ? undefined : effective.viewport}
            onMoveEnd={(_, viewport) => {
              if (!sample && !preview) view.edit({ viewport }, true);
            }}
            fitView={sample}
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
            nodesDraggable={writable && !preview}
            nodesConnectable={false}
            edgesReconnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            minZoom={0.1}
            maxZoom={4}
            aria-label={`${visualizationModes[mode].title}画布`}
            ariaLabelConfig={canvasLabels}
          >
            <Background gap={22} size={1} />
            <Controls showInteractive={false}>
              <CanvasZoomLabel />
              <ControlButton
                title="撤销上一次版面调整"
                aria-label="撤销版面"
                disabled={!writable || !history.length || Boolean(preview)}
                onClick={() => void step('undo')}
              >
                <Icon name="back" size={15} />
              </ControlButton>
              <ControlButton
                title="重做已撤销的版面调整"
                aria-label="重做版面"
                disabled={!writable || !future.length || Boolean(preview)}
                onClick={() => void step('redo')}
              >
                <span className="visualization-redo-icon">
                  <Icon name="back" size={15} />
                </span>
              </ControlButton>
            </Controls>
          </ReactFlow>
        )}
        {(unavailable || pending || failed) && (
          <div className="visualization-empty">
            <Icon name={visualizationModes[mode].icon} size={32} />
            <h3>
              {failed
                ? '暂时无法读取项目记录'
                : pending
                  ? '正在读取项目记录…'
                  : `暂无可展示的${visualizationModes[mode].label}数据`}
            </h3>
            <p>
              {failed
                ? '请重新读取。不会用其他目录数据代替当前范围。'
                : pending
                  ? '读取当前项目的有界同快照数据。'
                  : '专业事实、证据及图示数据接口尚未接入。可先查看独立虚构示例，审查图示与属性布局。'}
            </p>
            {!pending && (
              <button type="button" disabled={view.locked} onClick={() => setSample(true)}>
                查看虚构示例
              </button>
            )}
          </div>
        )}
        {!sample && mode === 'relations' && !isList && view.graph && (
          <details className="visualization-accessible-list">
            <summary>可访问记录列表 · {visibleRecords.length}</summary>
            {recordList('可访问项目记录')}
          </details>
        )}
        <div className="visualization-canvas-status">
          {nodes.length} 个节点 · {graph.edges.length} 条连线
          <span>
            {sample
              ? '虚构示例 · 不保存'
              : view.graph?.truncated
                ? '仅当前加载范围 · 已截断'
                : '仅视图表达可编辑 · 业务内容只读'}
          </span>
        </div>
      </div>
    </div>
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
