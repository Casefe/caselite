import { useLocalPreferences } from '../shared/data/LocalPreferences';
import ExportStyleSettings from './ExportStyleSettings';
import WritingSkillsSettings from './WritingSkillsSettings';

export default function EditorSettings() {
  const s = useLocalPreferences();
  const disabled = s.pending || s.phase !== 'idle';
  const selected = s.draft.editor_mode ?? 'markdown';
  return (
    <form
      className="editor-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void s.save();
      }}
    >
      <p className="editor-settings-intro">选择适合你的写作方式，应用于成果文档。</p>
      <fieldset disabled={disabled}>
        <legend>编辑方案</legend>
        <div className="editor-scheme-options">
          {(
            [
              ['markdown', 'Markdown', '所见即所得，支持 Markdown 快捷输入、斜杠菜单和选区格式。'],
              ['word', 'Word', '常驻基础工具栏与连续纸张视图，便于排版和阅读。'],
            ] as const
          ).map(([value, title, description]) => (
            <label className="editor-scheme-option" key={value} data-selected={selected === value}>
              <input
                type="radio"
                aria-label={title}
                name="editor-scheme"
                value={value}
                checked={selected === value}
                onChange={() => s.change({ editor_mode: value })}
              />
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="editor-settings-note">
        保存后生效，正文和已有格式会保留。Word
        当前为连续纸张视图，尚不提供编辑时自动分页。导出页眉页脚在下方独立设置。
      </p>
      <ExportStyleSettings disabled={disabled} />
      <WritingSkillsSettings disabled={disabled} />
      {s.error && <p role="alert">{s.error}</p>}
      {s.notice && <p role="status">{s.notice}</p>}
      <div className="personal-settings-actions">
        <button type="submit" disabled={disabled || !s.dirty}>
          保存编辑器设置
        </button>
        <button type="button" disabled={disabled} onClick={() => void s.reload()}>
          重新读取（保留输入）
        </button>
        {s.phase === 'verify' && (
          <button type="button" disabled={s.pending} onClick={() => void s.verify()}>
            核对保存结果
          </button>
        )}
        {s.phase === 'retry' && (
          <button type="button" disabled={s.pending} onClick={() => void s.retry()}>
            重试原提交
          </button>
        )}
      </div>
    </form>
  );
}
