import { Icon } from '../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import { type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';
import type { AgentRun, Task } from '../../preload/caselite-api';

import AgentPanel from './AgentPanel';
import BrandLogo from './BrandLogo';
import { useCatalog } from './useCatalog';

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
}: {
  prompt: RichDraft;
  onPrompt(value: RichDraft): void;
  onNavigate(view: 'tasks' | 'projects' | 'agent-history'): void;
  tasks: Task[];
  onOpen(id: string): void;
}) {
  const draft = useRef<DraftEditorHandle>(null);
  const [showNotice, setShowNotice] = useState(true);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);
  const catalog = useCatalog();
  const projects = catalog.data?.projects.filter((project) => !project.archived_at) ?? [];
  const [history, setHistory] = useState<AgentRun[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [overview, setOverview] = useState(false);
  const historyVersion = useRef(0);
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
          setHistory(result.runs);
          setHistoryError('');
        } else setHistoryError(result.message);
      } catch {
        if (!stopped) setHistoryError('历史对话读取失败，请稍后重试。');
      }
      if (!stopped) timer = setTimeout(() => void read(), 2000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
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
        setHistory(result.runs);
        setHistoryError('');
      } else setHistoryError(result.message);
    } catch {
      setHistoryError('置顶状态保存失败，请重试。');
    } finally {
      historyVersion.current++;
      setPinBusy(false);
    }
  };
  return (
    <section
      className={`home-view agent-home${conversation && !overview ? ' home-conversation' : ''}`}
      data-layout="three-column"
      aria-label="Agent 首页"
    >
      <div className="agent-main">
        {conversation && (
          <header className="home-conversation-toolbar">
            <span>
              <BrandLogo /> AI 工作对话
            </span>
            <button aria-expanded={overview} onClick={() => setOverview(!overview)}>
              {overview ? '返回对话' : '工作概览与快捷项'}
            </button>
          </header>
        )}
        <div className="agent-start">
          <div className="agent-welcome">
            <BrandLogo />
            <h1>早上好，谭律师！</h1>
          </div>
          <AgentPanel
            scope="home"
            draft={prompt}
            onDraft={onPrompt}
            editorRef={draft}
            onConversationChange={setConversation}
          />
          <div className="agent-starters" style={{ justifyContent: 'center' }}>
            {starters.map((item) => (
              <button
                key={item.title}
                aria-pressed={selectedStarter === item.title}
                style={{
                  borderRadius: '999px',
                  ...(selectedStarter === item.title
                    ? { background: 'var(--ink)', color: 'var(--theme-panel, white)' }
                    : {}),
                }}
                disabled={
                  Boolean(prompt.text.trim()) && prompt.text.length + item.text.length + 1 > 4000
                }
                title={prompt.text.trim() ? '追加到工作目标（最多4000字符）' : '填写工作目标'}
                onClick={() => {
                  draft.current?.append(item.text);
                  setSelectedStarter(item.title);
                }}
              >
                <Icon name={item.icon} size={16} />
                <span>{item.title}</span>
              </button>
            ))}
          </div>
          {showNotice && (
            <div className="home-notice">
              <div>
                <strong>CaseLite App</strong>
                <p>在一个本地工作区中整理任务、项目与文档。</p>
              </div>
              <button aria-label="关闭提示" onClick={() => setShowNotice(false)}>
                ×
              </button>
            </div>
          )}
        </div>
        <section className="home-task-feed home-history" aria-label="历史对话">
          <header>
            <h2>
              <button className="home-section-link" onClick={() => onNavigate('agent-history')}>
                历史对话
              </button>
            </h2>
            <span>最近五轮 · 最多置顶三轮</span>
          </header>
          {historyError && (
            <p role="alert" className="home-task-empty">
              {historyError}
            </p>
          )}
          {!history && !historyError && <p className="home-task-empty">正在读取历史对话…</p>}
          {history && !history.length && (
            <p className="home-task-empty">还没有 AI 对话，开始提问后会显示在这里。</p>
          )}
          {history?.map((run) => (
            <article key={run.id} className="home-history-item">
              <div className="home-history-row">
                <button
                  className="home-history-open"
                  aria-expanded={expandedRun === run.id}
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                >
                  <Icon name="clock" size={16} />
                  <span>
                    <strong>{run.prompt}</strong>
                    <small>
                      {run.scope === 'home'
                        ? '首页对话'
                        : `任务对话 · ${tasks.find((task) => task.id === run.scope)?.title ?? '任务'}`}
                      {run.created_at
                        ? ` · ${new Date(run.created_at).toLocaleString('zh-CN')}`
                        : ''}
                    </small>
                  </span>
                </button>
                <button
                  className="home-history-pin"
                  disabled={pinBusy}
                  aria-label={`${run.pinned ? '取消置顶' : '置顶'}：${run.prompt}`}
                  aria-pressed={Boolean(run.pinned)}
                  onClick={() => void changePin(run)}
                >
                  {run.pinned ? '已置顶' : '置顶'}
                </button>
              </div>
              {expandedRun === run.id && (
                <div className="home-history-detail">
                  <p>{run.prompt}</p>
                  <p>{run.output || run.message || '等待模型响应…'}</p>
                  {run.scope !== 'home' && (
                    <button onClick={() => onOpen(run.scope)}>打开所属任务</button>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
        <div className="agent-local">
          <i className="local-dot" />
          本地工作区 <span>无需登录即可开始</span>
        </div>
      </div>
      <aside
        className="agent-context"
        aria-label="Agent 工作上下文"
        style={{
          borderLeft: 0,
          borderTop: 0,
          background: 'var(--theme-panel, white)',
          paddingTop: 18,
        }}
      >
        <div className="home-context-panel">
          <section className="home-reminder-card">
            <h3>
              <Icon name="clock" size={16} /> 重要日期
            </h3>
            <p>日期提醒尚未接入，暂不能显示未来事项。</p>
          </section>
          <section className="home-reminder-card home-recent-card" aria-label="最近任务">
            <h3>
              <Icon name="check" size={16} />
              <button className="home-section-link" onClick={() => onNavigate('tasks')}>
                最近任务
              </button>
              <span className="home-recent-count">{tasks.length}</span>
            </h3>
            {tasks.length ? (
              tasks.slice(0, 5).map((task) => (
                <button className="home-recent-row" key={task.id} onClick={() => onOpen(task.id)}>
                  <span>{task.title}</span>
                  <Icon name="chevron" size={13} />
                </button>
              ))
            ) : (
              <p>还没有任务，可在“任务”中创建。</p>
            )}
          </section>
          <section className="home-reminder-card home-recent-card" aria-label="最近项目">
            <h3>
              <Icon name="folder" size={16} />
              <button className="home-section-link" onClick={() => onNavigate('projects')}>
                最近项目
              </button>
              {catalog.data && <span className="home-recent-count">{projects.length}</span>}
            </h3>
            {catalog.error ? (
              <p>项目读取失败：{catalog.error}</p>
            ) : !catalog.data ? (
              <p>正在读取项目…</p>
            ) : projects.length ? (
              projects.slice(0, 5).map((project) => (
                <div className="home-recent-row" key={project.id}>
                  <span>{project.title}</span>
                  <small>{project.task_count} 个任务</small>
                </div>
              ))
            ) : (
              <p>还没有项目，可在“项目”中创建。</p>
            )}
          </section>
          <section className="home-reminder-card">
            <h3>
              <Icon name="file" size={16} /> 重要文档
            </h3>
            <p>重要文档尚未接入，暂不能显示。</p>
          </section>
        </div>
      </aside>
    </section>
  );
}
