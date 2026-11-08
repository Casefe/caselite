import type { ReactNode, SelectHTMLAttributes } from 'react';

// 只持有无框选择器的外观。字段值、校验、自动保存和回执由业务页面负责。
export default function PropertySelect({
  icon,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: ReactNode }) {
  return (
    <span className="property-select" data-disabled={props.disabled || undefined}>
      {icon && (
        <span className="property-select-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <select {...props}>{children}</select>
      <svg className="property-select-caret" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </span>
  );
}
