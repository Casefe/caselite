import { useEffect, useState } from 'react';
import type { Task, TaskCalendar } from '../../../preload/caselite-api';
import { mutation } from '../../shared/data/taskCommand';
import { calendarQuery, useCalendar, emptyCalendar } from './calendar-query';
import { useCalendarCommit } from './useCalendarCommit';

export default function TaskCalendarEditor({
  task,
  disabled,
  onBlocked,
  onChanged,
}: {
  task: Task;
  disabled: boolean;
  onBlocked(value: boolean): void;
  onChanged(task: Task, description: number[] | null): void;
}) {
  const [edited, setDraft] = useState<TaskCalendar>(task.calendar ?? emptyCalendar),
    [dirty, setDirty] = useState(false),
    [invalid, setInvalid] = useState('');
  const types = useCalendar(calendarQuery('types'));
  const commit = useCalendarCommit(async (request) => {
    if (request.operation !== 'update_calendar') throw Error('目标类型不符。');
    const r = await window.caselite.task({
      protocol_version: 1,
      operation: 'read',
      task_id: task.id,
    });
    if (!r.ok) throw Error(r.message);
    const saved = r.tasks.find((v) => v.id === task.id);
    if (!saved || saved.version < request.expected_version + 1)
      throw Error('尚未确认已保存的任务版本。');
    setDraft(saved.calendar ?? emptyCalendar);
    setDirty(false);
    onChanged(saved, r.objective_state ?? null);
  });
  // 同Task自动保存不重挂载折叠与焦点；干净表单读取最新投影，未确认输入仍保留自己的草稿。
  const draft = dirty || commit.locked ? edited : (task.calendar ?? emptyCalendar);
  useEffect(() => {
    onBlocked(dirty || commit.locked);
    return () => onBlocked(false);
  }, [dirty, commit.locked, onBlocked]);
  function change(patch: Partial<TaskCalendar>, save = true) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setDirty(true);
    setInvalid('');
    onBlocked(true);
    if (save) persist(next);
  }
  function persist(value = draft) {
    if (disabled || commit.locked) return;
    if (JSON.stringify(value) === JSON.stringify(task.calendar ?? emptyCalendar)) {
      setDirty(false);
      return;
    }
    const dateComplete = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);
    const timeComplete = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    const slot = value.schedule;
    if (
      (value.important && !value.type_id) ||
      (slot &&
        (!dateComplete(slot.date) ||
          !timeComplete(slot.start) ||
          !timeComplete(slot.end) ||
          slot.start >= slot.end ||
          !slot.timezone.trim())) ||
      (value.attention_time && !value.attention_date)
    ) {
      setInvalid('请补全有效的日期、同日开始/结束时刻、时区与重要类型；输入尚未保存。');
      return;
    }
    void commit.save({
      ...mutation(),
      operation: 'update_calendar',
      task_id: task.id,
      expected_version: task.version,
      calendar: value,
    });
  }
  async function discard() {
    if (!commit.clear()) return;
    const r = await window.caselite.task({
      protocol_version: 1,
      operation: 'read',
      task_id: task.id,
    });
    if (r.ok) {
      const current = r.tasks.find((t) => t.id === task.id);
      if (current) {
        setDraft(current.calendar ?? emptyCalendar);
        setDirty(false);
        setInvalid('');
        onChanged(current, r.objective_state ?? null);
      }
    } else setInvalid(r.message);
  }
  const locked = disabled || commit.locked;
  const typeOptions = types.data?.calendar_types ?? [];
  const schedule = draft.schedule;
  function scheduleField(field: 'date' | 'start' | 'end' | 'timezone', value: string) {
    change(
      {
        schedule: {
          date: schedule?.date ?? '',
          start: schedule?.start ?? '',
          end: schedule?.end ?? '',
          timezone: schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          [field]: value,
        },
      },
      false,
    );
  }
  return (
    <details className="task-calendar-editor" aria-label="任务日历属性">
      <summary>日历与重要标记{dirty || commit.locked ? ' · 待确认' : ''}</summary>
      <label>
        任务计划日
        <input
          aria-label="任务计划日"
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={draft.planned_date ?? ''}
          disabled={locked}
          onChange={(e) => change({ planned_date: e.target.value || null }, false)}
          onBlur={(event) => {
            if (event.currentTarget.validity.valid) persist();
            else setInvalid('日期或时刻尚不完整，输入未保存。');
          }}
        />
      </label>
      <details open={!!schedule}>
        <summary>工作时段</summary>
        <p>
          同日具体时间，与截止日及提醒分别保存。按录入日期归组，时刻保留所填IANA时区，不作本机日期换算。
        </p>
        <label>
          日期
          <input
            type="date"
            aria-label="工作时段日期"
            value={schedule?.date ?? ''}
            disabled={locked}
            onChange={(e) => scheduleField('date', e.target.value)}
            onBlur={() => schedule && persist()}
          />
        </label>
        <label>
          开始
          <input
            type="time"
            aria-label="工作开始时刻"
            value={schedule?.start ?? ''}
            disabled={locked}
            onChange={(e) => scheduleField('start', e.target.value)}
            onBlur={() => schedule && persist()}
          />
        </label>
        <label>
          结束
          <input
            type="time"
            aria-label="工作结束时刻"
            value={schedule?.end ?? ''}
            disabled={locked}
            onChange={(e) => scheduleField('end', e.target.value)}
            onBlur={() => schedule && persist()}
          />
        </label>
        <label>
          时区
          <input
            aria-label="工作时区"
            value={schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
            disabled={locked}
            onChange={(e) => scheduleField('timezone', e.target.value)}
            onBlur={() => schedule && persist()}
          />
        </label>
        {schedule && (
          <button disabled={locked} onClick={() => change({ schedule: null })}>
            移除工作时段
          </button>
        )}
      </details>
      <label className="calendar-checkbox">
        <input
          type="checkbox"
          aria-label="标为重要日程"
          checked={draft.important}
          disabled={locked}
          onChange={(e) => change({ important: e.target.checked })}
        />
        标为重要日程
      </label>
      <label>
        类型
        <select
          aria-label="重要日程类型"
          value={draft.type_id ?? ''}
          disabled={locked || !types.data}
          onChange={(e) => change({ type_id: e.target.value || null })}
        >
          <option value="">请选择类型</option>
          {typeOptions
            .filter((t) => t.enabled || t.id === draft.type_id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.enabled ? '' : '（已停用）'}
              </option>
            ))}
        </select>
      </label>
      <label>
        关注日期
        <select
          aria-label="重要关注日期来源"
          value={draft.attention_source}
          disabled={locked}
          onChange={(e) =>
            change({
              attention_source: e.target.value as TaskCalendar['attention_source'],
              attention_date: null,
              attention_time: null,
            })
          }
        >
          <option value="unknown">日期待确认</option>
          <option value="schedule">工作时段日期</option>
          <option value="planned">任务计划日</option>
          <option value="due">普通截止日</option>
          <option value="custom">另选关注日</option>
        </select>
      </label>
      {draft.attention_source === 'custom' && (
        <>
          <label>
            关注日
            <input
              type="date"
              aria-label="另选关注日"
              value={draft.attention_date ?? ''}
              disabled={locked}
              onChange={(e) => change({ attention_date: e.target.value || null }, false)}
              onBlur={(event) => {
                if (event.currentTarget.validity.valid) persist();
                else setInvalid('日期或时刻尚不完整，输入未保存。');
              }}
            />
          </label>
          <label>
            关注时刻
            <input
              type="time"
              aria-label="重要关注时刻"
              value={draft.attention_time ?? ''}
              disabled={locked}
              onChange={(e) => change({ attention_time: e.target.value || null }, false)}
              onBlur={(event) => {
                if (event.currentTarget.validity.valid) persist();
                else setInvalid('日期或时刻尚不完整，输入未保存。');
              }}
            />
          </label>
        </>
      )}
      <p>类型独立于优先级，不自动计算期限或创建通知。</p>
      {types.error && (
        <p role="alert">
          类型读取失败。<button onClick={() => void types.refetch()}>重读类型</button>
        </p>
      )}
      {invalid && <p role="alert">{invalid}</p>}
      {commit.error && <p role="alert">{commit.error}</p>}
      {commit.pending && <p role="status">正在确认日历保存…</p>}
      {commit.error ? (
        <button disabled={commit.pending} onClick={() => void commit.recover()}>
          {commit.phase === 'read' ? '重读已保存结果' : '核对并重试原提交'}
        </button>
      ) : (
        dirty && (
          <button disabled={locked} onClick={() => persist()}>
            保存日历属性
          </button>
        )
      )}
      {(dirty || commit.error) && commit.phase !== 'unknown' && (
        <button disabled={commit.pending} onClick={() => void discard()}>
          放弃日历输入并重读
        </button>
      )}
    </details>
  );
}
