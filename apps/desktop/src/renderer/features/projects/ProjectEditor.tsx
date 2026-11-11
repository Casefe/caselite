import { useRef, useState } from 'react';
import type { Matter } from '../../../preload/caselite-api';
import { DraftEditor, type RichDraft } from '../../editors/RichEditor';

export default function ProjectEditor({
  data,
  pending,
  disabled,
  archived,
  unknown,
  error,
  onRetry,
  onDirty,
  onSave,
  onReload,
}: {
  data: { project: Matter; state: number[] | null };
  pending: boolean;
  disabled: boolean;
  archived: boolean;
  unknown: boolean;
  error: string;
  onRetry(): void;
  onDirty(v: boolean): void;
  onSave(state: number[], onCommitted: () => void): Promise<void>;
  onReload(): void;
}) {
  const [draft, setDraft] = useState<RichDraft>(() => ({ text: '', state: data.state }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const composing = useRef(false);
  return (
    <div
      className="catalog-actions"
      data-project-id={data.project.id}
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onKeyDownCapture={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          return;
        if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget
          .querySelector<HTMLButtonElement>('[data-save-project-overview]')
          ?.click();
      }}
    >
      <h2>项目概述</h2>
      <DraftEditor
        value={draft}
        onChange={(v) => {
          setDraft(v);
          setDirty(true);
          onDirty(true);
        }}
        label="项目概述"
        testId="project-overview-editor"
        profile="description"
        disabled={disabled || archived || saving}
      />
      <button
        className="primary"
        data-save-project-overview
        aria-keyshortcuts="Meta+Enter Control+Enter"
        title="保存项目概述（⌘ / Ctrl + Enter）"
        disabled={disabled || saving || !dirty || pending || archived || !draft.state}
        onClick={() => {
          if (draft.state) {
            setSaving(true);
            void onSave(draft.state, () => {
              setDirty(false);
              onDirty(false);
            }).finally(() => setSaving(false));
          }
        }}
      >
        {saving ? '正在保存项目概述…' : '保存项目概述'}
      </button>
      <button
        disabled={pending || saving}
        onClick={() => {
          if (!dirty || window.confirm('放弃当前未保存修改并重新读取项目？')) onReload();
        }}
      >
        放弃修改并重读
      </button>
      {error && <p role="alert">项目说明保存失败。{error}</p>}
      {unknown && <button onClick={onRetry}>核对原说明提交</button>}
      <p role="status">
        {saving
          ? '正在保存项目概述…'
          : dirty
            ? '说明尚未保存 · ⌘ / Ctrl + Enter 保存'
            : '项目概述已保存'}
      </p>
    </div>
  );
}
