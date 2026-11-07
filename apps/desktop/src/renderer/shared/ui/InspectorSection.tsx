import type { ComponentPropsWithRef } from 'react';

export function InspectorSection({
  title,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithRef<'details'>, 'title'> & { title: string }) {
  return (
    <details
      open
      {...props}
      className={className ? `${className} inspector-disclosure` : 'inspector-disclosure'}
    >
      <summary>{title}</summary>
      {children}
    </details>
  );
}
