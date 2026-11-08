import { flexRender, getCoreRowModel, createTable, type ColumnDef } from '@tanstack/react-table';
import type { HTMLAttributes } from 'react';

type RowProps = HTMLAttributes<HTMLTableRowElement> & { [key: `data-${string}`]: string };

export default function ReadTable<T>({
  data,
  columns,
  getRowId,
  groupBy,
  rowProps,
  className = 'catalog-table',
  label,
  sized = false,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId(row: T): string;
  groupBy?(row: T): { id: string; label: string };
  rowProps?(row: T): RowProps;
  className?: string;
  label?: string;
  sized?: boolean;
}) {
  const table = createTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    state: { columnPinning: {}, columnSizing: {} },
    onStateChange: () => {},
    renderFallbackValue: null,
  });
  const rows = table.getRowModel().rows;
  const groups = new Map<string, { label?: string; rows: typeof rows }>();
  if (!groupBy) groups.set('', { rows });
  else
    for (const row of rows) {
      const { id, label } = groupBy(row.original);
      const group = groups.get(id) ?? { label, rows: [] };
      group.rows.push(row);
      groups.set(id, group);
    }
  return (
    <table
      className={className}
      aria-label={label}
      style={sized ? { tableLayout: 'fixed', minWidth: table.getTotalSize() } : undefined}
    >
      {sized && (
        <colgroup>
          {table.getVisibleLeafColumns().map((column) => (
            <col key={column.id} style={{ width: column.getSize() }} />
          ))}
        </colgroup>
      )}
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
      {[...groups].map(([id, group]) => (
        <tbody key={id}>
          {group.label && (
            <tr className="table-row-group">
              <th scope="rowgroup" colSpan={table.getVisibleLeafColumns().length}>
                {group.label}
              </th>
            </tr>
          )}
          {group.rows.map((row) => (
            <tr key={row.id} {...rowProps?.(row.original)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
