import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  LocalPreferences,
  LocalPreferenceValues,
  LocalPreferencesRequest,
  LocalPreferencesResponse,
  WorkspaceLocations,
} from '../../../preload/caselite-api';
import { mutation } from './taskCommand';
type Write = Extract<LocalPreferencesRequest, { operation: 'set' }>;
type Phase = 'idle' | 'verify' | 'retry';
const fields = ({ version, ...values }: LocalPreferences): LocalPreferenceValues => {
  void version;
  return values;
};
// 首帧占位不落盘；资料真值由受控读取返回，Renderer 不加载宿主合同实现。
export const initialLocalPreferences: LocalPreferences = {
  name: '谭律师',
  email: '',
  avatar: 'portrait',
  show_word_count: false,
  version: 0,
};
const initial = fields(initialLocalPreferences);
const Context = createContext({
  preferences: initialLocalPreferences,
  locations: null as WorkspaceLocations | null,
  draft: initial,
  dirty: false,
  pending: true,
  error: '',
  notice: '',
  phase: 'idle' as Phase,
  ready: false,
  change(patch: Partial<LocalPreferenceValues>) {
    void patch;
  },
  async save() {
    return false;
  },
  async saveCalendarLayout(layout: NonNullable<LocalPreferenceValues['calendar_layout']>) {
    void layout;
    return false;
  },
  async reload() {},
  async verify() {},
  async retry() {},
});
export const useLocalPreferences = () => useContext(Context);
export function LocalPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(initialLocalPreferences),
    [draft, setDraft] = useState(initial);
  const [locations, setLocations] = useState<WorkspaceLocations | null>(null);
  const [pending, setPending] = useState(true),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [phase, setPhase] = useState<Phase>('idle');
  const request = useRef<Write | null>(null),
    requestKind = useRef<'personal' | 'calendar'>('personal'),
    lock = useRef(false),
    mounted = useRef(false);
  const accept = (value: LocalPreferences, base?: LocalPreferenceValues) => {
    setPreferences(value);
    setReady(true);
    // 调整布局只提交已保存的个人资料，并保留设置页尚未保存的输入。
    setDraft((old) => {
      if (!base) return fields(value);
      const edited = Object.fromEntries(
        (['name', 'email', 'avatar', 'show_word_count', 'editor_mode'] as const)
          .filter((key) => old[key] !== base[key])
          .map((key) => [key, old[key]]),
      );
      return { ...fields(value), ...edited };
    });
  };
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    if (!window.caselite?.preferences) {
      queueMicrotask(() => {
        if (alive) {
          setPending(false);
          setError('此版本尚未接通本地个人设置。');
        }
      });
      return () => {
        alive = false;
        mounted.current = false;
      };
    }
    void window.caselite
      .preferences({ protocol_version: 1, operation: 'read' })
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          accept(r.preferences);
          setLocations(r.locations ?? null);
        } else setError(r.message);
      })
      .catch(() => {
        if (alive) setError('无法读取本地资料，请重试。');
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
      mounted.current = false;
    };
  }, []);
  async function run(mode: 'set' | 'status'): Promise<boolean> {
    const original = request.current;
    if (lock.current || !original) return false;
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const r: LocalPreferencesResponse = await window.caselite.preferences(
        mode === 'status'
          ? { protocol_version: 1, operation: 'status', idempotency_key: original.idempotency_key }
          : original,
      );
      if (!mounted.current) return false;
      if (r.ok) {
        if (
          r.receipt !== original.idempotency_key ||
          r.preferences.version !== original.expected_version + 1 ||
          JSON.stringify(fields(r.preferences)) !== JSON.stringify(original.values)
        )
          throw new Error('Unexpected receipt');
        accept(r.preferences, requestKind.current === 'calendar' ? original.values : undefined);
        request.current = null;
        setPhase('idle');
        // 原键回执可能早于其他窗口的后续修改；确认保存后只读刷新，不再提交。
        try {
          const latest = await window.caselite.preferences({
            protocol_version: 1,
            operation: 'read',
          });
          if (mounted.current) {
            if (latest.ok) {
              accept(
                latest.preferences,
                requestKind.current === 'calendar' ? original.values : undefined,
              );
              setLocations(latest.locations ?? null);
              setNotice(
                requestKind.current === 'calendar'
                  ? '日历布局已保存。'
                  : '个人资料与偏好已保存到此工作区。',
              );
            } else setNotice('已保存；最新资料刷新失败，可重新读取，不必再次保存。');
          }
        } catch {
          if (mounted.current) setNotice('已保存；最新资料刷新失败，可重新读取，不必再次保存。');
        }
        return true;
      }
      setError(r.message);
      if (mode === 'status' && r.code === 'NOT_FOUND') setPhase('retry');
      else if (['RESULT_UNKNOWN', 'READ_FAILED'].includes(r.code)) setPhase('verify');
      else if (mode === 'status') setPhase('verify');
      else {
        request.current = null;
        setPhase('idle');
      }
      return false;
    } catch {
      if (mounted.current) {
        setPhase('verify');
        setError('无法确认保存结果，请保留输入并核对原提交。');
      }
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function save() {
    if (
      lock.current ||
      request.current ||
      pending ||
      JSON.stringify(draft) === JSON.stringify(fields(preferences))
    )
      return false;
    const values = { ...draft, name: draft.name.trim(), email: draft.email.trim() };
    if (!values.name) {
      setError('请填写名称。');
      return false;
    }
    requestKind.current = 'personal';
    request.current = {
      ...mutation(),
      operation: 'set',
      expected_version: preferences.version,
      values,
    };
    return run('set');
  }
  async function saveCalendarLayout(layout: NonNullable<LocalPreferenceValues['calendar_layout']>) {
    if (lock.current || request.current || pending || !ready) return false;
    if (JSON.stringify(preferences.calendar_layout) === JSON.stringify(layout)) return true;
    requestKind.current = 'calendar';
    setDraft((old) => ({ ...old, calendar_layout: layout }));
    request.current = {
      ...mutation(),
      operation: 'set',
      expected_version: preferences.version,
      values: { ...fields(preferences), calendar_layout: layout },
    };
    return run('set');
  }
  async function reload() {
    if (lock.current || request.current || pending) return;
    const edited = JSON.stringify(draft) !== JSON.stringify(fields(preferences));
    lock.current = true;
    setPending(true);
    try {
      const r = await window.caselite.preferences({ protocol_version: 1, operation: 'read' });
      if (!mounted.current) return;
      if (r.ok) {
        setReady(true);
        setLocations(r.locations ?? null);
        accept(r.preferences, edited ? fields(preferences) : undefined);
        setError('');
        setNotice(
          edited
            ? '已读取最新资料；尚未保存的输入仍保留，再次保存将使用当前填写的值。'
            : '已读取最新资料。',
        );
      } else setError(r.message);
    } catch {
      if (mounted.current) setError('无法读取本地设置，请保留输入。');
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <Context.Provider
      value={{
        preferences,
        locations,
        draft,
        dirty: JSON.stringify(draft) !== JSON.stringify(fields(preferences)),
        pending,
        ready,
        error,
        notice,
        phase,
        change: (patch) => {
          if (!lock.current && !request.current) setDraft((v) => ({ ...v, ...patch }));
        },
        save,
        saveCalendarLayout,
        reload,
        verify: async () => {
          await run('status');
        },
        retry: async () => {
          if (phase === 'retry') await run('set');
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
