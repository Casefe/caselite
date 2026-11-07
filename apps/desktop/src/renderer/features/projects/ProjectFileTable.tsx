import { useMemo, useState } from 'react';

import {
  createTable,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  type ExpandedState,
  type ColumnDef,
} from '@tanstack/react-table';
import type { Material } from '../../../preload/caselite-api';

type FileNode = {
  id: string;
  name: string;
  children?: FileNode[];
  material?: Material;
  content?: string;
  proof?: string;
  comments?: string;
  type?: string;
  provider?: string;
  risk?: string;
  delivery?: string;
  excerpt?: string;
};

const exampleFolders: FileNode[] = [
  {
    id: 'folder-contract',
    name: '01 合同与附件',
    children: [
      {
        id: 'sample-contract',
        name: '设备采购合同.pdf',
        content: '价款、验收与付款安排',
        proof: '尾款支付条件',
        comments: '2',
        type: '合同',
        provider: '委托方',
        risk: '缺验收签章',
        delivery: '审查意见 v1',
        excerpt:
          '买方应在设备到场后十个工作日内组织验收。验收合格且收到相应发票后，买方应于三十日内支付剩余价款。',
      },
      {
        id: 'sample-inventory',
        name: '设备清单.pdf',
        content: '规格、数量及单价',
        proof: '合同标的范围',
        comments: '0',
        type: '合同附件',
        provider: '委托方',
        excerpt: '本清单列明样例设备的规格、数量及配套部件，以双方签署的交接单为准。',
      },
    ],
  },
  {
    id: 'folder-performance',
    name: '02 履约记录',
    children: [
      {
        id: 'sample-receipt',
        name: '设备交接单.pdf',
        content: '到货与交接记录',
        proof: '设备已到场',
        comments: '1',
        type: '交接凭证',
        provider: '仓储方',
        risk: '缺验收日期',
        excerpt: '本单仅确认设备及配套部件已到场。质量验收与付款条件另按合同约定处理。',
      },
      {
        id: 'sample-email',
        name: '验收沟通纪要.pdf',
        content: '双方确认验收安排',
        proof: '验收时间仍待确认',
        comments: '3',
        type: '沟通记录',
        provider: '委托方',
        delivery: '审查意见 v1',
        excerpt: '双方拟在下周安排现场验收。具体日期由双方另行确认，本次沟通未形成验收结论。',
      },
    ],
  },
];

const columns: ColumnDef<FileNode>[] = [
  { accessorKey: 'name', header: '文件名', size: 222 },
  { accessorKey: 'content', header: '内容', size: 145 },
  { accessorKey: 'proof', header: '证明内容', size: 124 },
  { accessorKey: 'comments', header: '评论', size: 55 },
  { accessorKey: 'type', header: '类型', size: 82 },
  { accessorKey: 'provider', header: '提供者', size: 75 },
  { accessorKey: 'risk', header: '风险点', size: 100 },
  { accessorKey: 'delivery', header: '关联交付物', size: 110 },
];

export function ProjectFileTable({
  rows,
  selectedId,
  disabled,
  onSelect,
}: {
  rows: FileNode[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (node: FileNode) => void;
}) {
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const table = useMemo(
    () =>
      createTable({
        data: rows,
        columns,
        getRowId: (node) => node.id,
        getSubRows: (node) => node.children,
        getCoreRowModel: getCoreRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        state: { expanded, columnSizing: {}, columnPinning: {} },
        onExpandedChange: setExpanded,
        onStateChange: () => {},
        renderFallbackValue: null,
        autoResetExpanded: false,
      }),
    [rows, expanded],
  );
  return (
    <div className="project-file-grid" tabIndex={0} role="region" aria-label="文件表格滚动区">
      <table aria-label="项目材料" style={{ minWidth: 720 }}>
        <colgroup>
          {table.getAllLeafColumns().map((column) => (
            <col
              key={column.id}
              style={{ width: `${(column.getSize() / table.getTotalSize()) * 100}%` }}
            />
          ))}
        </colgroup>
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
          {table.getRowModel().rows.map((row) => {
            const node = row.original;
            const folder = row.getCanExpand();
            return (
              <tr
                key={row.id}
                data-folder={folder || undefined}
                data-source-id={node.material?.id}
                data-selected={!folder && selectedId === row.id ? true : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  if (cell.column.id === 'name')
                    return (
                      <th key={cell.id} scope="row">
                        <button
                          type="button"
                          className="project-file-name"
                          style={{ paddingInlineStart: row.depth * 20 }}
                          aria-expanded={folder ? row.getIsExpanded() : undefined}
                          aria-pressed={folder ? undefined : selectedId === row.id}
                          title={node.name}
                          disabled={!folder && disabled}
                          onClick={folder ? row.getToggleExpandedHandler() : () => onSelect(node)}
                        >
                          <span className="project-file-glyph" aria-hidden="true">
                            {folder ? (row.getIsExpanded() ? '▾' : '▸') : '▤'}
                          </span>
                          <span className="project-file-label">{node.name}</span>
                          {folder && <small>{row.subRows.length} 项</small>}
                        </button>
                      </th>
                    );
                  const value = cell.getValue<string | undefined>();
                  return (
                    <td key={cell.id} title={value}>
                      {!folder &&
                        (cell.column.id === 'risk' && value ? (
                          <span className="project-file-risk">{value}</span>
                        ) : (
                          (value ?? <span className="project-file-empty-value">—</span>)
                        ))}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectFileExample({ onExit }: { onExit: () => void }) {
  const [selected, setSelected] = useState<FileNode>();
  return (
    <>
      <div className="project-file-example-bar">
        <span>布局示例 · 合成材料</span>
        <button type="button" onClick={onExit}>
          返回项目文件
        </button>
      </div>
      <div className="project-file-split" data-preview={Boolean(selected)}>
        <ProjectFileTable
          rows={exampleFolders}
          selectedId={selected?.id}
          disabled={false}
          onSelect={setSelected}
        />
        {selected && (
          <aside className="project-file-preview" aria-label="文件预览">
            <header className="project-file-preview-header">
              <div>
                <small>文件预览 · 示例</small>
                <strong>{selected.name}</strong>
              </div>
              <button type="button" onClick={() => setSelected(undefined)}>
                收起预览
              </button>
            </header>
            <div className="project-file-preview-meta">
              {selected.type} · {selected.provider} · 示例第 1 页
            </div>
            <div className="project-file-preview-paper">
              <small>示例原文</small>
              <h4>{selected.name.replace(/\.pdf$/, '')}</h4>
              <p>{selected.excerpt}</p>
            </div>
            <section className="project-file-preview-meta" aria-label="引用位置">
              引用 / Anchor · 示例第 1 页，第 1 段
            </section>
            <section className="project-file-preview-meta" aria-label="审查操作">
              Source Review / Ask LogiX · 此示例仅供阅读
            </section>
          </aside>
        )}
      </div>
      <div className="project-file-footer">4 份示例文件 · 2 个示例目录</div>
    </>
  );
}
