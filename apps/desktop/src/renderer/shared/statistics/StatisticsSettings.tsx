import type { LocalPreferenceValues } from '../../../preload/caselite-api';
import { statisticsModules, statisticsPreferences } from './statistics-preferences';

export default function StatisticsSettings({
  value,
  disabled,
  onChange,
}: {
  value: LocalPreferenceValues['statistics_cards'];
  disabled: boolean;
  onChange(value: NonNullable<LocalPreferenceValues['statistics_cards']>): void;
}) {
  const settings = statisticsPreferences(value);
  return (
    <fieldset className="statistics-settings" disabled={disabled}>
      <legend>右侧统计卡片</legend>
      <p>按模块启用。右上在属性前，右中在属性后，右下在属性栏末尾、AI 上方。</p>
      {statisticsModules.map(({ id, label }) => (
        <div className="statistics-setting-row" key={id}>
          <label>
            <input
              type="checkbox"
              aria-label={`启用${label}统计`}
              disabled={id === 'contacts'}
              checked={settings[id].enabled}
              onChange={(event) =>
                onChange({ ...settings, [id]: { ...settings[id], enabled: event.target.checked } })
              }
            />
            {label}
            {id === 'contacts' ? '（暂不启用）' : ''}
          </label>
          <label>
            <span>位置</span>
            <select
              aria-label={`${label}统计位置`}
              value={settings[id].position}
              disabled={id === 'contacts' || !settings[id].enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  [id]: {
                    ...settings[id],
                    position: event.target.value as 'top' | 'middle' | 'bottom',
                  },
                })
              }
            >
              <option value="top">右上</option>
              <option value="middle">右中</option>
              <option value="bottom">右下</option>
            </select>
          </label>
        </div>
      ))}
    </fieldset>
  );
}
