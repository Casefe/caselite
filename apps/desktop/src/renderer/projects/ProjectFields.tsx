import { useRef } from 'react';
import type { Matter } from '../../preload/caselite-api';
type ProjectAttributes = NonNullable<Matter['attributes']>;
export type ProjectValues = {
  title: string;
  status: Matter['status'];
  attributes: ProjectAttributes;
};
export const projectTypes = { general: '通用', litigation: '诉讼', contract_review: '合同审查' };
export const projectStatuses = { planned: '待开始', active: '进行中', done: '已完成' };
export function projectValues(project?: Matter): ProjectValues {
  return {
    title: project?.title ?? '',
    status: project?.status ?? 'planned',
    attributes: project?.attributes ?? {
      project_type: 'general',
      assignee: null,
      priority: 0,
      start_date: null,
      target_date: null,
      tags: [],
    },
  };
}
function validDate(value: string | null) {
  if (value === null) return true;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function validProject(values: ProjectValues) {
  const a = values.attributes;
  return (
    !!values.title.trim() &&
    values.title.trim().length <= 160 &&
    Object.hasOwn(projectTypes, a.project_type) &&
    Number.isInteger(a.priority) &&
    a.priority >= 0 &&
    a.priority <= 4 &&
    (a.assignee === null || (a.assignee.trim().length > 0 && a.assignee.trim().length <= 80)) &&
    a.tags.length <= 20 &&
    a.tags.every((t) => !!t.trim() && t.trim().length <= 40) &&
    validDate(a.start_date) &&
    validDate(a.target_date) &&
    (!a.start_date || !a.target_date || a.start_date <= a.target_date)
  );
}
export default function ProjectFields({
  value,
  disabled,
  creating = false,
  sidebar = false,
  onChange,
  onInvalid,
}: {
  value: ProjectValues;
  disabled: boolean;
  creating?: boolean;
  sidebar?: boolean;
  onChange(value: ProjectValues): void;
  onInvalid(value: boolean): void;
}) {
  const dates = useRef({ start_date: false, target_date: false });
  const a = value.attributes;
  const attribute = <K extends keyof ProjectAttributes>(key: K, next: ProjectAttributes[K]) =>
    onChange({ ...value, attributes: { ...a, [key]: next } });
  return (
    <fieldset className="project-fields" disabled={disabled}>
      <legend>{creating ? '项目属性' : '编辑项目属性'}</legend>
      <label>
        名称
        <input
          disabled={disabled}
          autoFocus={creating}
          aria-label={creating ? '项目名称' : sidebar ? '侧栏项目名称' : '编辑项目名称'}
          value={value.title}
          maxLength={160}
          autoComplete="off"
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        项目类型
        <select
          disabled={disabled}
          aria-label="项目类型"
          value={a.project_type}
          onChange={(e) =>
            attribute('project_type', e.target.value as ProjectAttributes['project_type'])
          }
        >
          {Object.entries(projectTypes).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        状态
        <select
          disabled={disabled}
          aria-label="项目状态"
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value as Matter['status'] })}
        >
          {Object.entries(projectStatuses).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        负责人
        <input
          disabled={disabled}
          aria-label="项目负责人"
          placeholder="未分配"
          value={a.assignee ?? ''}
          maxLength={80}
          onChange={(e) => attribute('assignee', e.target.value || null)}
        />
      </label>

      <label>
        优先级
        <select
          disabled={disabled}
          aria-label="项目优先级"
          value={a.priority}
          onChange={(e) => attribute('priority', Number(e.target.value))}
        >
          {['无优先级', '紧急', '高', '中', '低'].map((label, key) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {(['start_date', 'target_date'] as const).map((key) => (
        <label key={key}>
          {key === 'start_date' ? '开始日' : '目标日'}
          <input
            disabled={disabled}
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            aria-label={key === 'start_date' ? '项目开始日' : '项目目标日'}
            value={a[key] ?? ''}
            onInput={(e) => {
              if (dates.current[key] && e.currentTarget.validity.valid) {
                dates.current[key] = false;
                onInvalid(Object.values(dates.current).some(Boolean));
                attribute(key, e.currentTarget.value || null);
              }
            }}
            onChange={(e) => {
              // 浏览器的半输入日期也可能返回空字符串，不能把它当用户清除。
              dates.current[key] = !e.target.validity.valid;
              onInvalid(Object.values(dates.current).some(Boolean));
              if (dates.current[key]) onChange({ ...value });
              else attribute(key, e.target.value || null);
            }}
          />
        </label>
      ))}

      <label>
        标签
        <input
          disabled={disabled}
          aria-label="项目标签"
          placeholder="用逗号分隔，最多20项"
          value={a.tags.join(',')}
          onChange={(e) => attribute('tags', e.target.value ? e.target.value.split(/[,，]/) : [])}
        />
      </label>
      <small>负责人仅作记录。日期不计算法定期限或创建提醒；标签最多20项，每项1—40字。</small>
    </fieldset>
  );
}
