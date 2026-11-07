import { Icon } from '../shared/ui/Icon';
import type { CatalogDocument, Matter } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import TaskTags from './TaskTags';

export default function DocumentInspector({
  document,
  project,
  blocked,
  tagDraft,
  tagsDisabled,
  tagsLocked,
  tagEditor,
  suggestions,
  onTags,
  onTagDraft,
}: {
  document?: CatalogDocument;
  project?: Matter;
  blocked: boolean;
  tagDraft: boolean;
  tagsDisabled: boolean;
  tagsLocked: boolean;
  tagEditor: number;
  suggestions: string[];
  onTags(tags: string[], added?: boolean): void;
  onTagDraft(dirty: boolean): void;
}) {
  return (
    <aside className="task-inspector" aria-label="文档属性与 AI 侧边栏">
      {document ? (
        <div className="inspector-content task-inspector-content" aria-label="文档属性">
          <details className="inspector-disclosure" open>
            <summary>属性</summary>
            <dl className="inspector-property-list document-property-values">
              <div className="inspector-property-row">
                <dt className="inspector-property-label">文档版本</dt>
                <dd>{document.body_revision}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">关联项目</dt>
                <dd>{project?.title ?? (document.matter_id ? '已归组' : '未归组')}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">关联任务</dt>
                <dd>{document.title}</dd>
              </div>
              <div className="inspector-property-row">
                <dt className="inspector-property-label">文档 ID</dt>
                <dd className="record-id">{document.id}</dd>
              </div>
            </dl>
          </details>
          <section className="project-inspector-section task-label-section" aria-label="文档标签">
            <h3>标签</h3>
            {document.archived_at && !tagDraft ? (
              <p>{document.tags.join('、') || '无标签'}</p>
            ) : (
              <TaskTags
                key={tagEditor}
                tags={document.tags}
                suggestions={suggestions}
                disabled={tagsDisabled}
                lockDraft={tagsLocked}
                retainDraftOnAdd
                onDemand
                onChange={onTags}
                onDraft={onTagDraft}
              />
            )}
          </section>
          <section aria-label="AI 对话" className="project-inspector-section">
            <h3>AI 对话</h3>
            <SidebarAgent
              taskId={document.archived_at ? undefined : document.task_id}
              blocked={blocked}
              unavailable={document.archived_at ? '文档已归档，恢复后可使用 AI 对话。' : undefined}
            />
          </section>
        </div>
      ) : (
        <div className="inspector-content inspector-empty">
          <Icon name="file" size={24} />
          <h2>选择文档</h2>
        </div>
      )}
    </aside>
  );
}
