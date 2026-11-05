import { useState } from 'react';
import type { Task } from '../../preload/caselite-api';
import { Icon } from './Workspace';

export default function TaskInspector({ task }: { task: Task }) {
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
      {tab === 'properties' ? (
        <div className="inspector-content" role="tabpanel" aria-label="任务属性">
          <div className="inspector-heading">
            <Icon name="check" />
            <span>当前任务</span>
          </div>
          <h2>{task.title}</h2>
          <p className="inspector-objective">{task.objective || '尚未填写工作目标。'}</p>
          <h3>属性</h3>
          <dl>
            <dt>所属项目</dt>
            <dd>未归组</dd>
            <dt>工作范围</dt>
            <dd>个人本地</dd>
            <dt>成果</dt>
            <dd>内部沟通初稿</dd>
            <dt>正文修订</dt>
            <dd>{task.body_revision}</dd>
            <dt>最近更新</dt>
            <dd>{new Date(task.updated_at).toLocaleDateString('zh-CN')}</dd>
          </dl>
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
            <h2>围绕当前任务工作</h2>
            <p>梳理材料、比较矛盾、协助起草。</p>
          </div>
          <div className="ai-context">
            <Icon name="check" size={15} />
            <span>{task.title}</span>
          </div>
          <div className="ai-status">
            <span className="draft-badge">尚未接入</span>
            <p>AI 与材料读取尚未接线。当前可继续在中间编辑并保存正文。</p>
          </div>
          <div className="ai-capabilities">
            <h3>后续可用的工作方式</h3>
            <p>梳理事实与出处</p>
            <p>对照矛盾与缺件</p>
            <p>形成内部沟通初稿</p>
          </div>
          <div className="ai-composer">
            <textarea
              aria-label="AI 工作要求（尚未接入）"
              disabled
              placeholder="接入模型后，在这里输入工作要求…"
            />
            <div>
              <span>未连接模型 · 不会发送材料</span>
              <button disabled aria-label="发送 AI 工作要求">
                ↑
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
