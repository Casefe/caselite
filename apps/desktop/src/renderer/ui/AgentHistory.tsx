import { useEffect, useState } from 'react';
import type { AgentRun, Task } from '../../preload/caselite-api';
import { Icon } from './Workspace';

export default function AgentHistory({
  tasks,
  onBack,
  onOpen,
}: {
  tasks: Task[];
  onBack(): void;
  onOpen(id: string): void;
}) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const results = await Promise.all(
          ['home', ...tasks.map((task) => task.id)].map((scope) =>
            window.caselite.agent({ protocol_version: 1, operation: 'read', scope }),
          ),
        );
        if (stopped) return;
        if (results.some((result) => !result.ok)) {
          setError('对话读取失败，请返回后重试。');
          return;
        }
        setRuns(
          results
            .flatMap((result) => (result.ok ? result.runs : []))
            .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')),
        );
      } catch {
        if (!stopped) setError('对话读取失败，请返回后重试。');
      }
    }
    void load();
    return () => {
      stopped = true;
    };
  }, [tasks]);
  return (
    <section className="all-agent-history" aria-label="全部 AI 对话">
      <header>
        <button onClick={onBack} aria-label="返回首页">
          <Icon name="back" size={16} />
        </button>
        <h1>全部 AI 对话</h1>
      </header>
      {error && <p role="alert">{error}</p>}
      {!runs && !error && <p>正在读取对话…</p>}
      {runs?.length === 0 && <p>还没有 AI 对话。</p>}
      {runs?.map((run) => (
        <article key={run.id} className="home-history-item">
          <div className="home-history-row">
            <button
              className="home-history-open"
              aria-expanded={expanded === run.id}
              onClick={() => setExpanded(expanded === run.id ? null : run.id)}
            >
              <Icon name="clock" size={16} />
              <span>
                <strong>{run.prompt}</strong>
                <small>
                  {run.scope === 'home'
                    ? '首页对话'
                    : `任务对话 · ${tasks.find((task) => task.id === run.scope)?.title ?? '任务'}`}
                  {run.created_at ? ` · ${new Date(run.created_at).toLocaleString('zh-CN')}` : ''}
                </small>
              </span>
            </button>
          </div>
          {expanded === run.id && (
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
  );
}
