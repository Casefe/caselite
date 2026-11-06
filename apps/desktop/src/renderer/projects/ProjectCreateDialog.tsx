import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Workspace';

export default function ProjectCreateDialog({
  pending,
  unknown,
  error,
  onCreate,
  onCancel,
  onRetry,
}: {
  pending: boolean;
  unknown: boolean;
  error: string;
  onCreate(title: string): void;
  onCancel(): void;
  onRetry(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    name = useRef<HTMLInputElement>(null),
    composing = useRef(false);
  const [title, setTitle] = useState('');
  const locked = pending || unknown;
  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    name.current?.focus();
    return () => {
      modal?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const cancel = () => {
    if (!locked && (!title.trim() || window.confirm('放弃尚未创建的项目？'))) onCancel();
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
          if (!locked && !composing.current && title.trim()) onCreate(title.trim());
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
          <h2 id="project-create-title">新建项目</h2>
          <p id="project-create-description">用项目组织相关任务。先起一个名称，创建后完善概述。</p>
          <label htmlFor="project-create-name">项目名称</label>
          <input
            ref={name}
            id="project-create-name"
            aria-label="项目名称"
            value={title}
            maxLength={160}
            placeholder="例如：示例合同审查"
            autoComplete="off"
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
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
          />
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
                : '创建后打开项目概述'}
          </span>
          <button type="button" disabled={locked} onClick={cancel}>
            取消
          </button>
          <button className="primary" type="submit" disabled={!title.trim() || locked}>
            保存项目
          </button>
        </footer>
      </form>
    </dialog>
  );
}
