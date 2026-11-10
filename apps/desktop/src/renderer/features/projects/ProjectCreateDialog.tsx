import { Icon } from '../../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import ProjectFields, { projectValues, validProject, type ProjectValues } from './ProjectFields';
import { DraftEditor, emptyDraft } from '../../editors/RichEditor';

type ProjectCreateValues = ProjectValues & { state?: number[] };

export default function ProjectCreateDialog({
  pending,
  unknown,
  error,
  onCreate,
  onCancel,
  onRetry,
  sourceTaskTitle,
}: {
  pending: boolean;
  unknown: boolean;
  error: string;
  onCreate(values: ProjectCreateValues): void;
  onCancel(): void;
  onRetry(): void;
  sourceTaskTitle?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    composing = useRef(false);
  const [values, setValues] = useState<ProjectValues>(() => ({
    ...projectValues(),
    title: sourceTaskTitle ?? '',
  }));
  const [dateInvalid, setDateInvalid] = useState(false);
  const [overview, setOverview] = useState(emptyDraft);
  const title = values.title;
  const locked = pending || unknown;
  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    modal?.querySelector('input')?.focus();
    return () => {
      modal?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const cancel = () => {
    if (
      !locked &&
      ((!overview.state &&
        !title.trim() &&
        JSON.stringify(values) === JSON.stringify(projectValues())) ||
        window.confirm('放弃尚未创建的项目？'))
    )
      onCancel();
  };
  return (
    <dialog
      ref={dialog}
      className="project-create-dialog"
      aria-labelledby="project-create-title"
      aria-describedby="project-create-description"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <form
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing))
            event.preventDefault();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !locked &&
            !composing.current &&
            !dateInvalid &&
            validProject(values) &&
            event.currentTarget.checkValidity()
          )
            onCreate({
              ...values,
              title: title.trim(),
              ...(overview.state ? { state: overview.state } : {}),
            });
        }}
      >
        <header>
          <div className="project-create-eyebrow" aria-label="工作区 / 项目">
            <span>
              <Icon name="folder" size={15} />
              工作区
            </span>
            <span aria-hidden="true">›</span>
            <span>
              <Icon name="folder" size={15} />
              项目
            </span>
          </div>
          <button type="button" aria-label="关闭新建项目" disabled={locked} onClick={cancel}>
            ×
          </button>
        </header>
        <div className="project-create-content">
          <span className="project-create-symbol">
            <Icon name="folder" size={24} />
          </span>
          <h2 id="project-create-title" className="sr-only">
            {sourceTaskTitle ? '从任务创建项目' : '新建项目'}
          </h2>
          <p
            id="project-create-description"
            className={sourceTaskTitle ? 'project-create-source' : 'sr-only'}
          >
            {sourceTaskTitle
              ? `将“${sourceTaskTitle}”作为项目中的首个任务。原任务、材料与正文保持原样。`
              : '用项目组织相关任务。填写项目属性和概述，创建后继续编辑。'}
          </p>
          <div className="project-create-attributes">
            <ProjectFields
              value={values}
              disabled={locked}
              creating
              onChange={setValues}
              onInvalid={setDateInvalid}
            />
          </div>
          <div className="project-create-overview">
            <DraftEditor
              value={overview}
              onChange={setOverview}
              label="项目概述"
              testId="project-create-overview"
              placeholder="填写项目概述…"
              profile="description"
              disabled={locked}
            />
          </div>
          {(dateInvalid || (title.trim() && !validProject(values))) && (
            <p role="alert">请核对日期、负责人和标签格式，输入已保留。</p>
          )}
          {error && (
            <p role="alert" className="project-create-error">
              {error}
            </p>
          )}
          {unknown && (
            <button type="button" disabled={pending} onClick={onRetry}>
              核对原提交
            </button>
          )}
        </div>
        <footer>
          <span role="status">
            {pending
              ? '正在保存项目…'
              : unknown
                ? '结果待核对，请勿重复创建。'
                : sourceTaskTitle
                  ? '创建后继续使用原任务'
                  : '仅保存在此设备 · 无需账号'}
          </span>
          <button
            className="primary"
            type="submit"
            disabled={!validProject(values) || dateInvalid || locked}
          >
            创建项目
          </button>
        </footer>
      </form>
    </dialog>
  );
}
