import { useState } from 'react';
import type { Task } from '../../preload/caselite-api';
import { Icon, TaskTable } from './Workspace';
import TaskInspector from './TaskInspector';

export default function RecordList({
  tasks,
  documents,
  filter,
  onFilter,
  onOpen,
  onNew,
}: {
  tasks: Task[];
  documents: boolean;
  filter: string;
  onFilter(value: string): void;
  onOpen(id: string): void;
  onNew?(): void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 筛选后只显示当前结果中的属性，避免右栏仍指向已被隐藏的对象。
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;
  return (
    <section
      className={`list-view collection-workspace ${documents ? 'document-collection' : 'issue-collection'}`}
      data-layout="three-column"
      data-collection={documents ? 'documents' : 'tasks'}
    >
      <div className="collection-main">
        <div className="collection-heading">
          <Icon name={documents ? 'file' : 'check'} size={18} />
          <h1>{documents ? '文档' : '我的任务'}</h1>
          <span className="collection-total">{tasks.length}</span>
          {!documents && onNew && (
            <button data-testid="new-task" onClick={onNew}>
              新建任务
            </button>
          )}
        </div>
        {documents && (
          <div className="document-intro">
            <h2>工作成果</h2>
            <p>同一份正文，关联到它的任务。选中文档查看属性，打开后继续编辑。</p>
          </div>
        )}
        <div className="view-toolbar">
          <div className="view-tabs">
            {['全部任务', '已写正文', '未写正文'].map((value, i) => (
              <button
                key={value}
                className={filter === value ? 'current' : ''}
                aria-pressed={filter === value}
                onClick={() => onFilter(value)}
              >
                {documents ? ['全部文档', '已有修订', '待起草'][i] : value}
              </button>
            ))}
          </div>
          <span className="list-count">
            <Icon name="list" size={13} />
            列表
          </span>
        </div>
        <div className="collection-scroll">
          <TaskTable
            tasks={tasks}
            documents={documents}
            selectedId={selected?.id}
            onSelect={setSelectedId}
            onOpen={onOpen}
          />
        </div>
        <footer className="collection-footer">
          <span>
            {tasks.length} {documents ? '份成果正文' : '个任务'} · 仅此设备
          </span>
          <span>单击查看属性 · 双击或 Enter 打开</span>
        </footer>
      </div>
      <TaskInspector
        key={selected?.id ?? 'empty'}
        task={selected}
        documents={documents}
        onOpen={onOpen}
      />
    </section>
  );
}
