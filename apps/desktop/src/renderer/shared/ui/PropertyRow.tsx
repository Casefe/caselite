import type { ReactNode } from 'react';

// 只统一字段排版与 label 语义；值、校验和保存由对应对象的消费者持有。
export function PropertyRow({
  label,
  icon,
  children,
  compact = true,
  labelClassName = '',
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  compact?: boolean;
  labelClassName?: string;
}) {
  return (
    <label className={compact ? 'inspector-property-row' : undefined}>
      <span className={`inspector-property-label${labelClassName ? ` ${labelClassName}` : ''}`}>
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

// 只读值继续使用 dl/dt/dd，不把只读文本伪装为可编辑控件。
export function PropertyValue({
  label,
  children,
  valueClassName,
}: {
  label: string;
  children: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="inspector-property-row">
      <dt className="inspector-property-label">{label}</dt>
      <dd className={valueClassName}>{children}</dd>
    </div>
  );
}
