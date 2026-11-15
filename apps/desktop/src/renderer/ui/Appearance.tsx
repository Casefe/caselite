import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppearanceRequest,
  AppearanceValues,
  SkinId,
  Theme,
} from '../../preload/caselite-api';
import { applyAppearanceTheme, readAppearanceSeed } from './appearance-theme';
import { SkinContext } from './skins/context';

type AppearanceState = {
  theme: Theme;
  skin?: SkinId;
  pending: boolean;
  error: string;
  setTheme(theme: Theme): void;
  setSkin(skin: SkinId): void;
  resetSkin(): void;
  retry(): void;
};
const AppearanceContext = createContext<AppearanceState>({
  theme: 'light',
  pending: true,
  error: '',
  setTheme() {},
  setSkin() {},
  resetSkin() {},
  retry() {},
});
export const useAppearance = () => useContext(AppearanceContext);

let motionGeneration = 0;
let operationGeneration = 0;
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readAppearanceSeed().theme);
  const [skin, setSkin] = useState<SkinId | undefined>(() => readAppearanceSeed().skin);
  const [resolved, setResolved] = useState(() => readAppearanceSeed().ready);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const locked = useRef(true);
  const synchronize = useCallback(async (next: AppearanceValues, token: number) => {
    if (token !== sequence.current) return;
    const root = document.documentElement;
    const generation = String(++motionGeneration);
    root.dataset.themeChanging = generation;
    // 只应用原Owner已经返回的完整快照；未知保存回执不能提前换肤。
    applyAppearanceTheme(next.theme, next.skin);
    setTheme(next.theme);
    setSkin(next.skin);
    try {
      const applied = await window.caselite.appearance({
        protocol_version: 1,
        operation: 'applied',
        theme: next.theme,
        skin: next.skin ?? null,
      });
      if (token !== sequence.current) return;
      if (!applied.ok || applied.theme !== next.theme || applied.skin !== next.skin) {
        setError(applied.ok ? '窗口外观未同步，请重新读取。' : applied.message);
        return;
      }
      setResolved(true);
      setError('');
    } finally {
      const frame =
        window.requestAnimationFrame ??
        ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
      frame(() =>
        frame(() => {
          if (root.dataset.themeChanging === generation) delete root.dataset.themeChanging;
        }),
      );
    }
  }, []);
  useEffect(() => {
    const token = ++operationGeneration;
    sequence.current = token;
    locked.current = true;
    void window.caselite
      .appearance({ protocol_version: 1, operation: 'read' })
      .then(async (result) => {
        if (token !== sequence.current) return;
        if (result.ok) await synchronize(result, token);
        else setError(result.message);
      })
      .catch(() => {
        if (token === sequence.current) setError('无法读取或同步外观设置，请重新读取。');
      })
      .finally(() => {
        if (token === sequence.current) {
          locked.current = false;
          setPending(false);
        }
      });
    return () => {
      sequence.current = -1;
    };
  }, [attempt, synchronize]);
  const choose = (request: Exclude<AppearanceRequest, { operation: 'read' | 'applied' }>) => {
    if (locked.current || error) return;
    if (request.operation === 'set' && request.theme === theme) return;
    if (request.operation === 'set_skin' && request.skin === skin) return;
    if (request.operation === 'reset_skin' && skin === undefined) return;
    locked.current = true;
    const token = ++operationGeneration;
    sequence.current = token;
    setPending(true);
    void window.caselite
      .appearance(request)
      .then(async (result) => {
        if (token !== sequence.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const matches =
          request.operation === 'set'
            ? result.theme === request.theme
            : request.operation === 'set_skin'
              ? result.skin === request.skin
              : result.skin === undefined;
        if (!matches) {
          setError('外观保存回执不一致，请重新读取；未自动重试。');
          return;
        }
        await synchronize(result, token);
      })
      .catch(() => {
        if (token === sequence.current) setError('无法确认外观是否保存或同步，请重新读取。');
      })
      .finally(() => {
        if (token === sequence.current) {
          locked.current = false;
          setPending(false);
        }
      });
  };
  const retry = useCallback(() => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setAttempt((n) => n + 1);
  }, []);
  return (
    <SkinContext.Provider value={skin}>
      <AppearanceContext.Provider
        value={{
          theme,
          skin,
          pending,
          error,
          setTheme: (value) => choose({ protocol_version: 1, operation: 'set', theme: value }),
          setSkin: (value) => choose({ protocol_version: 1, operation: 'set_skin', skin: value }),
          resetSkin: () => choose({ protocol_version: 1, operation: 'reset_skin' }),
          retry,
        }}
      >
        {resolved ? (
          children
        ) : (
          <main className="theme-bootstrap" aria-busy={pending}>
            <p role={error ? 'alert' : 'status'}>{error || '正在读取外观设置…'}</p>
            {error && (
              <button onClick={retry} disabled={pending}>
                重新读取
              </button>
            )}
          </main>
        )}
      </AppearanceContext.Provider>
    </SkinContext.Provider>
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
