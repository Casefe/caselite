import { useEffect, useRef, useState } from 'react';
import { type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';
import type { AgentRun, Task } from '../../preload/caselite-api';
import { Icon } from './Workspace';
import BrandLogo from './BrandLogo';
import AgentPanel from './AgentPanel';

const starters = [
  {
    title: '梳理事实与缺件',
    text: '梳理两份材料中的事实、矛盾和缺件，形成律师内部沟通初稿。',
    icon: 'list',
  },
  {
    title: '对照材料中的矛盾',
    text: '对照所选材料，列出不一致的陈述、待核实的问题和需要补充的材料。',
    icon: 'file',
  },
  {
    title: '起草内部沟通稿',
    text: '根据已核对的事实起草内部沟通稿，明确区分事实、推断与待核实事项。',
    icon: 'book',
  },
];

export default function AgentHome({
  prompt,
  onPrompt,
  onNavigate,
  onStart,
  tasks,
  onOpen,
}: {
  prompt: RichDraft;
  onPrompt(value: RichDraft): void;
  onNavigate(view: 'tasks' | 'projects' | 'agent-history'): void;
  onStart?(): void;
  tasks: Task[];
  onOpen(id: string): void;
}) {
  const draft = useRef<DraftEditorHandle>(null);
  const [history, setHistory] = useState<AgentRun[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
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
  const [conversation, setConversation] = useState(false);
  const [overview, setOverview] = useState(false);
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
        <div className="agent-topline">
          <span>
            <Icon name="home" size={15} /> 首页
          </span>
        </div>
        <div className="agent-start">
          <span className="agent-wordmark">
            <BrandLogo /> CaseLite Agent
          </span>
          <h1>从一个工作目标开始</h1>
          <p>从工作目标开始，把材料、思考和成果放在同一个任务里。</p>
          <AgentPanel
            scope="home"
            draft={prompt}
            onDraft={onPrompt}
            editorRef={draft}
            onCreate={onStart}
            onConversationChange={setConversation}
          />
          <div className="agent-starters">
            {starters.map((item) => (
              <button
                key={item.title}
                disabled={
                  Boolean(prompt.text.trim()) && prompt.text.length + item.text.length + 1 > 4000
                }
                title={prompt.text.trim() ? '追加到工作目标（最多4000字符）' : '填写工作目标'}
                onClick={() => draft.current?.append(item.text)}
              >
                <Icon name={item.icon} size={16} />
                <span>{item.title}</span>
                <Icon name="chevron" size={12} />
              </button>
            ))}
          </div>
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
      <aside className="agent-context" aria-label="Agent 工作上下文">
        <h2>属性</h2>
        <div className="agent-context-section">
          <h3>当前范围</h3>
          <p>
            <Icon name="panel" size={14} />
            个人本地工作区
          </p>
          <span>开始任务后，在右栏查看任务属性与 AI 上下文。</span>
        </div>
        <div className="agent-context-section">
          <h3>本地工作区</h3>
          <dl className="workspace-properties">
            <dt>任务</dt>
            <dd>{tasks.length}</dd>
            <dt>已有正文修订</dt>
            <dd>{tasks.filter((task) => task.body_revision > 0).length}</dd>
            <dt>存储位置</dt>
            <dd>仅此设备</dd>
            <dt>模型方式</dt>
            <dd>自带密钥 · BYOK</dd>
          </dl>
        </div>
        <div className="agent-context-section">
          <h3>已连接能力</h3>
          <p>
            <i className="local-dot" />
            任务与正文保存
          </p>
          <p className="muted">AI 仅使用本次确认输入；材料读取尚未接入</p>
        </div>
      </aside>
    </section>
  );
}
