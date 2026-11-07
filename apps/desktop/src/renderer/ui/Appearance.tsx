import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Theme } from '../../preload/caselite-api';

type AppearanceState = {
  theme: Theme;
  pending: boolean;
  error: string;
  setTheme(theme: Theme): void;
  retry(): void;
};
const AppearanceContext = createContext<AppearanceState>({
  theme: 'light',
  pending: true,
  error: '',
  setTheme() {},
  retry() {},
});
export const useAppearance = () => useContext(AppearanceContext);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void window.caselite
      .appearance({ protocol_version: 1, operation: 'read' })
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setTheme(result.theme);
          setError('');
        } else setError(result.message);
      })
      .catch(() => {
        if (active) setError('无法读取主题设置，请重试。');
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);
  const choose = (next: Theme) => {
    if (pending || error || next === theme) return;
    setPending(true);
    void window.caselite
      .appearance({ protocol_version: 1, operation: 'set', theme: next })
      .then((result) => {
        if (result.ok) {
          setTheme(result.theme);
          setError('');
        } else setError(result.message);
      })
      .catch(() => setError('无法确认主题是否保存，请重新读取。'))
      .finally(() => setPending(false));
  };
  return (
    <AppearanceContext.Provider
      value={{
        theme,
        pending,
        error,
        setTheme: choose,
        retry: () => {
          setPending(true);
          setAttempt((n) => n + 1);
        },
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export function ThemeSetting() {
  const { theme, pending, error, setTheme, retry } = useAppearance();
  return (
    <section className="theme-setting" aria-labelledby="theme-setting-title">
      <div className="theme-setting-heading">
        <div>
          <h3 id="theme-setting-title">主题</h3>
          <p>选择适合你工作环境的外观，设置保存在此设备。</p>
        </div>
        <span className="theme-current">
          {pending ? '读取中…' : theme === 'light' ? '浅色' : '深色'}
        </span>
      </div>
      <div className="theme-options" role="group" aria-label="选择主题">
        {(['light', 'dark'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className="theme-option"
            aria-pressed={theme === value}
            disabled={pending || Boolean(error)}
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
              {value === 'light' ? '浅色' : '深色'}
              <span aria-hidden="true">{theme === value ? '✓' : ''}</span>
            </span>
          </button>
        ))}
      </div>
      {error && (
        <div className="theme-error" role="alert">
          {error}{' '}
          <button type="button" onClick={retry} disabled={pending}>
            重新读取
          </button>
        </div>
      )}
    </section>
  );
}
