import { Icon } from '../../shared/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import ProjectFields, { projectValues, validProject, type ProjectValues } from './ProjectFields';

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
  onCreate(values: ProjectValues): void;
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
      ((!title.trim() && JSON.stringify(values) === JSON.stringify(projectValues())) ||
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
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !locked &&
            !composing.current &&
            !dateInvalid &&
            validProject(values) &&
            event.currentTarget.checkValidity()
          )
            onCreate({ ...values, title: title.trim() });
        }}
      >
        <header>
          <span className="project-create-eyebrow">
            <Icon name="folder" size={15} /> 工作区 / 项目
          </span>
          <button type="button" aria-label="关闭新建项目" disabled={locked} onClick={cancel}>
            ×
          </button>
        </header>
        <div className="project-create-content">
          <span className="project-create-symbol">
            <Icon name="folder" size={24} />
          </span>
          <h2 id="project-create-title">{sourceTaskTitle ? '从任务创建项目' : '新建项目'}</h2>
          <p id="project-create-description">
            {sourceTaskTitle
              ? `将“${sourceTaskTitle}”作为项目中的首个任务。原任务、材料与正文保持原样。`
              : '用项目组织相关任务。选择项目属性，创建后完善概述。'}
          </p>
          <div
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
          >
            <ProjectFields
              value={values}
              disabled={locked}
              creating
              onChange={setValues}
              onInvalid={setDateInvalid}
            />
          </div>
          {(dateInvalid || (title.trim() && !validProject(values))) && (
            <p role="alert">请核对日期、负责人和标签格式，输入已保留。</p>
          )}
          <span className="project-create-hint">仅保存在此设备 · 无需账号</span>
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
                  : '创建后打开项目概述'}
          </span>
          <button type="button" disabled={locked} onClick={cancel}>
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={!validProject(values) || dateInvalid || locked}
          >
            保存项目
          </button>
        </footer>
      </form>
    </dialog>
  );
}
