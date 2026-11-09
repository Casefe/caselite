import { PropertyValue } from '../shared/ui/PropertyRow';
import { InspectorSection } from '../shared/ui/InspectorSection';
import { Icon } from '../shared/ui/Icon';
import type { CatalogDocument, Matter } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import InspectorLayout from './InspectorLayout';
import TagPicker from '../shared/ui/TagPicker';
import { DocumentVersions } from '../features/documents/DocumentVersions';
import type { FormatExample } from '../features/documents/DocumentFormatExamples';

export function DocumentPropertyValues({
  revision,
  projectTitle,
  taskTitle,
  documentId,
}: {
  revision: number;
  projectTitle: string;
  taskTitle: string;
  documentId: string;
}) {
  return (
    <InspectorSection title="属性">
      <dl className="inspector-property-list document-property-values">
        <PropertyValue label="文档版本">{revision}</PropertyValue>
        <PropertyValue label="关联项目">{projectTitle}</PropertyValue>
        <PropertyValue label="关联任务">{taskTitle}</PropertyValue>
        <PropertyValue label="文档 ID" valueClassName="record-id">
          {documentId}
        </PropertyValue>
      </dl>
    </InspectorSection>
  );
}

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
  selectedVersion = null,
  onVersion,
  example,
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
  selectedVersion?: string | null;
  onVersion?(id: string | null): void;
  example?: FormatExample;
}) {
  return (
    <aside className="task-inspector" aria-label="文档属性与 AI 侧边栏">
      {document ? (
        <InspectorLayout
          blocked={blocked}
          properties={
            <div className="inspector-content task-inspector-content" aria-label="文档属性">
              <DocumentPropertyValues
                revision={document.body_revision}
                projectTitle={project?.title ?? (document.matter_id ? '已归组' : '未归组')}
                taskTitle={document.title}
                documentId={document.id}
              />
              {onVersion && (
                <DocumentVersions
                  document={document}
                  selected={selectedVersion}
                  disabled={blocked}
                  onSelect={onVersion}
                />
              )}
              <section
                className="project-inspector-section task-label-section"
                aria-label="文档标签"
              >
                <h3>标签</h3>
                {document.archived_at && !tagDraft ? (
                  <p>{document.tags.join('、') || '无标签'}</p>
                ) : (
                  <TagPicker
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
            </div>
          }
        >
          <SidebarAgent
            document={{
              id: document.id,
              revision: document.body_revision,
              archived: !!document.archived_at,
            }}
            taskId={document.archived_at || selectedVersion ? undefined : document.task_id}
            blocked={blocked || !!selectedVersion}
            unavailable={
              selectedVersion
                ? '当前查看固定版本，返回工作稿后可使用 AI 对话。'
                : document.archived_at
                  ? '文档已归档，恢复后可使用 AI 对话。'
                  : undefined
            }
          />
        </InspectorLayout>
      ) : example ? (
        <InspectorLayout
          properties={
            <div className="inspector-content">
              <InspectorSection title="属性">
                <dl className="inspector-property-list">
                  <PropertyValue label="名称">{example.title}</PropertyValue>
                  <PropertyValue label="格式">{example.format}</PropertyValue>
                  <PropertyValue label="来源">合成格式示例</PropertyValue>
                </dl>
              </InspectorSection>
              <section className="document-versions">
                <h3>版本</h3>
                <p>示例版本 1</p>
                <p className="caption">示例修改不形成已保存的文档修订。</p>
              </section>
            </div>
          }
        >
          <p className="caption">合成示例未关联任务，不发送至AI。</p>
        </InspectorLayout>
      ) : (
        <div className="inspector-content inspector-empty">
          <Icon name="file" size={24} />
          <h2>选择文档</h2>
        </div>
      )}
    </aside>
  );
}
