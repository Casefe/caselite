import { flexRender, getCoreRowModel, createTable, type ColumnDef } from '@tanstack/react-table';
import type { HTMLAttributes } from 'react';

type RowProps = HTMLAttributes<HTMLTableRowElement> & { [key: `data-${string}`]: string };

export default function ReadTable<T>({
  data,
  columns,
  getRowId,
  rowProps,
  className = 'catalog-table',
  label,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId(row: T): string;
  rowProps?(row: T): RowProps;
  className?: string;
  label?: string;
}) {
  const table = createTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    state: { columnPinning: {} },
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  return (
    <table className={className} aria-label={label}>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} scope="col">
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} {...rowProps?.(row.original)}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
