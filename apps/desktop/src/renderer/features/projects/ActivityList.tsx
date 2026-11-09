import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ActivityEvent, ActivityScope } from '../../../preload/caselite-api';
const actions: Record<string, string> = {
  create: '创建任务',
  update: '修改任务',
  change_status: '修改任务状态',
  subscribe_task: '订阅任务',
  unsubscribe_task: '取消订阅任务',
  update_attributes: '修改任务属性',
  save: '保存正文',
  create_snapshot: '固定交付版本',
  export_snapshot: '导出交付草稿',
  create_project: '创建项目',
  register_contract: '登记收费合同',
  record_payment: '登记已确认收款',
  reverse_payment: '冲回收款记录',
  promote_task: '从任务创建项目',
  assign_task: '调整项目归组',
  assign_project: '调整项目归组',
  create_milestone: '创建项目里程碑',
  update_milestone: '更新项目里程碑',
  assign_milestone: '调整任务里程碑',
  update_project: '更新项目',
  archive_project: '切换项目归档状态',
  archive_document: '切换文档归档状态',
  organize_document: '整理文档',
};
export default function ActivityList({
  scope,
  disabled = false,
  onTask,
  onProject,
  compact = false,
  refresh,
  readOnly = false,
}: {
  scope: ActivityScope;
  disabled?: boolean;
  compact?: boolean;
  refresh?: string;
  readOnly?: boolean;
  onTask(id: string): void;
  onProject?(id: string): void;
}) {
  const [rows, setRows] = useState<ActivityEvent[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const navigationBlocked = useRef(disabled);
  useLayoutEffect(() => {
    navigationBlocked.current = disabled;
  }, [disabled]);
  const { type, id } = scope;
  const load = useCallback(
    async (next: number) => {
      const sequence = ++epoch.current;
      setBusy(true);
      setError('');
      try {
        const r = await window.caselite.catalog({
          protocol_version: 1,
          operation: 'list_activity',
          scope: { type, id },
          offset: next,
        });
        if (sequence !== epoch.current) return;
        if (!r.ok) {
          setError(r.message);
          return;
        }
        setRows(r.activity ?? []);
        setMore(r.activity_has_more ?? false);
        setOffset(next);
      } catch {
        if (sequence === epoch.current) setError('无法读取活动，请重试。已保存记录保留。');
      } finally {
        if (sequence === epoch.current) setBusy(false);
      }
    },
    [type, id],
  );
  useEffect(() => {
    let active = true;
    const guard = epoch;
    void Promise.resolve().then(() => {
      if (active) void load(0);
    });
    return () => {
      active = false;
      guard.current++;
    };
  }, [load, refresh]);
  const open = async (event: ActivityEvent) => {
    if (navigationBlocked.current) return;
    const sequence = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const r = await window.caselite.catalog({
        protocol_version: 1,
        operation: 'activity_target',
        scope: { type, id },
        event_id: event.id,
        origin: event.origin,
      });
      // 回跳等待期间父页仍可编辑；必须读取最新阻止状态，不能用发起时的闭包覆盖草稿。
      if (sequence !== epoch.current || navigationBlocked.current) return;
      if (!r.ok) {
        setError(r.message);
        return;
      }
      const target = r.activity_target;
      if (!target) {
        setError('目标暂不可读取，请重新读取活动。');
        return;
      }
      if (target.type === 'project') onProject?.(target.id);
      else if (target.task_id) onTask(target.task_id);
    } catch {
      if (sequence === epoch.current) setError('无法打开活动对象，请重新读取后重试。');
    } finally {
      if (sequence === epoch.current) setBusy(false);
    }
  };
  return (
    <section
      className={compact ? 'activity-list activity-list--compact' : 'activity-list'}
      aria-label="真实业务活动"
    >
      <div className="project-query-toolbar">
        <span>已提交的本地动作</span>
        <button disabled={busy || disabled} onClick={() => void load(0)}>
          重新读取活动
        </button>
      </div>
      <p className="caption">
        {type === 'project'
          ? '当前项目及现属任务的记录，归组前的任务历史一并保留。'
          : '此任务的已提交记录。'}
        材料登记、定稿与导出事件尚未接入。
      </p>
      {busy && <p role="status">正在读取活动…</p>}
      {error && <p role="alert">{error}</p>}
      {error && rows && <p role="status">以下为上次读取的活动，请重新读取核对当前范围。</p>}
      {!error && rows?.length === 0 && <p>还没有可显示的成功活动。</p>}
      <ol>
        {(compact && !readOnly ? rows?.slice(0, 3) : rows)?.map((event) => (
          <li key={event.origin + event.id} data-activity-id={event.id}>
            <div>
              <strong>{actions[event.operation] ?? event.operation}</strong>
              <span>已提交</span>
            </div>
            <time dateTime={event.committed_at}>
              {new Date(event.committed_at).toLocaleString()}
            </time>
            <p>操作者未记录 · 历史修订未记录 · {event.origin === 'task' ? '任务' : '目录'}记录</p>
            {!readOnly && (
              <button
                disabled={busy || disabled || (event.target_type === 'project' && !onProject)}
                onClick={() => void open(event)}
              >
                打开当前
                {event.target_type === 'project'
                  ? '项目'
                  : event.target_type === 'task'
                    ? '任务'
                    : '文档'}{' '}
                · {event.target_id.slice(0, 8)}
              </button>
            )}
          </li>
        ))}
      </ol>
      {rows && (!compact || (readOnly && (more || offset > 0))) && (
        <div className="project-query-toolbar">
          <button
            disabled={busy || disabled || !offset}
            onClick={() => void load(Math.max(0, offset - 20))}
          >
            上一页活动
          </button>
          <span>第 {Math.floor(offset / 20) + 1} 页</span>
          <button disabled={busy || disabled || !more} onClick={() => void load(offset + 20)}>
            下一页活动
          </button>
        </div>
      )}
    </section>
  );
}
