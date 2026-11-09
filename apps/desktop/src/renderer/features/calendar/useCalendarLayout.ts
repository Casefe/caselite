import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { useLocalPreferences } from '../../shared/data/LocalPreferences';

export const defaultCalendarLayout = { dates_width: (230 * 7) / 6, inspector_width: 340 };
type Layout = typeof defaultCalendarLayout;
export function calendarColumnLimits(width: number, layout: Layout, viewport = 1440) {
  // 窗口缩小时只压缩显示，不把临时clamp写回用户偏好；中央至少保留260px。
  const inspectorMax = Math.max(
    280,
    Math.min(560, viewport <= 1200 ? viewport - 24 : width - 220 - 260 - 12),
  );
  const inspector = Math.max(280, Math.min(layout.inspector_width, inspectorMax));
  const datesMax = Math.max(
    220,
    Math.min(
      460,
      viewport <= 760
        ? viewport - 24
        : viewport <= 1200
          ? width - 266
          : width - inspector - 260 - 12,
    ),
  );
  const dates = Math.max(220, Math.min(layout.dates_width, datesMax));
  return { dates, inspector, datesMax, inspectorMax };
}
export function useCalendarLayout(root: RefObject<HTMLElement | null>) {
  const preferences = useLocalPreferences();
  const [size, setSize] = useState({ width: 1200, viewport: 1440 });
  const [preview, setPreview] = useState<Layout | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.getBoundingClientRect().width, viewport: window.innerWidth });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [root]);
  const saved = preferences.preferences.calendar_layout ?? defaultCalendarLayout;
  const layout = preview ?? preferences.draft.calendar_layout ?? saved;
  const limits = calendarColumnLimits(size.width, layout, size.viewport);
  const pending = preferences.pending || !preferences.ready || preferences.phase !== 'idle';
  function commit(next: Layout) {
    // 结束手势后由长寿命偏好控制器保管输入/原键；核对成功后不能让旧预览遮住新值。
    setPreview(null);
    void preferences.saveCalendarLayout(next);
  }
  return {
    preferences,
    pending,
    limits,
    style: {
      '--calendar-dates-width': `${limits.dates}px`,
      '--calendar-inspector-width': `${limits.inspector}px`,
    } as CSSProperties,
    change: (field: keyof Layout, value: number) => setPreview({ ...layout, [field]: value }),
    commit: (field: keyof Layout, value: number) => void commit({ ...layout, [field]: value }),
    cancel: () => setPreview(null),
    reset: () => void commit(defaultCalendarLayout),
    save: () => void commit(layout),
    dirty: JSON.stringify(layout) !== JSON.stringify(saved),
  };
}
