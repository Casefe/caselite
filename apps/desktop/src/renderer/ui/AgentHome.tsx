import { useRef } from 'react';
import { type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';
import type { Task } from '../../preload/caselite-api';
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
  onStart,
  tasks,
  onOpen,
}: {
  prompt: RichDraft;
  onPrompt(value: RichDraft): void;
  onStart(): void;
  tasks: Task[];
  onOpen(id: string): void;
}) {
  const draft = useRef<DraftEditorHandle>(null);
  return (
    <section className="home-view agent-home" aria-label="Agent 首页">
      <div className="agent-main">
        <div className="agent-topline">
          <span>
            <Icon name="spark" size={15} /> Agent
          </span>
          <span className="draft-badge">个人工作区</span>
        </div>
        <div className="agent-start">
          <span className="agent-wordmark">
            <BrandLogo /> CaseLite Agent
          </span>
          <h1>今天需要处理什么工作？</h1>
          <p>从工作目标开始，把材料、思考和成果放在同一个任务里。</p>
          <AgentPanel
            scope="home"
            draft={prompt}
            onDraft={onPrompt}
            editorRef={draft}
            onCreate={onStart}
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
        <div className="agent-local">
          <i className="local-dot" />
          本地工作区 <span>无需登录即可开始</span>
        </div>
      </div>
      <aside className="agent-context" aria-label="Agent 工作上下文">
        <h2>工作上下文</h2>
        <div className="agent-context-section">
          <h3>当前范围</h3>
          <p>
            <Icon name="panel" size={14} />
            个人本地工作区
          </p>
          <span>开始任务后，在右栏查看任务属性与 AI 上下文。</span>
        </div>
        <div className="agent-context-section">
          <h3>
            可继续的任务 <small>{tasks.length}</small>
          </h3>
          {tasks.slice(0, 5).map((task) => (
            <button key={task.id} onClick={() => onOpen(task.id)}>
              <Icon name="check" size={14} />
              <span>{task.title}</span>
              <Icon name="chevron" size={12} />
            </button>
          ))}
          {tasks.length === 0 && <p className="caption">尚无任务，从工作目标开始。</p>}
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
