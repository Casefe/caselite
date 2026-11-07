import type { CatalogDocument, Task } from '../../../preload/caselite-api';
import ReadTable from '../../shared/ui/ReadTable';

export default function ProjectDeliverables({
  documents,
  tasks,
  readError,
  disabled,
  onOpen,
}: {
  documents?: CatalogDocument[];
  tasks: Task[];
  readError: string;
  disabled: boolean;
  onOpen(taskId: string, documentId: string): void;
}) {
  if (readError) return <p role="status">暂时无法读取交付草稿。</p>;
  if (!documents) return <p role="status">正在读取交付草稿…</p>;
  const drafts = documents.filter((doc) => doc.body_revision > 0);
  const owners = new Map(tasks.map((task) => [task.id, task.assignee]));
  return (
    <>
      <h3>交付草稿</h3>
      <div className="project-deliverables-scroll">
        <ReadTable
          className="catalog-table project-deliverables-table"
          data={drafts}
          getRowId={(doc) => doc.id}
          label="项目交付物"
          columns={[
            {
              id: 'title',
              header: '名称',
              cell: ({ row: { original: doc } }) => (
                <button
                  className="project-title-link"
                  disabled={disabled}
                  data-project-task={doc.task_id}
                  data-project-document={doc.id}
                  onClick={() => onOpen(doc.task_id, doc.id)}
                >
                  {doc.title}
                </button>
              ),
            },
            { id: 'type', header: '类型', accessorFn: () => '任务成果草稿' },
            {
              id: 'owner',
              header: '负责人',
              accessorFn: (doc) => {
                if (!owners.has(doc.task_id)) return '';
                const owner = owners.get(doc.task_id);
                return owner === undefined ? '本人' : (owner ?? '未分配');
              },
            },
            {
              id: 'revision',
              header: '版本',
              accessorFn: (doc) => `正文修订 ${doc.body_revision}`,
            },
            // 正文修订没有正式确认、发布、固定来源或共享授权记录，保留这些列的空值。
            { id: 'review', header: '审查', cell: () => null },
            { id: 'publication', header: '发布', cell: () => null },
            { id: 'source', header: '来源', cell: () => null },
            { id: 'permissions', header: '权限', cell: () => null },
          ]}
        />
      </div>
      {!drafts.length && <p>还没有已保存的交付草稿。</p>}
      <p className="caption">正式交付视图尚未接入。审查、发布、来源和权限待正式记录接入后显示。</p>
    </>
  );
}
