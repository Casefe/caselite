import { useState } from 'react';
import type { Task } from '../../preload/caselite-api';
import { Icon } from './Workspace';
import AgentPanel from './AgentPanel';
import TaskProjectAction from '../projects/TaskProjectAction';

export default function TaskInspector({
  task,
  documents = false,
  onOpen,
  onProjectChanged,
  onProjectDirty,
  projectDisabled = false,
}: {
  task: Task | null;
  documents?: boolean;
  onOpen?(id: string): void;
  onProjectChanged?(task: Task): void;
  onProjectDirty?(dirty: boolean): void;
  projectDisabled?: boolean;
}) {
  const [tab, setTab] = useState<'properties' | 'ai'>('properties');
  return (
    <aside className="task-inspector" aria-label="属性与 AI 侧边栏">
      <div className="inspector-tabs" role="tablist" aria-label="侧边栏栏目">
        <button
          role="tab"
          aria-selected={tab === 'properties'}
          onClick={() => setTab('properties')}
        >
          <Icon name="panel" size={15} /> 属性
        </button>
        <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
          <Icon name="spark" size={15} /> AI 助手
        </button>
      </div>
      {!task ? (
        <div className="inspector-content inspector-empty">
          <Icon name={documents ? 'file' : 'check'} size={24} />
          <h2>选择{documents ? '文档' : '任务'}</h2>
          <p>列表有结果后，在这里查看属性与使用 AI 助手。</p>
        </div>
      ) : tab === 'properties' ? (
        <div
          className="inspector-content"
          role="tabpanel"
          aria-label={documents ? '文档属性' : '任务属性'}
        >
          <div className="inspector-heading">
            <Icon name={documents ? 'file' : 'check'} />
            <span>{documents ? '成果文档' : '当前任务'}</span>
          </div>
          <h2>
            {task.title}
            {documents ? ' · 初稿' : ''}
          </h2>
          {onOpen && (
            <button
              className="inspector-open"
              data-testid="inspector-open"
              onClick={() => onOpen(task.id)}
            >
              <Icon name="file" size={14} />
              {documents ? '打开文档' : '打开任务'}
              <Icon name="chevron" size={13} />
            </button>
          )}
          <p className="inspector-objective">{task.objective || '尚未填写工作目标。'}</p>
          <h3>属性</h3>
          <dl>
            {documents && (
              <>
                <dt>关联任务</dt>
                <dd>{task.title}</dd>
                <dt>文档 ID</dt>
                <dd className="record-id">{task.document_id}</dd>
              </>
            )}

            <dt>所属项目</dt>
            <dd>{task.matter_title ?? (task.matter_id ? '已归组' : '未归组')}</dd>
            <dt>工作范围</dt>
            <dd>个人本地</dd>
            <dt>成果</dt>
            <dd>内部沟通初稿</dd>
            <dt>正文修订</dt>
            <dd>{task.body_revision}</dd>
            <dt>最近更新</dt>
            <dd>{new Date(task.updated_at).toLocaleDateString('zh-CN')}</dd>
          </dl>
          {!documents && onProjectChanged && onProjectDirty && (
            <TaskProjectAction
              task={task}
              disabled={projectDisabled}
              onChanged={onProjectChanged}
              onDirty={onProjectDirty}
            />
          )}
          <hr />
          <div className="property-note">
            <Icon name="file" size={16} />
            <p>
              保存不代表定稿。
              <br />
              引用与结论仍需人工核对。
            </p>
          </div>
        </div>
      ) : (
        <div className="ai-inspector" role="tabpanel" aria-label="AI 助手">
          <div className="ai-heading">
            <span className="ai-symbol">
              <Icon name="spark" size={23} />
            </span>
            <h2>{documents ? '围绕关联任务工作' : '围绕当前任务工作'}</h2>
            <p>
              {documents
                ? '与关联任务共用会话，正文不会自动发送。'
                : '梳理材料、比较矛盾、协助起草。'}
            </p>
          </div>
          <div className="ai-context">
            <Icon name="check" size={15} />
            <span>{task.title}</span>
          </div>
          <AgentPanel key={task.id} scope={task.id} />
        </div>
      )}
    </aside>
  );
}
