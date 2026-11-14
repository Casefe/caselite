import { PropertyValue } from '../shared/ui/PropertyRow';
import { InspectorSection } from '../shared/ui/InspectorSection';
import { Icon } from '../shared/ui/Icon';
import type { CatalogDocument, Matter, PersonalMaterial } from '../../preload/caselite-api';
import SidebarAgent from './SidebarAgent';
import InspectorLayout from './InspectorLayout';
import TagPicker from '../shared/ui/TagPicker';
import { DocumentVersions } from '../features/documents/DocumentVersions';
import type { BodySaveState } from '../features/documents/BodyEditor';

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
  activeSource,
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
  saveState,
}: {
  document?: CatalogDocument;
  activeSource?: PersonalMaterial;
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
  saveState?: BodySaveState | null;
}) {
  return (
    <aside className="task-inspector" aria-label="文档属性与 AI 侧边栏">
      {document || activeSource ? (
        <InspectorLayout
          blocked={blocked}
          properties={
            <div className="inspector-content task-inspector-content" aria-label="文档属性">
              {activeSource ? (
                <InspectorSection title="原件属性">
                  <dl className="inspector-property-list document-property-values">
                    <PropertyValue label="文件名">{activeSource.name}</PropertyValue>
                    <PropertyValue label="类型">{activeSource.kind.toUpperCase()}</PropertyValue>
                    <PropertyValue label="大小">{activeSource.bytes} 字节</PropertyValue>
                    <PropertyValue label="SHA-256" valueClassName="record-id">
                      {activeSource.sha256}
                    </PropertyValue>
                  </dl>
                </InspectorSection>
              ) : (
                document && (
                  <>
                    <DocumentPropertyValues
                      revision={document.body_revision}
                      projectTitle={project?.title ?? (document.matter_id ? '已归组' : '未归组')}
                      taskTitle={document.title}
                      documentId={document.id}
                    />
                    {saveState && saveState.bodyId === document.body_id && !selectedVersion && (
                      <InspectorSection title="保存状态">
                        <p role="status" aria-label="文档保存状态">
                          {saveState.message}
                        </p>
                        {(saveState.phase === 'unknown' || saveState.phase === 'failed') && (
                          <button disabled={!saveState.canRetry} onClick={saveState.retry}>
                            核对保存结果
                          </button>
                        )}
                      </InspectorSection>
                    )}
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
                  </>
                )
              )}
            </div>
          }
        >
          {document ? (
            <SidebarAgent
              document={{
                id: document.id,
                revision: document.body_revision,
                archived: !!document.archived_at,
              }}
              taskId={document.archived_at || selectedVersion ? undefined : document.task_id}
              blocked={blocked || !!selectedVersion || !!activeSource}
              unavailable={
                activeSource
                  ? '当前查看本地原件，AI 对话仍属于原文档；返回文档后可继续。'
                  : selectedVersion
                    ? '当前查看固定版本，返回工作稿后可使用 AI 对话。'
                    : document.archived_at
                      ? '文档已归档，恢复后可使用 AI 对话。'
                      : undefined
              }
            />
          ) : (
            <p>当前原件尚未加入 AI 对话。</p>
          )}
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
