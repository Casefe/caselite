import { useRef, useState } from 'react';
import type { Matter } from '../../preload/caselite-api';
type ProjectAttributes = NonNullable<Matter['attributes']>;
type ProjectProfessionalFields = NonNullable<ProjectAttributes['professional_fields']>;
export type ProjectValues = {
  title: string;
  status: Matter['status'];
  attributes: ProjectAttributes;
};
const projectTypes = {
  general: '通用',
  litigation: '诉讼（未细分）',
  civil_litigation: '民事诉讼',
  criminal_litigation: '刑事诉讼',
  commercial_arbitration: '商事仲裁',
  non_litigation: '非诉项目',
  contract_review: '合同审查',
};
type ProjectType = keyof typeof projectTypes;
const legacyTypes: Record<ProjectType, ProjectAttributes['project_type']> = {
  general: 'general',
  litigation: 'litigation',
  contract_review: 'contract_review',
  civil_litigation: 'litigation',
  criminal_litigation: 'litigation',
  commercial_arbitration: 'general',
  non_litigation: 'general',
};
const professionalTextLimit = 240;
type ProfessionalGroup = keyof ProjectProfessionalFields;
const professionalFields: {
  [K in ProfessionalGroup]: Record<keyof NonNullable<ProjectProfessionalFields[K]>, string>;
} = {
  civil_litigation: { case_number: '案号', court: '受理法院', cause: '案由', stage: '程序阶段' },
  criminal_litigation: {
    case_number: '案号',
    authority: '办案机关',
    suspected_offense: '涉嫌罪名',
    stage: '程序阶段',
  },
  commercial_arbitration: {
    case_number: '案号',
    institution: '仲裁机构',
    dispute: '争议事项',
    stage: '仲裁阶段',
  },
  non_litigation: {
    service_type: '服务类型',
    topic: '事项主题',
    scope: '服务范围',
    deliverables: '拟交付成果',
  },
  contract_review: { contract_type: '合同类型', subject: '合同标的', review_focus: '审查重点' },
};
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
  const type = a.professional_type ?? a.project_type;
  const professionalCard = useRef<HTMLDetailsElement>(null);
  const [allowLegacy] = useState(type === 'litigation');
  const group = Object.hasOwn(professionalFields, type) ? (type as ProfessionalGroup) : null;
  const fields: Record<string, string | undefined> =
    (group && a.professional_fields?.[group]) || {};
  const changeType = (next: ProjectType) => {
    if (professionalCard.current) professionalCard.current.open = true;
    const refined =
      next === 'general' || next === 'litigation' || next === 'contract_review' ? null : next;
    onChange({
      ...value,
      attributes: {
        ...a,
        project_type: legacyTypes[next],
        professional_type: refined,
      },
    });
  };
  const attribute = <K extends keyof ProjectAttributes>(key: K, next: ProjectAttributes[K]) =>
    onChange({ ...value, attributes: { ...a, [key]: next } });
  return (
    <>
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
            value={type}
            onChange={(e) => changeType(e.target.value as ProjectType)}
          >
            {Object.entries(projectTypes)
              .filter(([key]) => key !== 'litigation' || allowLegacy)
              .map(([key, label]) => (
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
      <details ref={professionalCard} className="project-professional-card" open>
        <summary>专业卡{group ? ` · ${projectTypes[group]}` : ''}</summary>
        <fieldset className="project-fields" disabled={disabled} aria-label="专业属性">
          {group ? (
            Object.entries(professionalFields[group]).map(([key, label]) => (
              <label key={`${group}:${key}`}>
                {label}
                <input
                  aria-label={label}
                  value={fields[key] ?? ''}
                  maxLength={professionalTextLimit}
                  autoComplete="off"
                  onChange={(event) =>
                    attribute('professional_fields', {
                      ...a.professional_fields,
                      [group]: { ...fields, [key]: event.target.value.replaceAll('\0', '') },
                    })
                  }
                />
              </label>
            ))
          ) : (
            <small>
              {type === 'litigation'
                ? '此项目的诉讼类型未细分。请在项目类型中选择具体类型。'
                : '选择具体项目类型后，可在这里填写专业资料。'}
            </small>
          )}
        </fieldset>
      </details>
    </>
  );
}
