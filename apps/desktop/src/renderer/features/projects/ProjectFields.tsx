import { projectTypes, projectStatuses } from './project-display';
import PropertySelect from '../../shared/ui/PropertySelect';
import { PropertyRow } from '../../shared/ui/PropertyRow';
import { InspectorSection } from '../../shared/ui/InspectorSection';
import { Icon } from '../../shared/ui/Icon';
import { useId, useRef, useState, type ReactNode } from 'react';

import type { Matter } from '../../../preload/caselite-api';
type ProjectAttributes = NonNullable<Matter['attributes']>;
type ProjectProfessionalFields = NonNullable<ProjectAttributes['professional_fields']>;
export type ProjectValues = {
  title: string;
  status: Matter['status'];
  attributes: ProjectAttributes;
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
const propertyIcons: Record<string, string> = {
  name: 'M5 6h14M5 12h14M5 18h9',
  status: 'M12 3a9 9 0 1 0 9 9h-9Z M16 3.9a9 9 0 0 1 4.1 4.1',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  priority: 'M5 19v-3m5 3v-6m5 6V9m5 10V5',
  tag: 'M3 4h8l10 10-7 7L3 10Z M7.5 8h.01',
  number: 'M10 3 6 21M18 3l-4 18M4 9h17M2 15h17',
  institution: 'm3 9 9-5 9 5M5 10h14M6 11v6m6-6v6m6-6v6M4 20h16',
  target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};
const professionalIcons: Record<string, string> = {
  case_number: 'number',
  court: 'institution',
  authority: 'institution',
  institution: 'institution',
  cause: 'file',
  suspected_offense: 'file',
  dispute: 'file',
  stage: 'status',
  service_type: 'folder',
  topic: 'name',
  scope: 'list',
  deliverables: 'check',
  contract_type: 'folder',
  subject: 'file',
  review_focus: 'target',
};
function ProjectPropertyRow({
  label,
  icon,
  children,
}: {
  label: string;
  icon: string;
  children: ReactNode;
}) {
  const path = propertyIcons[icon];
  return (
    <PropertyRow
      label={label}
      labelClassName="project-property-label"
      icon={
        path ? (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={path} />
          </svg>
        ) : (
          <Icon name={icon} size={15} />
        )
      }
    >
      {children}
    </PropertyRow>
  );
}
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
  archive,
}: {
  value: ProjectValues;
  disabled: boolean;
  creating?: boolean;
  sidebar?: boolean;
  onChange(value: ProjectValues, immediate?: boolean): void;
  onInvalid(value: boolean): void;
  archive?: {
    archived: boolean;
    disabled: boolean;
    canArchive: boolean;
    onChange(archived: boolean): void;
  };
}) {
  const invalidTarget = useRef(false);
  const targetHintId = useId();
  const a = value.attributes;
  const targetBeforeLegacyDate = !!(a.start_date && a.target_date && a.target_date < a.start_date);
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
    onChange(
      {
        ...value,
        attributes: {
          ...a,
          project_type: legacyTypes[next],
          professional_type: refined,
        },
      },
      true,
    );
  };
  const attribute = <K extends keyof ProjectAttributes>(
    key: K,
    next: ProjectAttributes[K],
    immediate = false,
  ) => onChange({ ...value, attributes: { ...a, [key]: next } }, immediate);
  const nameRow = (
    <ProjectPropertyRow label="名称" icon="name">
      <input
        disabled={disabled}
        autoFocus={creating}
        aria-label={creating ? '项目名称' : sidebar ? '侧栏项目名称' : '编辑项目名称'}
        value={value.title}
        placeholder={creating ? '项目名称' : undefined}
        maxLength={160}
        autoComplete="off"
        onChange={(e) => onChange({ ...value, title: e.target.value })}
      />
    </ProjectPropertyRow>
  );
  const typeRow = (
    <ProjectPropertyRow label="项目类型" icon="folder">
      <PropertySelect
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
      </PropertySelect>
    </ProjectPropertyRow>
  );
  const assigneeRow = (
    <ProjectPropertyRow label="负责人" icon="person">
      <input
        disabled={disabled}
        aria-label="项目负责人"
        placeholder={creating ? '负责人 · 未分配' : '未分配'}
        value={a.assignee ?? ''}
        maxLength={80}
        onChange={(e) => attribute('assignee', e.target.value || null)}
      />
    </ProjectPropertyRow>
  );
  const properties = (
    <>
      <fieldset className={`project-fields${creating ? ' project-create-fields' : ''}`}>
        <legend className="sr-only">{creating ? '项目属性' : '编辑项目属性'}</legend>
        {creating && typeRow}
        <ProjectPropertyRow label="状态" icon="status">
          <PropertySelect
            disabled={archive ? archive.disabled : disabled}
            aria-label="项目状态"
            value={archive?.archived ? 'archived' : value.status}
            onChange={(e) => {
              const status = e.target.value;
              if (status === 'archived' || status === 'restore')
                archive?.onChange(status === 'archived');
              else onChange({ ...value, status: status as Matter['status'] }, true);
            }}
          >
            {(!archive?.archived ? Object.entries(projectStatuses) : []).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            {archive && (
              <option value="archived" disabled={!archive.archived && !archive.canArchive}>
                已归档
              </option>
            )}
            {archive?.archived && <option value="restore">恢复项目</option>}
          </PropertySelect>
        </ProjectPropertyRow>
        {creating && assigneeRow}
        <ProjectPropertyRow label="优先级" icon="priority">
          <PropertySelect
            disabled={disabled}
            aria-label="项目优先级"
            value={a.priority}
            onChange={(e) => attribute('priority', Number(e.target.value), true)}
          >
            {['无优先级', '紧急', '高', '中', '低'].map((label, key) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </PropertySelect>
        </ProjectPropertyRow>
        {!creating && assigneeRow}
        <ProjectPropertyRow label="日期" icon="calendar">
          <input
            disabled={disabled}
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            aria-label="项目目标日"
            aria-invalid={targetBeforeLegacyDate || undefined}
            aria-describedby={targetBeforeLegacyDate ? targetHintId : undefined}
            value={a.target_date ?? ''}
            onInput={(e) => {
              const valid = e.currentTarget.validity.valid;
              if (invalidTarget.current !== !valid) {
                invalidTarget.current = !valid;
                onInvalid(!valid);
                if (valid) attribute('target_date', e.currentTarget.value || null);
              }
            }}
            onChange={(e) => {
              // 浏览器的半输入日期也可能返回空字符串，不能把它当用户清除。
              invalidTarget.current = !e.target.validity.valid;
              onInvalid(invalidTarget.current);
              if (!invalidTarget.current) attribute('target_date', e.target.value || null);
            }}
          />
        </ProjectPropertyRow>
        {targetBeforeLegacyDate && (
          <small id={targetHintId} className="project-property-error" role="status">
            此项目的历史记录限制了目标日。请选择 {a.start_date} 或之后的日期，或清空目标日。
          </small>
        )}
        <ProjectPropertyRow label="标签" icon="tag">
          <input
            disabled={disabled}
            aria-label="项目标签"
            placeholder={creating ? '标签' : '用逗号分隔，最多20项'}
            title="用逗号分隔，最多20项"
            value={a.tags.join(',')}
            onChange={(e) => attribute('tags', e.target.value ? e.target.value.split(/[,，]/) : [])}
          />
        </ProjectPropertyRow>
        {!creating && nameRow}
        {!creating && typeRow}
      </fieldset>
    </>
  );
  return (
    <>
      {creating ? (
        <>
          <div className="project-create-name">{nameRow}</div>
          {properties}
        </>
      ) : (
        <InspectorSection title="属性">{properties}</InspectorSection>
      )}
      <InspectorSection title="领域" ref={professionalCard} className="project-professional-card">
        <fieldset className="project-fields" disabled={disabled} aria-label="专业属性">
          {group ? (
            Object.entries(professionalFields[group]).map(([key, label]) => (
              <ProjectPropertyRow
                key={`${group}:${key}`}
                label={label}
                icon={professionalIcons[key]}
              >
                <input
                  aria-label={label}
                  value={fields[key] ?? ''}
                  placeholder={creating ? label : '未填写'}
                  maxLength={professionalTextLimit}
                  autoComplete="off"
                  onChange={(event) =>
                    attribute('professional_fields', {
                      ...a.professional_fields,
                      [group]: { ...fields, [key]: event.target.value.replaceAll('\0', '') },
                    })
                  }
                />
              </ProjectPropertyRow>
            ))
          ) : (
            <small>
              {type === 'litigation'
                ? '此项目的诉讼类型未细分。请在项目类型中选择具体类型。'
                : '选择具体项目类型后，可在这里填写专业资料。'}
            </small>
          )}
        </fieldset>
      </InspectorSection>
    </>
  );
}
