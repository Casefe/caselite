import { Icon } from '../shared/ui/Icon';
import { useState } from 'react';

export default function KnowledgeView({ onHome }: { onHome(): void }) {
  const [tab, setTab] = useState<'properties' | 'ai'>('properties');
  return (
    <section className="knowledge-view" data-layout="three-column" aria-label="知识库">
      <div className="collection-main">
        <div className="collection-heading">
          <Icon name="book" size={18} />
          <h1>知识库</h1>
        </div>
        <div className="project-tab-empty">
          <Icon name="book" size={34} />
          <h2>让工作经验可以复用</h2>
          <p>知识库与受控复用将在后续版本开放。</p>
          <button onClick={onHome}>返回首页</button>
        </div>
      </div>
      <aside className="task-inspector" aria-label="知识库属性与 AI 侧边栏">
        <div className="inspector-tabs" role="tablist" aria-label="知识库侧边栏栏目">
          <button
            role="tab"
            aria-selected={tab === 'properties'}
            onClick={() => setTab('properties')}
          >
            <Icon name="panel" size={15} />
            属性
          </button>
          <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
            <Icon name="spark" size={15} />
            AI 助手
          </button>
        </div>
        <div className="inspector-content" role="tabpanel">
          <h2>{tab === 'properties' ? '知识属性' : '知识库 AI'}</h2>
          <p className="caption">
            {tab === 'properties'
              ? '选定知识条目后，在这里查看来源、范围和版本。当前尚未开放知识条目。'
              : '知识库接入后，可围绕选定条目使用 AI。当前不会读取或发送任何知识资料。'}
          </p>
        </div>
      </aside>
    </section>
  );
}
