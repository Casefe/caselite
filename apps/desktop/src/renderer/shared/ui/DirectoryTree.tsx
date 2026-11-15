import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Icon } from './Icon';

export function DirectoryBranch({
  id,
  label,
  open,
  disabled = false,
  onToggle,
  children,
  summaryRole,
  ...props
}: {
  id: string;
  label: string;
  open: boolean;
  disabled?: boolean;
  onToggle(): void;
  children: ReactNode;
  summaryRole?: 'button';
} & Omit<HTMLAttributes<HTMLDetailsElement>, 'id' | 'onToggle'>) {
  return (
    <details {...props} open={open} data-folder-id={id}>
      <summary
        role={summaryRole}
        aria-expanded={open}
        aria-disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          if (!disabled) onToggle();
        }}
      >
        <Icon name="folder" size={19} />
        <span>{label}</span>
      </summary>
      {open && <div className="document-folder-children">{children}</div>}
    </details>
  );
}

export function DirectoryItem({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="document-folder-file" {...props} data-directory-item="true">
      {children}
    </button>
  );
}

export function navigateDirectory(event: KeyboardEvent<HTMLElement>, disabled = false) {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.nativeEvent.isComposing
  )
    return;
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
    return;
  const selector = 'summary, button[data-directory-item], button[data-source-id]';
  const row = (event.target as HTMLElement).closest<HTMLElement>(selector);
  if (!row || !event.currentTarget.contains(row)) return;
  event.preventDefault();
  if (disabled) return;
  // 只移动当前已挂载目录的焦点；选择及展开仍调用消费者的原有保护入口。
  const focusable = (element: HTMLElement) => !element.matches(':disabled, [aria-disabled="true"]');
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector)).filter(
    focusable,
  );
  const index = rows.indexOf(row);
  if (index < 0) return;
  if (event.key === 'Home') rows[0]?.focus();
  else if (event.key === 'End') rows.at(-1)?.focus();
  else if (event.key === 'ArrowDown') rows[Math.min(index + 1, rows.length - 1)]?.focus();
  else if (event.key === 'ArrowUp') rows[Math.max(index - 1, 0)]?.focus();
  else if (event.key === 'ArrowRight' && row.tagName === 'SUMMARY') {
    const folder = row.parentElement as HTMLDetailsElement;
    if (!folder.open) row.click();
    else
      Array.from(
        folder.querySelectorAll<HTMLElement>(
          ':scope > .document-folder-children summary, :scope > .document-folder-children button[data-directory-item], :scope > .document-folder-children button[data-source-id]',
        ),
      )
        .find(focusable)
        ?.focus();
  } else if (event.key === 'ArrowLeft') {
    const folder = row.closest<HTMLDetailsElement>('details');
    if (row.tagName === 'SUMMARY' && folder?.open) row.click();
    else {
      const parent = row.tagName === 'SUMMARY' ? folder?.parentElement?.closest('details') : folder;
      parent?.querySelector<HTMLElement>(':scope > summary')?.focus();
    }
  }
}
