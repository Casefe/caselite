import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThemeCommand } from '../../../preload/caselite-api';
import { useAppearance } from '../../ui/Appearance';

export function ThemeCommandCard({ command, runId }: { command: ThemeCommand; runId: string }) {
  const appearance = useAppearance();
  const { retry } = appearance;
  const [current, setCurrent] = useState(command);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);
  const lastTheme = useRef(appearance.theme);
  const generation = useRef(0);
  const alive = useRef(true);
  const query = useCallback(
    async (operation: 'theme_status' | 'undo_theme', synchronize = true) => {
      const token = ++generation.current;
      try {
        const result = await window.caselite.agent({
          protocol_version: 1,
          operation,
          scope: 'home',
          run_id: runId,
        });
        if (!alive.current || token !== generation.current) return;
        const run = result.ok ? result.runs.find((value) => value.id === runId) : undefined;
        if (!result.ok || !run?.theme_command) {
          setValid(false);
          setError(result.ok ? '操作记录不可核对，请读取当前主题。' : result.message);
        } else {
          setCurrent(run.theme_command);
          setValid(true);
          setError(run.message.includes('运行记录尚未保存') ? run.message : '');
        }
        // 只读取原Owner并同步DOM/窗口，不能借结果核对再提交一次主题。
        if (synchronize) retry();
      } catch {
        if (!alive.current || token !== generation.current) return;
        setValid(false);
        setError('结果待核对，请保留本操作；未重新提交。');
      } finally {
        if (alive.current && token === generation.current) setPending(false);
      }
    },
    [runId, retry],
  );
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    // 外部IPC读取放到提交后的微任务；卸载或StrictMode清理后不再启动旧查询。
    queueMicrotask(() => {
      if (!cancelled) void query('theme_status');
    });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [query, command.state]);
  useEffect(() => {
    if (lastTheme.current === appearance.theme) return;
    lastTheme.current = appearance.theme;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && alive.current) void query('theme_status', false);
    });
    return () => {
      cancelled = true;
    };
  }, [appearance.theme, query]);
  const expected = current.state === 'undone' ? current.before : current.after;
  const applied =
    valid && !appearance.pending && !appearance.error && appearance.theme === expected;
  const label = expected === 'dark' ? '深色' : '浅色';
  let title = current.message;
  if (current.state === 'saved' || current.state === 'undone') {
    const action = current.state === 'saved' ? '保存' : '撤销';
    if (!valid) title = `历史操作：当时已${action}${action === '保存' ? '主题' : ''}`;
    else if (!current.current) title = `当时已${action}；当前选择已被后续设置取代`;
    else if (applied)
      title = current.state === 'saved' ? `${label}主题已保存并应用` : '已撤销本次主题修改';
    else
      title = current.state === 'saved' ? '主题已保存，界面尚待同步' : '撤销已保存，界面尚待同步';
  }
  return (
    <section
      className="theme-command-card"
      data-testid="theme-command"
      data-command-id={command.id}
      aria-label="主题操作结果"
    >
      <strong role="status">{title}</strong>
      <p>范围：本机 CaseLite 应用</p>
      <p>当前界面：{appearance.theme === 'dark' ? '深色' : '浅色'}；此卡记录本次操作结果。</p>
      {error && <p role="alert">{error}</p>}
      {appearance.error && <p role="alert">{appearance.error}</p>}
      <button
        type="button"
        disabled={pending || appearance.pending}
        onClick={() => {
          setPending(true);
          void query('theme_status');
        }}
      >
        核对结果
      </button>
      <button
        type="button"
        disabled={!valid || !current.can_undo || pending || appearance.pending}
        onClick={() => {
          setPending(true);
          void query('undo_theme');
        }}
      >
        撤销本次修改
      </button>
    </section>
  );
}
