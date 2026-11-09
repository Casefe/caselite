import { useEffect, useState } from 'react';
import type { AgentRun, Task } from '../../preload/caselite-api';
import { Icon } from '../shared/ui/Icon';

export default function ActiveAgents({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen(id: string): void;
}) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const result = await window.caselite.agent({
          protocol_version: 1,
          operation: 'active_runs',
        });
        if (stopped) return;
        if (result.ok) {
          setRuns(result.runs.filter((run) => run.status === 'running'));
          setError(false);
        } else setError(true);
      } catch {
        if (!stopped) setError(true);
      }
      if (!stopped) timer = setTimeout(() => void read(), 1000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return (
    <section className="home-reminder-card home-agents" aria-label="智能体">
      <h3>
        <Icon name="spark" size={16} /> 智能体
        {!error && runs && <span className="home-recent-count">{runs.length} 运行中</span>}
      </h3>
      {error ? (
        <p role="alert">智能体状态更新失败，正在重试…</p>
      ) : !runs ? (
        <p role="status">正在读取智能体…</p>
      ) : !runs.length ? (
        <p>暂无运行中的智能体</p>
      ) : (
        runs.map((run) => {
          const task = tasks.find((item) => item.id === run.scope);
          const scope =
            run.scope === 'home'
              ? '首页对话'
              : run.scope.startsWith('project:')
                ? '项目对话'
                : run.scope.startsWith('document:')
                  ? '文档审阅'
                  : run.scope.startsWith('contact:')
                    ? '客户对话'
                    : (task?.title ?? '任务对话');
          return (
            <article key={run.id} className="home-agent-item">
              <button
                className="home-agent-row"
                aria-expanded={expanded === run.id}
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
              >
                <span className="home-agent-indicator" aria-hidden="true" />
                <span className="home-agent-summary">
                  <strong>{run.prompt}</strong>
                  <small>{run.purpose === 'important_dates' ? '重要日期提取' : scope}</small>
                </span>
                <Icon name="chevron" size={13} />
              </button>
              <p className="home-agent-progress">{run.message || '正在运行…'}</p>
              {expanded === run.id && (
                <div className="home-agent-detail">
                  <p>{run.prompt}</p>
                  <small>{run.model}</small>
                  <p>{run.output ? run.output.slice(-400) : '等待模型响应…'}</p>
                  {task && <button onClick={() => onOpen(task.id)}>打开所属任务</button>}
                </div>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
