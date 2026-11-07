import { useState } from 'react';
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
  return (
    <div className="catalog-actions" data-project-id={data.project.id}>
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
        disabled={!dirty || pending || archived || !draft.state}
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
        保存项目概述
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (!dirty || window.confirm('放弃当前未保存修改并重新读取项目？')) onReload();
        }}
      >
        放弃修改并重读
      </button>
      {error && <p role="alert">项目说明保存失败。{error}</p>}
      {unknown && <button onClick={onRetry}>核对原说明提交</button>}
      <p role="status">
        {dirty ? '有未保存的说明修改，请保存后切换。' : `说明修订 ${data.project.body_revision}`}
      </p>
    </div>
  );
}
