import { useAppearance } from './Appearance';
import { findSkin, skins } from './skins';

export default function SkinSetting() {
  const { theme, skin, pending, error, setTheme, setSkin, resetSkin, retry } = useAppearance();
  const disabled = pending || Boolean(error);
  return (
    <section className="skin-setting" aria-labelledby="skin-setting-title" aria-busy={pending}>
      <div className="theme-setting-heading">
        <div>
          <h3 id="skin-setting-title">皮肤</h3>
          <p>风格与颜色分别选择，仅改变本机界面；当前内容与工作不会重建。</p>
        </div>
        <span className="theme-current" role="status">
          {pending
            ? '正在核对…'
            : `${findSkin(skin)?.name ?? '原版外观'} · ${theme === 'dark' ? '暗黑' : '浅色'}`}
        </span>
      </div>
      {skin === undefined && (
        <p className="skin-legacy-note">尚未选择新增风格，继续沿用原版外观。</p>
      )}
      <fieldset className="skin-style-fieldset" disabled={disabled}>
        <legend>风格</legend>
        <div className="skin-style-options" role="group" aria-label="选择皮肤风格">
          {skins.map((item) => (
            <button
              type="button"
              key={item.id}
              className="skin-style-card"
              data-skin-choice={item.id}
              aria-pressed={skin === item.id}
              onClick={() => setSkin(item.id)}
            >
              <span className="skin-style-preview" aria-hidden="true">
                <i />
                <span>
                  <b />
                  <i />
                  <i />
                </span>
              </span>
              <strong>
                {item.name}
                <span aria-hidden="true">{skin === item.id ? ' ✓' : ''}</span>
              </strong>
              <span className="skin-style-description">{item.description}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="skin-color-fieldset" disabled={disabled}>
        <legend>颜色</legend>
        <div className="theme-options" role="group" aria-label="选择皮肤颜色">
          {(['light', 'dark'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className="theme-option"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <span className={`theme-swatch theme-swatch--${value}`} aria-hidden="true">
                <i />
                <span>
                  <b />
                  <i />
                  <i />
                </span>
              </span>
              <span className="theme-option-label">
                {value === 'dark' ? '暗黑' : '浅色'}
                <span aria-hidden="true">{theme === value ? ' ✓' : ''}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      {skin !== undefined && (
        <button type="button" className="skin-reset" disabled={disabled} onClick={resetSkin}>
          恢复原版风格
        </button>
      )}
      {error && (
        <div className="theme-error" role="alert">
          {error}{' '}
          <button type="button" disabled={pending} onClick={retry}>
            重新读取
          </button>
        </div>
      )}
    </section>
  );
}
