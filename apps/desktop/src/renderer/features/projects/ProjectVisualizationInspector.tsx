import { InspectorSection } from '../../shared/ui/InspectorSection';
import { PropertyValue } from '../../shared/ui/PropertyRow';
import { visualizationModes, type VisualizationInspection } from './project-visualization-model';

export default function ProjectVisualizationInspector({
  inspection,
  projectId,
  projectTitle,
  onOpen,
}: {
  inspection: VisualizationInspection | null;
  projectId: string;
  projectTitle: string;
  onOpen(taskId: string, documentId?: string): void;
}) {
  const active = inspection?.projectId === projectId ? inspection : null;
  const mode = visualizationModes[active?.mode ?? 'relations'];
  const selected = active?.selected;
  return (
    <div className="visualization-properties">
      <InspectorSection title="图示信息">
        <dl>
          <PropertyValue label="图示类型">
            {!active?.sample && active?.mode === 'relations'
              ? '项目记录归属图'
              : !active?.sample && active?.mode === 'statistics'
                ? '当前范围记录统计'
                : mode.title}
          </PropertyValue>
          <PropertyValue label="所属项目">{active?.projectTitle ?? projectTitle}</PropertyValue>
          <PropertyValue label="数据范围">
            {active?.sample ? '虚构示例 · 非项目数据' : '当前项目'}
          </PropertyValue>
          <PropertyValue label="节点 / 连线">
            {active?.nodeCount ?? 0} / {active?.edgeCount ?? 0}
          </PropertyValue>
        </dl>
      </InspectorSection>
      <InspectorSection title="选中对象">
        {selected ? (
          <>
            <h3>{selected.data.sourceTitle ?? selected.data.label}</h3>
            {selected.data.customLabel && (
              <p className="caption">自定义显示：{selected.data.customLabel}</p>
            )}
            {!active?.sample && active?.editLabel && (
              <label className="visualization-label-editor">
                显示标签
                <input
                  aria-label="显示标签"
                  maxLength={160}
                  disabled={active.readOnly || active.busy}
                  value={selected.data.customLabel ?? ''}
                  placeholder="跟随原名称"
                  onChange={(event) => active.editLabel?.(event.target.value)}
                />
                <button
                  type="button"
                  disabled={active.readOnly || active.busy || !selected.data.customLabel}
                  onClick={() => active.editLabel?.('')}
                >
                  恢复跟随来源
                </button>
                <small>仅改显示；原名称始终保留。</small>
              </label>
            )}
            {selected.data.fieldSources && (
              <details className="visualization-field-sources">
                <summary>字段来源与修订</summary>
                <dl>
                  {selected.data.fieldSources.map(([field, source]) => (
                    <PropertyValue key={field} label={field}>
                      {source}
                    </PropertyValue>
                  ))}
                </dl>
              </details>
            )}
            <dl>
              {selected.data.properties.map(([label, value]) => (
                <PropertyValue key={label} label={label}>
                  {value}
                </PropertyValue>
              ))}
            </dl>
            {selected.destination && (
              <button
                type="button"
                onClick={() =>
                  onOpen(selected.destination!.taskId, selected.destination!.documentId)
                }
              >
                打开原记录
              </button>
            )}
          </>
        ) : (
          <p className="caption">选择节点或内容查看对应属性。</p>
        )}
      </InspectorSection>
      <InspectorSection title="图示说明">
        <p>{selected?.data.description ?? mode.description}</p>
        {active?.sample ? (
          <p className="visualization-caution">
            仅供布局审查。示例出处未绑定原文，全部待人工核验。
          </p>
        ) : (
          <p className="caption">项目记录图只反映已有归属；专业图示数据尚未接入。</p>
        )}
      </InspectorSection>
      <InspectorSection title="AI 使用范围" open={false}>
        <p className="caption">
          下方沿用当前项目对话。图示、选中节点及虚构示例不会自动附加；图示专属选材与修改建议尚未接入。
        </p>
      </InspectorSection>
    </div>
  );
}
