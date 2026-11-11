import type { TaskCalendar } from '../../../preload/caselite-api';
import { calendarQuery, useCalendar } from '../../shared/data/calendar-query';

export default function CreationScheduleFields({
  value,
  onChange,
  disabled,
}: {
  value: TaskCalendar;
  onChange(value: TaskCalendar): void;
  disabled: boolean;
}) {
  const types = useCalendar(calendarQuery('types'));
  const slot = value.schedule!;
  const change = (patch: Partial<typeof slot>) =>
    onChange({ ...value, planned_date: patch.date ?? slot.date, schedule: { ...slot, ...patch } });
  return (
    <section className="creation-schedule-fields" aria-label="日程时间">
      <label>
        日期
        <input
          required
          type="date"
          aria-label="日程日期"
          value={slot.date}
          disabled={disabled}
          onChange={(e) => change({ date: e.target.value })}
        />
      </label>
      <div>
        <label>
          开始
          <input
            required
            type="time"
            aria-label="日程开始时间"
            value={slot.start}
            disabled={disabled}
            onChange={(e) => change({ start: e.target.value })}
          />
        </label>
        <span>—</span>
        <label>
          结束
          <input
            required
            type="time"
            aria-label="日程结束时间"
            value={slot.end}
            disabled={disabled}
            onChange={(e) => change({ end: e.target.value })}
          />
        </label>
        <label>
          时区
          <input
            required
            aria-label="日程时区"
            value={slot.timezone}
            disabled={disabled}
            onChange={(e) => change({ timezone: e.target.value })}
          />
        </label>
      </div>
      <label className="creation-important">
        <input
          type="checkbox"
          checked={value.important}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              important: e.target.checked,
              type_id: e.target.checked ? value.type_id : null,
              attention_source: e.target.checked ? 'schedule' : 'unknown',
            })
          }
        />
        标记为重要
      </label>
      {value.important && (
        <label>
          重要类型
          <select
            required
            aria-label="日程重要类型"
            disabled={disabled || !types.data}
            value={value.type_id ?? ''}
            onChange={(e) => onChange({ ...value, type_id: e.target.value || null })}
          >
            <option value="">请选择类型</option>
            {types.data?.calendar_types
              ?.filter((t) => t.enabled)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {types.error && (
        <p role="alert">
          重要类型读取失败。
          <button type="button" onClick={() => void types.refetch()}>
            重试读取
          </button>
        </p>
      )}
    </section>
  );
}
