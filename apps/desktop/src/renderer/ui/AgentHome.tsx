import { WorkspaceDirectory, useFourColumnWorkspace } from './FourColumnWorkspace';
import { usePageNavigation } from '../shared/navigation/PageNavigation';
import { Group, Panel, Separator, type GroupImperativeHandle } from 'react-resizable-panels';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isConversationRun } from '../features/agent/agent-messages';
import { useProjectCatalog } from '../shared/data/ordinary-catalog-query';
import { Icon } from '../shared/ui/Icon';
import type { DraftEditorHandle, RichDraft } from '../editors/RichEditor';
import type { AgentRun, Task } from '../../preload/caselite-api';
import AgentPanel, { AgentRunReadOnly } from './AgentPanel';
import ActiveAgents from './ActiveAgents';
import { HomePreview, type HomePreviewEntry } from './HomePreview';

type Selection = { kind: 'live' | 'new' } | { kind: 'record'; id: string; scope: string };
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
  const shell = useFourColumnWorkspace();
  const inShell = Boolean(shell);
  const pageNavigation = usePageNavigation();
  const draft = useRef<DraftEditorHandle>(null);
  const content = useRef<HTMLDivElement>(null);
  const layout = useRef<GroupImperativeHandle | null>(null);
  const homeRoot = useRef<HTMLElement>(null);
  const previewWidth = useRef(320);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [groupWidth, setGroupWidth] = useState(0);
  useLayoutEffect(() => {
    if (!inShell || !homeRoot.current) return;
    const measure = () => setGroupWidth(homeRoot.current?.getBoundingClientRect().width ?? 0);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(homeRoot.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [inShell]);
  const directoryButton = useRef<HTMLButtonElement>(null);
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [compactDirectory, setCompactDirectory] = useState(false);
  const [preview, setPreview] = useState<HomePreviewEntry | null>(null);
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewRequest = useRef<{ entry: HomePreviewEntry; ticket: number } | null>(null);
  const previewTicket = useRef(0);
  const inspectorRef = useRef(pageNavigation?.inspector);
  useLayoutEffect(() => {
    inspectorRef.current = pageNavigation?.inspector;
  });
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
  const compact = width <= 850;
  const directoryVisible = shell ? shell.directoryOpen : compact ? compactDirectory : directoryOpen;
  const previewVisible =
    Boolean(preview) && (shell ? Boolean(pageNavigation?.inspector.open) : previewOpen);
  const selectedId = selection.kind === 'record' ? selection.id : '';
  const selectedScope = selection.kind === 'record' ? selection.scope : '';
  const previewSession = `${selection.kind}:${selectedScope}:${selectedId}`;
  const committedSession = useRef(previewSession);
  const closePreview = useCallback((restoreFocus = false) => {
    const current = previewRequest.current;
    previewRequest.current = null;
    previewTicket.current++;
    setPreview(null);
    setPreviewOpen(false);
    setPreviewMaximized(false);
    current?.entry.close(restoreFocus);
  }, []);
  const changeSelection = useCallback(
    (next: Selection) => {
      closePreview();
      setSelection(next);
    },
    [closePreview],
  );
  const beginPreview = useCallback((entry: HomePreviewEntry) => {
    if (entry.session !== committedSession.current) return -1;
    const previous = previewRequest.current;
    if (previous && previous.entry.owner !== entry.owner) previous.entry.close();
    const ticket = ++previewTicket.current;
    previewRequest.current = { entry, ticket };
    setPreview(null);
    return ticket;
  }, []);
  const showPreview = useCallback((entry: HomePreviewEntry, ticket: number) => {
    const current = previewRequest.current;
    if (
      entry.session !== committedSession.current ||
      current?.ticket !== ticket ||
      current.entry.owner !== entry.owner
    )
      return;
    setPreview(entry);
    setPreviewOpen(true);
    inspectorRef.current?.setOpen(true);
  }, []);
  const releasePreview = useCallback((owner: string) => {
    if (previewRequest.current?.entry.owner !== owner) return;
    previewRequest.current = null;
    previewTicket.current++;
    setPreview(null);
    setPreviewOpen(false);
    setPreviewMaximized(false);
  }, []);
  useLayoutEffect(() => {
    committedSession.current = previewSession;
    // 选择入口先关闭阅读意图；此处仅同步回执身份，离页不写下一页 inspector。
  }, [previewSession]);
  useLayoutEffect(() => {
    if (!preview && inspectorRef.current?.open) inspectorRef.current.setOpen(false);
  }, [preview, pageNavigation?.inspector.open]);
  const previewBridge = {
    target: previewTarget,
    session: previewSession,
    owner: preview?.owner ?? null,
    begin: beginPreview,
    show: showPreview,
    release: releasePreview,
  };

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
    if (inShell) {
      const available = groupWidth || Math.max(1, width - 108);
      const aux = !previewVisible
        ? 0
        : previewMaximized
          ? 100
          : Math.min(100, (previewWidth.current / available) * 100);
      layout.current?.setLayout({
        'home-directory': 0,
        'home-conversation': 100 - aux,
        'home-auxiliary': aux,
      });
      return;
    }
    const available = Math.max(
      1,
      width - 108 - 3 * (Number(directoryVisible) + Number(previewVisible)),
    );
    const dir = !inShell && !compact && directoryVisible ? (224 / available) * 100 : 0;
    const aux = !compact && previewVisible ? (244 / available) * 100 : 0;
    layout.current?.setLayout({
      'home-directory': dir,
      'home-conversation': 100 - dir - aux,
      'home-auxiliary': aux,
    });
  }, [compact, directoryVisible, width, inShell, previewVisible, groupWidth, previewMaximized]);
  useEffect(() => {
    if (!compact) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (compactDirectory) {
        setCompactDirectory(false);
        directoryButton.current?.focus();
      } else if (previewVisible) {
        closePreview(true);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [compact, compactDirectory, previewVisible, closePreview]);
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
  const onHomeViewState = useCallback(
    ({ runs }: { runs: AgentRun[] }) => {
      homeRunsRef.current = runs;
      setHomeRuns(runs);
      const current = selectionRef.current;
      if (current.kind === 'new' && runs.some((run) => !baselineRunIds.current.has(run.id))) {
        manualSelection.current = false;
        changeSelection({ kind: 'live' });
      } else if (
        !manualSelection.current &&
        current.kind === 'record' &&
        current.scope === 'home' &&
        runs.some((run) => run.id === current.id && run.status === 'running')
      ) {
        changeSelection({ kind: 'live' });
      }
    },
    [changeSelection],
  );
  const onActiveState = useCallback(
    (runs: AgentRun[] | null) => {
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
          if (current.kind !== 'live') changeSelection({ kind: 'live' });
        } else if (
          current.kind !== 'record' ||
          current.id !== active.id ||
          current.scope !== active.scope
        ) {
          setSelectedRun(null);
          setSelectedError('');
          changeSelection({ kind: 'record', id: active.id, scope: active.scope });
        }
      }
    },
    [changeSelection],
  );
  const selectRun = useCallback(
    (run: AgentRun) => {
      manualSelection.current = true;
      setSelectedRun(null);
      setSelectedError('');
      changeSelection({ kind: 'record', id: run.id, scope: run.scope });
      setSelectedRetry((attempt) => attempt + 1);
      if (compact) setCompactDirectory(false);
    },
    [compact, changeSelection],
  );
  const newConversation = () => {
    manualSelection.current = true;
    baselineRunIds.current = new Set(homeRunsRef.current.map((run) => run.id));
    changeSelection({ kind: 'new' });
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
  const rightControl = preview ? (
    <div className="home-topbar-actions">
      <button
        type="button"
        aria-label={previewVisible ? '收起预览' : '展开预览'}
        aria-expanded={previewVisible}
        onClick={() => setPreviewOpen((open) => !open)}
      >
        <Icon name={previewVisible ? 'panel-right-close' : 'panel-right-open'} size={16} />
      </button>
    </div>
  ) : null;
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
      ref={homeRoot}
      className={`home-view agent-home home-v3${hasConversation ? ' home-conversation' : ''}`}
      data-layout="home-agent"
      aria-label="Agent 首页"
      data-compact={compact}
    >
      {!shell &&
        (leftSlot ? (
          createPortal(leftControl, leftSlot)
        ) : (
          <div className="home-control-fallback">{leftControl}</div>
        ))}
      {!shell &&
        (rightSlot ? (
          createPortal(rightControl, rightSlot)
        ) : (
          <div className="home-control-fallback">{rightControl}</div>
        ))}
      <div className="home-conversation-workspace">
        <div
          className="home-run-status"
          aria-label="对话运行状态"
          hidden={activeRuns !== null && activeRuns.length === 0}
          inert={activeRuns !== null && activeRuns.length === 0}
        >
          <ActiveAgents
            tasks={tasks}
            onOpen={onOpen}
            onStateChange={onActiveState}
            onSelectRun={selectRun}
          />
        </div>
        <Group
          className="home-v3-group"
          groupRef={layout}
          orientation="horizontal"
          disabled={compact && !shell}
          onLayoutChanged={(sizes, meta) => {
            if (!meta.isUserInteraction) return;
            if (inShell) {
              const percentage = sizes['home-auxiliary'] ?? 0;
              if (percentage > 0.1)
                previewWidth.current =
                  (percentage / 100) * (groupWidth || Math.max(1, width - 108));
              else pageNavigation?.inspector.setOpen(false);
              setPreviewMaximized(false);
              return;
            }
            if (compact) return;
            if (directoryVisible && (sizes['home-directory'] ?? 0) < 0.1) setDirectoryOpen(false);
            if (previewVisible && (sizes['home-auxiliary'] ?? 0) < 0.1) setPreviewOpen(false);
          }}
        >
          <Panel
            id="home-directory"
            defaultSize="224px"
            minSize={!shell && !compact && directoryVisible ? '170px' : '0%'}
            maxSize={!shell && !compact && directoryVisible ? '33%' : '0%'}
            collapsible
            collapsedSize="0%"
            style={{ overflow: compact ? 'visible' : 'hidden' }}
          >
            <WorkspaceDirectory>
              <aside
                id="home-agent-directory"
                className="home-v3-directory"
                aria-label="Agent 目录"
                data-overlay={compact && !shell}
                hidden={!directoryVisible}
                inert={!directoryVisible}
              >
                <h2>首页</h2>
                <button type="button" className="home-new-conversation" onClick={newConversation}>
                  <Icon name="plus" size={16} /> 新对话
                </button>
                <label className="home-directory-search">
                  <Icon name="search" size={15} />
                  <input
                    data-directory-search
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
            </WorkspaceDirectory>
          </Panel>
          <Separator
            className="home-v3-separator"
            aria-label="调整 Agent 目录宽度"
            hidden={Boolean(shell) || !directoryVisible || compact}
          />
          <Panel id="home-conversation" minSize={shell ? '0%' : compact ? '100%' : '260px'}>
            <div className="agent-main home-v3-main" ref={content}>
              <div className="agent-start">
                {selection.kind !== 'record' && !hasConversation && (
                  <div className="home-v3-welcome">
                    <h1>今天，想推进哪项工作？</h1>
                    <p>给我一个目标，我们一起把工作做下去。</p>
                  </div>
                )}
                <HomePreview.Provider value={{ ...previewBridge, enabled: liveVisible }}>
                  <div className="home-live-panel" hidden={!liveVisible} inert={!liveVisible}>
                    <AgentPanel
                      scope="home"
                      defaultDocxFull
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
                </HomePreview.Provider>
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
                      <HomePreview.Provider value={{ ...previewBridge, enabled: true }}>
                        <AgentRunReadOnly
                          key={`${selectedRun.scope}:${selectedRun.id}`}
                          run={selectedRun}
                        />
                      </HomePreview.Provider>
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
            aria-label="调整辅助面板宽度"
            hidden={!previewVisible || (compact && !shell)}
          />
          <Panel
            id="home-auxiliary"
            defaultSize="0%"
            minSize="0%"
            maxSize={previewVisible ? '100%' : '0%'}
            collapsible
            collapsedSize="0%"
            style={{ overflow: compact ? 'visible' : 'hidden' }}
          >
            <aside
              className="home-v3-auxiliary"
              data-overlay={compact && !shell}
              hidden={!previewVisible}
              inert={!previewVisible}
              aria-label="首页预览"
            >
              {preview && (
                <header className="home-preview-heading">
                  <h2>{preview.title}</h2>
                  <button
                    type="button"
                    aria-label={previewMaximized ? '还原预览' : '最大化预览'}
                    onClick={() => setPreviewMaximized((value) => !value)}
                  >
                    <Icon name="expand" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="收起预览"
                    onClick={() => {
                      setPreviewOpen(false);
                      pageNavigation?.inspector.setOpen(false);
                    }}
                  >
                    <Icon name="panel-right-close" size={16} />
                  </button>
                  <button type="button" aria-label="关闭预览" onClick={() => closePreview(true)}>
                    ×
                  </button>
                </header>
              )}
              <div className="home-preview-content" ref={setPreviewTarget} />
            </aside>
          </Panel>
        </Group>
      </div>
    </section>
  );
}
