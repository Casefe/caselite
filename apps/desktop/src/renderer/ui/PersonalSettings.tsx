import StatisticsSettings from '../shared/statistics/StatisticsSettings';
import { useLocalPreferences } from '../shared/data/LocalPreferences';
export default function PersonalSettings({
  preferencesOnly = false,
}: {
  preferencesOnly?: boolean;
}) {
  const s = useLocalPreferences(),
    disabled = s.pending || s.phase !== 'idle';
  return (
    <form
      className="personal-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void s.save();
      }}
    >
      {preferencesOnly ? (
        <label className="setting-row">
          <span>
            显示字数<small>包含标点，不含空白；仅改变显示。</small>
          </span>
          <input
            aria-label="显示字数"
            type="checkbox"
            disabled={disabled}
            checked={s.draft.show_word_count}
            onChange={(e) => s.change({ show_word_count: e.target.checked })}
          />
        </label>
      ) : (
        <>
          <label>
            图标
            <select
              aria-label="个人图标"
              value={s.draft.avatar}
              disabled={disabled}
              onChange={(e) => s.change({ avatar: e.target.value as 'portrait' | 'initials' })}
            >
              <option value="portrait">律师头像</option>
              <option value="initials">姓名首字</option>
            </select>
          </label>
          <label>
            名称
            <input
              aria-label="个人名称"
              value={s.draft.name}
              maxLength={80}
              disabled={disabled}
              onChange={(e) => s.change({ name: e.target.value })}
            />
          </label>
          <label>
            电子邮箱
            <input
              aria-label="个人电子邮箱"
              type="email"
              value={s.draft.email}
              maxLength={254}
              disabled={disabled}
              onChange={(e) => s.change({ email: e.target.value })}
            />
          </label>
          <p>仅保存到当前本地工作区；不注册云端账户，不发送邮件。</p>
        </>
      )}
      {preferencesOnly && (
        <StatisticsSettings
          value={s.draft.statistics_cards}
          disabled={disabled}
          onChange={(statistics_cards) => s.change({ statistics_cards })}
        />
      )}
      {s.error && <p role="alert">{s.error}</p>}
      {s.notice && <p role="status">{s.notice}</p>}
      <div className="personal-settings-actions">
        <button type="submit" disabled={disabled || !s.dirty}>
          {s.pending ? '正在读取或保存…' : '保存个人设置'}
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
