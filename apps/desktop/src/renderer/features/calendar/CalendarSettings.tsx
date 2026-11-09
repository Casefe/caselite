import { useEffect, useState } from 'react';
import type { CalendarType } from '../../../preload/caselite-api';
import { mutation } from '../../shared/data/taskCommand';
import { calendarQuery, useCalendar } from './calendar-query';
import { useCalendarCommit } from './useCalendarCommit';
import DateRuleSettings from './DateRuleSettings';
export default function CalendarSettings({ onBlocked }: { onBlocked(value: boolean): void }) {
  const read = useCalendar(calendarQuery('types')),
    [draft, setDraft] = useState<CalendarType | null>(null);
  const commit = useCalendarCommit(async (request) => {
    if (request.operation !== 'set_calendar_type') throw Error('类型目标不符。');
    const r = await read.refetch();
    const saved = r.data?.calendar_types?.find((t) => t.id === request.type.id);
    if (r.error || !saved || saved.version < request.type.version + 1)
      throw Error('保存后的类型尚未读回，请重读。');
    setDraft(null);
  });
  useEffect(() => {
    onBlocked(!!draft || commit.locked);
    return () => onBlocked(false);
  }, [draft, commit.locked, onBlocked]);
  const locked = commit.locked;
  return (
    <section className="calendar-settings" aria-label="日历与任务设置">
      <h3>日历与任务</h3>
      <p>
        系统日历、Apple提醒事项、Google Calendar和Google Tasks尚未接入；没有连接账户或外发日历。
      </p>
      <h3>重要日程类型</h3>
      <p>类型独立于优先级。停用阻止新选用，原引用保留；首页显示单独控制。</p>
      <DateRuleSettings types={read.data?.calendar_types ?? []} />
      {read.isPending && <p role="status">正在读取类型…</p>}
      {read.error && (
        <p role="alert">
          类型读取失败。<button onClick={() => void read.refetch()}>重读类型</button>
        </p>
      )}
      <div className="calendar-type-list">
        {read.data?.calendar_types?.map((type) => (
          <div key={type.id}>
            <span>
              {type.name}
              <small>
                {!type.enabled ? ' · 已停用' : ''}
                {!type.show_home ? ' · 首页隐藏' : ''}
              </small>
            </span>
            <button disabled={!!draft || locked} onClick={() => setDraft(type)}>
              编辑{type.name}
            </button>
          </div>
        ))}
      </div>
      <button
        disabled={!!draft || locked || !read.data}
        onClick={() =>
          setDraft({
            id: 'custom-' + crypto.randomUUID(),
            name: '',
            enabled: true,
            show_home: true,
            version: 0,
          })
        }
      >
        新增自定义类型
      </button>
      {draft && (
        <form
          aria-label="编辑重要类型"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
              event.preventDefault();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.name.trim() && !locked)
              void commit.save({
                ...mutation(),
                operation: 'set_calendar_type',
                type: { ...draft, name: draft.name.trim() },
              });
          }}
        >
          <label>
            名称
            <input
              aria-label="重要类型名称"
              value={draft.name}
              maxLength={30}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="类型启用"
              checked={draft.enabled}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            启用
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="类型首页显示"
              checked={draft.show_home}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, show_home: e.target.checked })}
            />
            首页显示
          </label>
          <p className="calendar-caption">稳定ID：{draft.id}</p>
          <button type="submit" disabled={locked || !draft.name.trim()}>
            保存类型
          </button>
          <button
            type="button"
            disabled={commit.pending || commit.phase === 'unknown'}
            onClick={() => {
              if (commit.clear()) setDraft(null);
            }}
          >
            取消编辑
          </button>
        </form>
      )}
      {commit.pending && <p role="status">正在保存类型…</p>}
      {commit.error && (
        <p role="alert">
          {commit.error}
          <button disabled={commit.pending} onClick={() => void commit.recover()}>
            {commit.phase === 'read' ? '重读已保存类型' : '核对并重试原提交'}
          </button>
        </p>
      )}
    </section>
  );
}
