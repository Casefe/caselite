import { Group, Panel, Separator, type GroupImperativeHandle } from 'react-resizable-panels';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ImportantSchedules from '../features/calendar/ImportantSchedules';
import { isConversationRun } from '../features/agent/agent-messages';
import { useProjectCatalog } from '../shared/data/ordinary-catalog-query';
import { Icon } from '../shared/ui/Icon';
import type { DraftEditorHandle, RichDraft } from '../editors/RichEditor';
import type { AgentRun, Task } from '../../preload/caselite-api';
import AgentPanel, { AgentRunReadOnly } from './AgentPanel';
import ActiveAgents from './ActiveAgents';
import { useMaterials } from './useMaterials';

type Selection = { kind: 'live' | 'new' } | { kind: 'record'; id: string; scope: string };
type Auxiliary = 'materials' | 'results' | 'calendar' | 'details' | null;
const starters = [
  {
    title: '合同审查',
    text: '请根据我的要求协助审查合同，梳理关注条款、风险及待核实事项。\n具体要求：',
    icon: 'list',
  },
  {
    title: '创建任务',
    text: '请根据我的要求拟定任务名称、工作目标和需要完成的步骤。\n具体要求：',
    icon: 'check',
  },
  {
    title: '创建项目',
    text: '请根据我的要求拟定项目名称、目标及初步工作安排。\n具体要求：',
    icon: 'folder',
  },
  {
    title: '生成文书',
    text: '请根据我的要求拟定法律文书草稿，并标明待核实信息。\n具体要求：',
    icon: 'file',
  },
  {
    title: '法律研究',
    text: '请根据我的要求梳理法律问题，列出需要核验的依据和不确定事项。\n具体要求：',
    icon: 'search',
  },
];

export default function AgentHome({
  prompt,
  onPrompt,
  onNavigate,
  tasks,
  onOpen,
  onOpenProject,
  leftSlot,
  rightSlot,
}: {
  prompt: RichDraft;
  onPrompt(value: RichDraft): void;
  onNavigate(view: 'tasks' | 'projects' | 'agent-history' | 'calendar'): void;
  tasks: Task[];
  onOpen(id: string): void;
  onOpenProject?(id: string): void;
  leftSlot?: HTMLElement | null;
  rightSlot?: HTMLElement | null;
}) {
  const draft = useRef<DraftEditorHandle>(null);
  const content = useRef<HTMLDivElement>(null);
  const layout = useRef<GroupImperativeHandle | null>(null);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const runButton = useRef<HTMLButtonElement>(null);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [runOpen, setRunOpen] = useState(true);
  const [compactDirectory, setCompactDirectory] = useState(false);
  const [compactRun, setCompactRun] = useState(false);
  const [auxiliary, setAuxiliary] = useState<Auxiliary>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [history, setHistory] = useState<AgentRun[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [selection, setSelection] = useState<Selection>({ kind: 'live' });
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [selectedError, setSelectedError] = useState('');
  const [selectedRetry, setSelectedRetry] = useState(0);
  const [activeRuns, setActiveRuns] = useState<AgentRun[] | null>(null);
  const [homeRuns, setHomeRuns] = useState<AgentRun[]>([]);
  const [conversation, setConversation] = useState(false);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);
  const historyVersion = useRef(0);
  const manualSelection = useRef(false);
  const selectionRef = useRef(selection);
  const homeRunsRef = useRef(homeRuns);
  const activeRunsRef = useRef<AgentRun[] | null>(null);
  const baselineRunIds = useRef(new Set<string>());
  // 轮询只读取已提交的选择和运行投影，不在渲染中改写回执所依赖的引用。
  useLayoutEffect(() => {
    selectionRef.current = selection;
    homeRunsRef.current = homeRuns;
  }, [selection, homeRuns]);
  const projectCatalog = useProjectCatalog();
  const materials = useMaterials('home');
  const compact = width <= 850;
  const wide = width >= 1440;
  const directoryVisible = compact ? compactDirectory : directoryOpen;
  const runningVisible = compact ? compactRun && !auxiliary : runOpen && (!auxiliary || wide);
  const selectedId = selection.kind === 'record' ? selection.id : '';
  const selectedScope = selection.kind === 'record' ? selection.scope : '';

  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    if (selection.kind === 'new') {
      content.current?.querySelector<HTMLTextAreaElement>('[data-testid="agent-input"]')?.focus();
    }
  }, [selection]);
  useLayoutEffect(() => {
    // 收缩只调整现有 Panel 的尺寸，AgentPanel 及材料草稿始终留在原 React 子树。
    // Panel 初始值显式用 px；setLayout 的公开接口则接收百分比。
    const available = Math.max(
      1,
      width -
        108 -
        3 * (Number(directoryVisible) + Number(runningVisible) + Number(Boolean(auxiliary))),
    );
    const dir = !compact && directoryVisible ? (224 / available) * 100 : 0;
    const run = !compact && runningVisible ? (244 / available) * 100 : 0;
    const aux = !compact && auxiliary ? (244 / available) * 100 : 0;
    layout.current?.setLayout({
      'home-directory': dir,
      'home-conversation': 100 - dir - run - aux,
      'home-running': run,
      'home-auxiliary': aux,
    });
  }, [auxiliary, compact, directoryVisible, runningVisible, width]);
  useEffect(() => {
    if (!compact) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (compactDirectory) {
        setCompactDirectory(false);
        directoryButton.current?.focus();
      } else if (auxiliary) {
        setAuxiliary(null);
      } else if (compactRun) {
        setCompactRun(false);
        runButton.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [auxiliary, compact, compactDirectory, compactRun]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const version = historyVersion.current;
      try {
        const result = await window.caselite.agent({ protocol_version: 1, operation: 'history' });
        if (stopped) return;
        if (version !== historyVersion.current) {
          timer = setTimeout(() => void read(), 2000);
          return;
        }
        if (result.ok) {
          setHistory(result.runs.filter(isConversationRun));
          setHistoryError('');
        } else {
          setHistory(null);
          setHistoryError(result.message);
        }
      } catch {
        if (!stopped) {
          setHistory(null);
          setHistoryError('历史对话读取失败，请稍后重试。');
        }
      }
      if (!stopped) timer = setTimeout(() => void read(), 2000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!selectedId || !selectedScope) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await window.caselite.agent({
          protocol_version: 1,
          operation: 'read',
          scope: selectedScope,
        });
        if (stopped) return;
        const run = result.ok
          ? result.runs.find((item) => item.id === selectedId && item.scope === selectedScope)
          : undefined;
        if (!result.ok || !run) {
          setSelectedRun(null);
          setSelectedError(result.ok ? '原运行暂不可读取。' : result.message);
          return;
        }
        setSelectedRun(run);
        setSelectedError('');
        if (run.status === 'running') timer = setTimeout(() => void read(), 500);
      } catch {
        if (!stopped) {
          setSelectedRun(null);
          setSelectedError('运行状态暂不可读取，请重新核对。');
        }
      }
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [selectedId, selectedScope, selectedRetry]);
  const onHomeViewState = useCallback(({ runs }: { runs: AgentRun[] }) => {
    homeRunsRef.current = runs;
    setHomeRuns(runs);
    const current = selectionRef.current;
    if (current.kind === 'new' && runs.some((run) => !baselineRunIds.current.has(run.id))) {
      manualSelection.current = false;
      setSelection({ kind: 'live' });
    } else if (
      !manualSelection.current &&
      current.kind === 'record' &&
      current.scope === 'home' &&
      runs.some((run) => run.id === current.id && run.status === 'running')
    ) {
      setSelection({ kind: 'live' });
    }
  }, []);
  const onActiveState = useCallback((runs: AgentRun[] | null) => {
    const previous = activeRunsRef.current;
    activeRunsRef.current = runs;
    setActiveRuns(runs);
    const current = selectionRef.current;
    if (current.kind === 'record') {
      const wasActive = previous?.some(
        (run) => run.id === current.id && run.scope === current.scope,
      );
      const remainsActive = runs?.some(
        (run) => run.id === current.id && run.scope === current.scope,
      );
      if (wasActive && !remainsActive) {
        // active 列表消失或不可读都不是终态证明；清掉旧 running，按原 scope/ID 重新核对。
        setSelectedRun(null);
        setSelectedError('');
        setSelectedRetry((attempt) => attempt + 1);
      }
    }
    if (!manualSelection.current && runs?.[0]) {
      const active = runs[0];
      if (active.scope === 'home' && homeRunsRef.current.some((run) => run.id === active.id)) {
        if (current.kind !== 'live') setSelection({ kind: 'live' });
      } else if (
        current.kind !== 'record' ||
        current.id !== active.id ||
        current.scope !== active.scope
      ) {
        setSelectedRun(null);
        setSelectedError('');
        setSelection({ kind: 'record', id: active.id, scope: active.scope });
      }
    }
  }, []);
  const selectRun = useCallback(
    (run: AgentRun) => {
      manualSelection.current = true;
      setSelectedRun(null);
      setSelectedError('');
      setSelection({ kind: 'record', id: run.id, scope: run.scope });
      setSelectedRetry((attempt) => attempt + 1);
      if (compact) setCompactDirectory(false);
    },
    [compact],
  );
  const newConversation = () => {
    manualSelection.current = true;
    baselineRunIds.current = new Set(homeRunsRef.current.map((run) => run.id));
    setSelection({ kind: 'new' });
    setSelectedRun(null);
    setSelectedError('');
    if (compact) setCompactDirectory(false);
  };
  const changePin = async (run: AgentRun) => {
    historyVersion.current++;
    setPinBusy(true);
    try {
      const result = await window.caselite.agent({
        protocol_version: 1,
        operation: 'pin_history',
        run_id: run.id,
        pinned: !run.pinned,
      });
      if (result.ok) {
        setHistory(result.runs.filter(isConversationRun));
        setHistoryError('');
      } else setHistoryError(result.message);
    } catch {
      setHistoryError('置顶状态保存失败，请重试。');
    } finally {
      historyVersion.current++;
      setPinBusy(false);
    }
  };
  const toggleDirectory = () =>
    compact ? setCompactDirectory((open) => !open) : setDirectoryOpen((open) => !open);
  const toggleRunning = () => {
    if (auxiliary && !wide) {
      setAuxiliary(null);
      if (compact) setCompactRun(true);
      else setRunOpen(true);
    } else if (compact) setCompactRun((open) => !open);
    else setRunOpen((open) => !open);
  };
  const leftControl = (
    <button
      ref={directoryButton}
      type="button"
      className="home-directory-toggle"
      aria-controls="home-agent-directory"
      aria-expanded={directoryVisible}
      aria-label={directoryVisible ? '收起 Agent 目录' : '展开 Agent 目录'}
      onClick={toggleDirectory}
    >
      <Icon name="panel" size={16} /> Agent 目录
    </button>
  );
  const rightControl = (
    <div className="home-topbar-actions">
      {auxiliary && (
        <button type="button" aria-label="收起辅助面板" onClick={() => setAuxiliary(null)}>
          ×
        </button>
      )}
      <button
        ref={runButton}
        type="button"
        aria-controls="home-active-runs"
        aria-expanded={runningVisible}
        aria-label={runningVisible ? '收起进行中的智能体' : '展开进行中的智能体'}
        onClick={toggleRunning}
      >
        <Icon name={runningVisible ? 'panel-right-close' : 'panel-right-open'} size={16} />
      </button>
    </div>
  );
  const shownRun =
    selection.kind === 'record'
      ? selectedRun
      : selection.kind === 'live'
        ? (homeRuns.filter(isConversationRun).at(-1) ?? null)
        : null;
  const currentAttachments =
    selection.kind === 'record' ? (selectedRun?.attachments ?? []) : (shownRun?.attachments ?? []);
  const selectedIds = new Set(Object.keys(materials.selected));
  const draftFiles = materials.items.filter((item) => selectedIds.has(item.id));
  const filtered = (history ?? []).filter((run) =>
    run.prompt.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const projectRows = (projectCatalog.data?.projects ?? []).filter(
    (project) => !project.archived_at,
  );
  // freshHomeSession 不展示旧首页 Run；同 scope 的旧运行也必须阻止新发起。
  const otherActive =
    activeRuns?.some(
      (run) =>
        run.scope !== 'home' ||
        !homeRuns.some((owned) => owned.id === run.id && owned.status === 'running'),
    ) ?? false;
  const homeRunStateUnverified = homeRuns.some(
    (run) =>
      run.status === 'running' &&
      !activeRuns?.some((active) => active.id === run.id && active.scope === 'home'),
  );
  const liveVisible = selection.kind !== 'record';
  const hasConversation =
    selection.kind === 'record' || (selection.kind === 'live' && conversation);
  const runRows = (rows: AgentRun[]) =>
    rows.map((run) => (
      <div className="home-directory-record" key={run.id}>
        <div className="home-directory-run">
          <button
            type="button"
            className="home-directory-entry home-history-open"
            aria-current={
              selection.kind === 'record' && selection.id === run.id ? 'true' : undefined
            }
            onClick={() => selectRun(run)}
          >
            <Icon name="clock" size={14} />
            <span>{run.prompt}</span>
          </button>
          <button
            type="button"
            className="home-directory-pin home-history-pin"
            disabled={pinBusy}
            aria-label={`${run.pinned ? '取消置顶' : '置顶'}：${run.prompt}`}
            aria-pressed={Boolean(run.pinned)}
            onClick={() => void changePin(run)}
          >
            {run.pinned ? '已置顶' : '置顶'}
          </button>
        </div>
        {run.status !== 'running' && (
          <p
            className={`assistant-run-status ${run.status}`}
            role="status"
            data-run-id={run.id}
            data-run-scope={run.scope}
          >
            {run.message ||
              {
                succeeded: '已完成，内容待人工核对。',
                cancelled: '运行已停止。',
                failed: '运行失败，请查看记录。',
                interrupted: '上次运行被中断',
              }[run.status]}
          </p>
        )}
      </div>
    ));
  return (
    <section
      className={`home-view agent-home home-v3${hasConversation ? ' home-conversation' : ''}`}
      data-layout="home-agent"
      aria-label="Agent 首页"
      data-compact={compact}
    >
      {leftSlot ? (
        createPortal(leftControl, leftSlot)
      ) : (
        <div className="home-control-fallback">{leftControl}</div>
      )}
      {rightSlot ? (
        createPortal(rightControl, rightSlot)
      ) : (
        <div className="home-control-fallback">{rightControl}</div>
      )}
      <Group
        className="home-v3-group"
        groupRef={layout}
        orientation="horizontal"
        disabled={compact}
        onLayoutChanged={(sizes, meta) => {
          if (!meta.isUserInteraction || compact) return;
          if (directoryVisible && (sizes['home-directory'] ?? 0) < 0.1) setDirectoryOpen(false);
          if (runningVisible && (sizes['home-running'] ?? 0) < 0.1) setRunOpen(false);
          if (auxiliary && (sizes['home-auxiliary'] ?? 0) < 0.1) setAuxiliary(null);
        }}
      >
        <Panel
          id="home-directory"
          defaultSize="224px"
          minSize={!compact && directoryVisible ? '170px' : '0%'}
          maxSize={!compact && directoryVisible ? '40%' : '0%'}
          collapsible
          collapsedSize="0%"
          style={{ overflow: compact ? 'visible' : 'hidden' }}
        >
          <aside
            id="home-agent-directory"
            className="home-v3-directory"
            aria-label="Agent 目录"
            data-overlay={compact}
            hidden={!directoryVisible}
            inert={!directoryVisible}
          >
            <h2>Agent</h2>
            <button type="button" className="home-new-conversation" onClick={newConversation}>
              <Icon name="plus" size={16} /> 新对话
            </button>
            <label className="home-directory-search">
              <Icon name="search" size={15} />
              <input
                aria-label="查找对话"
                placeholder="查找对话"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="home-directory-section">
              <h3>置顶</h3>
              {runRows(filtered.filter((run) => run.pinned))}
            </div>
            <div className="home-directory-section">
              <h3>
                <button
                  type="button"
                  aria-expanded={projectsOpen}
                  onClick={() => setProjectsOpen((open) => !open)}
                >
                  项目 <Icon name="chevron" size={13} />
                </button>
              </h3>
              {projectsOpen && (
                <>
                  {projectCatalog.error ? (
                    <p role="alert">
                      项目读取失败：{projectCatalog.error}{' '}
                      <button
                        type="button"
                        onClick={() => void projectCatalog.load().catch(() => {})}
                      >
                        重试
                      </button>
                    </p>
                  ) : !projectCatalog.data ? (
                    <p role="status">正在读取项目…</p>
                  ) : projectRows.length ? (
                    projectRows.map((project) => (
                      <button
                        type="button"
                        className="home-directory-entry"
                        key={project.id}
                        onClick={() => onOpenProject?.(project.id)}
                      >
                        <Icon name="folder" size={14} />
                        <span>{project.title}</span>
                      </button>
                    ))
                  ) : (
                    <p>暂无项目</p>
                  )}
                  <button
                    type="button"
                    className="home-all-link"
                    onClick={() => onNavigate('projects')}
                  >
                    全部项目
                  </button>
                </>
              )}
            </div>
            <div className="home-directory-section">
              <h3>最近对话</h3>
              {historyError ? (
                <p role="alert">{historyError}</p>
              ) : history === null ? (
                <p role="status">正在读取历史对话…</p>
              ) : filtered.length ? (
                runRows(filtered.filter((run) => !run.pinned))
              ) : (
                <p>暂无对话</p>
              )}
            </div>
            <button
              type="button"
              className="home-all-history"
              onClick={() => onNavigate('agent-history')}
            >
              <Icon name="clock" size={14} /> 全部历史对话
            </button>
          </aside>
        </Panel>
        <Separator
          className="home-v3-separator"
          aria-label="调整 Agent 目录宽度"
          hidden={!directoryVisible || compact}
        />
        <Panel id="home-conversation" minSize={compact ? '100%' : '260px'}>
          <div className="agent-main home-v3-main" ref={content}>
            <div className="agent-start">
              {selection.kind !== 'record' && !hasConversation && (
                <div className="home-v3-welcome">
                  <h1>今天，想推进哪项工作？</h1>
                  <p>给我一个目标，我们一起把工作做下去。</p>
                </div>
              )}
              <div className="home-live-panel" hidden={!liveVisible} inert={!liveVisible}>
                <AgentPanel
                  scope="home"
                  freshHomeSession
                  draft={prompt}
                  onDraft={onPrompt}
                  editorRef={draft}
                  onConversationChange={setConversation}
                  hideMessages={selection.kind === 'new'}
                  otherRunActive={otherActive}
                  otherRunStatusUnknown={activeRuns === null}
                  homeRunStateUnverified={homeRunStateUnverified}
                  onHomeViewState={onHomeViewState}
                />
              </div>
              {selection.kind === 'record' && (
                <div className="home-record-panel home-history-detail">
                  {selectedError ? (
                    <p role="alert">
                      {selectedError}{' '}
                      <button type="button" onClick={() => setSelectedRetry((n) => n + 1)}>
                        重试
                      </button>
                    </p>
                  ) : !selectedRun ? (
                    <p role="status">正在核对运行状态…</p>
                  ) : selectedRun.purpose === 'important_dates' ? (
                    <p>
                      重要日期识别：{selectedRun.message || '正在处理'}
                      。请到所属任务查看候选与来源。
                    </p>
                  ) : (
                    <AgentRunReadOnly
                      key={`${selectedRun.scope}:${selectedRun.id}`}
                      run={selectedRun}
                    />
                  )}
                </div>
              )}
              {selection.kind !== 'record' && !hasConversation && (
                <div className="agent-starters">
                  {starters.map((item) => (
                    <button
                      type="button"
                      key={item.title}
                      aria-pressed={selectedStarter === item.title}
                      disabled={
                        Boolean(prompt.text.trim()) &&
                        prompt.text.length + item.text.length + 1 > 4000
                      }
                      onClick={() => {
                        draft.current?.append(item.text);
                        setSelectedStarter(item.title);
                      }}
                    >
                      <Icon name={item.icon} size={16} />
                      {item.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>
        <Separator
          className="home-v3-separator"
          aria-label="调整运行栏宽度"
          hidden={!runningVisible || compact}
        />
        <Panel
          id="home-running"
          defaultSize="244px"
          minSize={!compact && runningVisible ? '180px' : '0%'}
          maxSize={!compact && runningVisible ? '40%' : '0%'}
          collapsible
          collapsedSize="0%"
          style={{ overflow: compact ? 'visible' : 'hidden' }}
        >
          <aside
            id="home-active-runs"
            className="home-v3-running"
            data-overlay={compact}
            hidden={!runningVisible}
            inert={!runningVisible}
          >
            <ActiveAgents
              tasks={tasks}
              onOpen={onOpen}
              onStateChange={onActiveState}
              onSelectRun={selectRun}
            />
          </aside>
        </Panel>
        <Separator
          className="home-v3-separator"
          aria-label="调整辅助面板宽度"
          hidden={!auxiliary || compact}
        />
        <Panel
          id="home-auxiliary"
          defaultSize="0%"
          minSize={!compact && auxiliary ? '180px' : '0%'}
          maxSize={!compact && auxiliary ? '40%' : '0%'}
          collapsible
          collapsedSize="0%"
          style={{ overflow: compact ? 'visible' : 'hidden' }}
        >
          <aside
            className="home-v3-auxiliary"
            data-overlay={compact}
            hidden={!auxiliary}
            inert={!auxiliary}
            aria-label="首页辅助面板"
          >
            <section hidden={auxiliary !== 'materials'}>
              <h2>本轮材料</h2>
              {selection.kind === 'record' ? (
                !shownRun ? (
                  <p>当前运行材料暂不可核对。</p>
                ) : currentAttachments.length ? (
                  currentAttachments.map((item) => (
                    <p key={item.source_id} data-home-material-source={item.source_id}>
                      {item.name}
                    </p>
                  ))
                ) : (
                  <p>本轮未添加材料</p>
                )
              ) : !materials.available ? (
                <p>当前材料入口不可用，暂无法核对。</p>
              ) : materials.readError ? (
                <p role="alert">材料列表暂不可核对：{materials.readError}</p>
              ) : !materials.loaded ? (
                <p role="status">正在读取本轮材料…</p>
              ) : (draftFiles.length || materials.staged) && shownRun?.status !== 'running' ? (
                <>
                  {draftFiles.map((item) => (
                    <p key={item.id} data-home-material-source={item.id}>
                      {item.name}
                    </p>
                  ))}
                  {materials.staged && (
                    <p
                      data-home-material-source={
                        materials.staged.restore_source_id ?? materials.staged.token
                      }
                    >
                      {materials.staged.name} · 正在处理
                    </p>
                  )}
                </>
              ) : currentAttachments.length ? (
                currentAttachments.map((item) => (
                  <p key={item.source_id} data-home-material-source={item.source_id}>
                    {item.name}
                  </p>
                ))
              ) : (
                <p>本轮未添加材料</p>
              )}
              {selection.kind !== 'record' && materials.error && (
                <p role="alert">{materials.error}</p>
              )}
            </section>
            <section hidden={auxiliary !== 'results'}>
              <h2>成果</h2>
              <p>当前没有可确认的已保存成果。</p>
            </section>
            <section hidden={auxiliary !== 'calendar'}>
              <ImportantSchedules home onOpen={onOpen} onCalendar={() => onNavigate('calendar')} />
            </section>
            <section hidden={auxiliary !== 'details'}>
              <h2>对话信息</h2>
              {shownRun ? (
                <dl>
                  <dt>工作范围</dt>
                  <dd>{shownRun.scope === 'home' ? '首页对话' : shownRun.scope}</dd>
                  <dt>模型</dt>
                  <dd>{shownRun.model}</dd>
                  <dt>状态</dt>
                  <dd>
                    {selection.kind === 'live' &&
                    shownRun.status === 'running' &&
                    homeRunStateUnverified
                      ? '运行状态待核对'
                      : shownRun.message || shownRun.status}
                  </dd>
                </dl>
              ) : (
                <p>{selection.kind === 'record' ? '当前记录状态待核对。' : '当前为新对话。'}</p>
              )}
            </section>
          </aside>
        </Panel>
      </Group>
      <aside className="home-v3-rail" aria-label="辅助栏">
        {(
          [
            { id: 'materials', icon: 'paperclip', label: '本轮材料' },
            { id: 'results', icon: 'file', label: '成果' },
            { id: 'calendar', icon: 'calendar', label: '重要日程' },
            { id: 'details', icon: 'list', label: '对话信息' },
          ] as const
        ).map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={`${auxiliary === item.id ? '收起' : '展开'}${item.label}`}
            title={item.label}
            aria-expanded={auxiliary === item.id}
            onClick={() => {
              setAuxiliary((old) => (old === item.id ? null : item.id));
              if (compact) setCompactRun(false);
            }}
          >
            <Icon name={item.icon} size={17} />
          </button>
        ))}
      </aside>
    </section>
  );
}
