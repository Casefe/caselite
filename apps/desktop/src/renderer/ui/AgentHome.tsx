import ImportantSchedules from '../features/calendar/ImportantSchedules';
import { Icon } from '../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import { type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';
import type { AgentRun, Task } from '../../preload/caselite-api';

import AgentPanel from './AgentPanel';
import BrandLogo from './BrandLogo';
import ActiveAgents from './ActiveAgents';
import { isConversationRun } from '../features/agent/agent-messages';

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
  onNavigate(view: 'tasks' | 'projects' | 'agent-history' | 'calendar'): void;
  tasks: Task[];
  onOpen(id: string): void;
}) {
  const draft = useRef<DraftEditorHandle>(null);
  const [showNotice, setShowNotice] = useState(true);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);
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
          setHistory(result.runs.filter(isConversationRun));
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
  return (
    <section
      className={`home-view agent-home${conversation && !overview ? ' home-conversation' : ''}`}
      data-layout="three-column"
      aria-label="Agent 首页"
    >
      <div className="home-topbar">
        <details className="home-history-menu">
          <summary>
            <Icon name="clock" size={16} />
            历史对话
          </summary>
          <section className="home-history-popover" aria-label="历史对话">
            <header>
              <h2>
                <button className="home-section-link" onClick={() => onNavigate('agent-history')}>
                  查看全部对话
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
        </details>
      </div>
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
            freshHomeSession
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
          <ImportantSchedules home onOpen={onOpen} onCalendar={() => onNavigate('calendar')} />
          <ActiveAgents tasks={tasks} onOpen={onOpen} />
        </div>
      </aside>
    </section>
  );
}
