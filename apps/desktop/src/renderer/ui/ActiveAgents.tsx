import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentRun, Task } from '../../preload/caselite-api';
import { Icon } from '../shared/ui/Icon';

export default function ActiveAgents({
  tasks,
  onOpen,
  onStateChange,
  onSelectRun,
}: {
  tasks: Task[];
  onOpen(id: string): void;
  onStateChange?(runs: AgentRun[] | null): void;
  onSelectRun?(run: AgentRun): void;
}) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<Record<string, string>>({});
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [stopped, setStopped] = useState<ReadonlySet<string>>(() => new Set());
  const stopRequest = useRef<string | null>(null);
  const callbacks = useRef({ onStateChange, onSelectRun });
  // 提交后更新回调，保留唯一轮询，不让未提交的渲染影响异步回执。
  useLayoutEffect(() => {
    callbacks.current = { onStateChange, onSelectRun };
  }, [onStateChange, onSelectRun]);
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
          const active = result.runs.filter((run) => run.status === 'running');
          setRuns(active);
          callbacks.current.onStateChange?.(active);
          setError(false);
        } else {
          setRuns(null);
          setError(true);
          callbacks.current.onStateChange?.(null);
        }
      } catch {
        if (!stopped) {
          setRuns(null);
          setError(true);
          callbacks.current.onStateChange?.(null);
        }
      }
      if (!stopped) timer = setTimeout(() => void read(), 1000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  async function stop(run: AgentRun) {
    if (stopRequest.current || cancelError[run.id] || stopped.has(run.id)) return;
    stopRequest.current = run.id;
    setCancelling(run.id);
    try {
      const result = await window.caselite.agent({
        protocol_version: 1,
        operation: 'cancel',
        scope: run.scope,
        run_id: run.id,
      });
      if (!result.ok) setCancelError((old) => ({ ...old, [run.id]: result.message }));
      else setStopped((old) => new Set(old).add(run.id));
    } catch {
      // 回执未知时只读轮询原运行；不自动重复取消请求。
      setCancelError((old) => ({ ...old, [run.id]: '停止状态未知，请核对运行状态。' }));
    } finally {
      setCancelling(null);
      stopRequest.current = null;
    }
  }
  return (
    <section className="home-reminder-card home-agents" aria-label="智能体">
      <h3>
        <Icon name="spark" size={16} /> 进行中的智能体
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
                onClick={() => {
                  setExpanded(expanded === run.id ? null : run.id);
                  callbacks.current.onSelectRun?.(run);
                }}
              >
                <span className="home-agent-indicator" aria-hidden="true" />
                <span className="home-agent-summary">
                  <strong>{run.prompt}</strong>
                  <small>{run.purpose === 'important_dates' ? '重要日期提取' : scope}</small>
                </span>
                <Icon name="chevron" size={13} />
              </button>
              <p className="home-agent-progress">{run.message || '正在运行…'}</p>
              {onSelectRun && (
                <button
                  type="button"
                  disabled={
                    Boolean(cancelling) || Boolean(cancelError[run.id]) || stopped.has(run.id)
                  }
                  onClick={() => void stop(run)}
                >
                  {cancelling === run.id || stopped.has(run.id) ? '正在核对停止状态…' : '停止'}
                </button>
              )}
              {cancelError[run.id] && <p role="alert">{cancelError[run.id]}</p>}
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
