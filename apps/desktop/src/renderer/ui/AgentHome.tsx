import { useRef } from 'react';
import { DraftEditor, type DraftEditorHandle, type RichDraft } from '../editors/RichEditor';
import type { Task } from '../../preload/caselite-api';
import { Icon } from './Workspace';
import BrandLogo from './BrandLogo';

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
  const composing = useRef(false);
  return (
    <section className="home-view agent-home" aria-label="Agent 首页">
      <div className="agent-main">
        <div className="agent-topline">
          <span>
            <Icon name="spark" size={15} /> Agent
          </span>
          <span className="draft-badge">模型未连接</span>
        </div>
        <div className="agent-start">
          <span className="agent-wordmark">
            <BrandLogo /> CaseLite Agent
          </span>
          <h1>今天需要处理什么工作？</h1>
          <p>从工作目标开始，把材料、思考和成果放在同一个任务里。</p>
          <form
            className="agent-prompt"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!composing.current) onStart();
            }}
          >
            <DraftEditor
              ref={draft}
              value={prompt}
              onChange={onPrompt}
              label="Agent 工作目标"
              testId="agent-input"
              placeholder="描述你需要完成的法律工作，输入 / 插入内容块…"
            />
            {prompt.text.length > 4000 && (
              <p role="alert" className="caption">
                超过4000字符，请精简后创建；输入仍保留。
              </p>
            )}
            <div className="agent-prompt-actions">
              <span>
                <Icon name="file" size={14} /> 材料导入尚未接入
              </span>
              <button
                className="primary"
                data-testid="create-from-agent"
                disabled={!prompt.text.trim() || prompt.text.length > 4000}
              >
                创建任务 <Icon name="plus" size={14} />
              </button>
            </div>
          </form>
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
          <p className="agent-limit">
            当前可将工作目标创建为本地任务，并手动编辑、保存正文。AI
            尚未接入，不会发送材料或生成回答。
          </p>
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
          <p className="muted">模型 / 材料读取：未接入</p>
        </div>
      </aside>
    </section>
  );
}
