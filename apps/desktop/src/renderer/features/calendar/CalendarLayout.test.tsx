// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import {
  LocalPreferencesProvider,
  initialLocalPreferences,
  useLocalPreferences,
} from '../../shared/data/LocalPreferences';
import type { LocalPreferencesRequest, LocalPreferences } from '../../../preload/caselite-api';
import CalendarView from './CalendarView';
import { calendarColumnLimits, defaultCalendarLayout } from './useCalendarLayout';

let width = 1200;
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width }) as DOMRect,
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  class Pointer extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit) {
      super(type, options);
      this.pointerId = options.pointerId ?? 1;
    }
  }
  vi.stubGlobal('PointerEvent', Pointer);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  width = 1200;
});
function setup(fault = '') {
  let saved: LocalPreferences = { ...initialLocalPreferences };
  let original: Extract<LocalPreferencesRequest, { operation: 'set' }> | null = null;
  let ack: { preferences: LocalPreferences; key: string } | null = null;
  let failRead = false;
  const api = vi.fn(async (request: LocalPreferencesRequest) => {
    if (request.operation === 'read') {
      if (failRead) {
        failRead = false;
        return { ok: false, code: 'READ_FAILED', message: '合成刷新失败' };
      }
      return { ok: true, preferences: saved, receipt: null };
    }
    if (request.operation === 'status')
      return { ok: true, preferences: ack!.preferences, receipt: request.idempotency_key };
    original = request;
    saved = { ...request.values, version: saved.version + 1 };
    ack = { preferences: structuredClone(saved), key: request.idempotency_key };
    if (fault === 'unknown') {
      fault = '';
      return { ok: false, code: 'RESULT_UNKNOWN', message: '合成布局未知结果' };
    }
    if (fault === 'refresh') {
      fault = '';
      failRead = true;
    }
    return { ok: true, preferences: saved, receipt: request.idempotency_key };
  });
  window.caselite = {
    preferences: api,
    task: vi.fn(async () => ({ ok: true, tasks: [], state: null, receipt: null })),
  } as unknown as Window['caselite'];
  function Host() {
    const preferences = useLocalPreferences();
    const [show, setShow] = useState(true);
    return (
      <>
        <button onClick={() => setShow(!show)}>切换日历消费者</button>
        <output aria-label="个人偏好有草稿">{String(preferences.dirty)}</output>
        <output aria-label="技能设置草稿">
          {JSON.stringify(preferences.draft.writing_skills ?? [])}
        </output>
        <button
          onClick={() =>
            preferences.change({
              writing_skills: [
                { id: 'draft', name: '未保存技能', instruction: '合成指令', enabled: true },
              ],
            })
          }
        >
          编辑技能草稿
        </button>
        <input
          aria-label="个人设置草稿"
          value={preferences.draft.name}
          onChange={(e) => preferences.change({ name: e.target.value })}
        />
        {show && (
          <CalendarView
            date="2026-11-10"
            selected={null}
            inspector={null}
            blocked={false}
            onDate={vi.fn()}
            onOpen={vi.fn()}
            onClose={vi.fn()}
            onReminders={vi.fn()}
            onSettings={vi.fn()}
          />
        )}
      </>
    );
  }
  const node = (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LocalPreferencesProvider>
        <Host />
      </LocalPreferencesProvider>
    </QueryClientProvider>
  );
  const mounted = render(node);
  return {
    api,
    mounted,
    saved: () => saved,
    original: () => original,
    replace: (patch: Partial<LocalPreferences>) => {
      saved = { ...saved, ...patch };
    },
  };
}
async function ready() {
  const separator = await screen.findByRole('separator', { name: '调整日期区宽度' });
  await waitFor(() => expect(separator.getAttribute('aria-disabled')).toBe('false'));
  return separator;
}
it('uses 230×7/6 by default, removes the three left entries, and commits keyboard width without submitting personal drafts', async () => {
  const s = setup();
  const separator = await ready();
  expect(defaultCalendarLayout.dates_width).toBe((230 * 7) / 6);
  expect(screen.queryByRole('region', { name: '本日工作安排' })).toBeNull();
  expect(screen.queryByRole('button', { name: '提醒收件箱' })).toBeNull();
  expect(screen.queryByRole('button', { name: '日历与类型设置' })).toBeNull();
  fireEvent.change(screen.getByLabelText('个人设置草稿'), { target: { value: '尚未保存的名称' } });
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyDown(separator, { key: 'ArrowRight', repeat: true });
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(0);
  fireEvent.keyUp(separator, { key: 'ArrowRight' });
  await screen.findByText('日历布局已保存。');
  expect(s.saved().calendar_layout?.dates_width).toBeCloseTo((230 * 7) / 6 + 16);
  expect(s.saved().name).toBe(initialLocalPreferences.name);
  expect((screen.getByLabelText('个人设置草稿') as HTMLInputElement).value).toBe('尚未保存的名称');
  const right = screen.getByRole('separator', { name: '调整任务属性栏宽度' });
  fireEvent.keyDown(right, { key: 'ArrowLeft', shiftKey: true });
  fireEvent.keyUp(right, { key: 'ArrowLeft' });
  await waitFor(() => expect(s.saved().calendar_layout?.inspector_width).toBe(372));
});
it('previews pointer movement without writes, cancels safely, and persists only the completed drag', async () => {
  const s = setup(),
    separator = await ready();
  fireEvent.pointerDown(separator, { button: 0, clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(separator, { clientX: 370, pointerId: 1 });
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(0);
  fireEvent.pointerCancel(separator, { pointerId: 1 });
  expect(separator.getAttribute('aria-valuenow')).toBe('268');
  fireEvent.pointerDown(separator, { button: 0, clientX: 300, pointerId: 2 });
  fireEvent.pointerMove(separator, { clientX: 350, pointerId: 2 });
  fireEvent.pointerUp(separator, { clientX: 350, pointerId: 2 });
  await waitFor(() =>
    expect(s.saved().calendar_layout?.dates_width).toBeCloseTo(
      defaultCalendarLayout.dates_width + 50,
    ),
  );
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
it('finishes outside the moving separator and accepts a native mouseup only once', async () => {
  const s = setup(),
    separator = await ready();
  fireEvent.pointerDown(separator, { button: 0, clientX: 300, pointerId: 9 });
  fireEvent.pointerMove(window, { clientX: 320, pointerId: 9 });
  fireEvent.mouseUp(window, { clientX: 360, button: 2, buttons: 1 });
  fireEvent.mouseUp(window, { clientX: 360, button: 0, buttons: 1 });
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(0);
  fireEvent.mouseUp(window, { clientX: 360, button: 0, buttons: 0 });
  fireEvent.pointerUp(window, { clientX: 360, pointerId: 9 });
  await waitFor(() =>
    expect(s.saved().calendar_layout?.dates_width).toBeCloseTo(
      defaultCalendarLayout.dates_width + 60,
    ),
  );
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
it('removes global drag listeners on cancel, blur and consumer unmount without saving', async () => {
  const s = setup(),
    separator = await ready();
  for (const end of ['pointercancel', 'blur', 'unmount']) {
    fireEvent.pointerDown(separator, { button: 0, clientX: 300, pointerId: 9 });
    fireEvent.pointerMove(window, { clientX: 340, pointerId: 9 });
    if (end === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 9 });
    else if (end === 'blur') fireEvent.blur(window);
    else s.mounted.unmount();
    fireEvent.mouseUp(window, { clientX: 360, button: 0 });
    fireEvent.pointerUp(window, { clientX: 360, pointerId: 9 });
  }
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(0);
});
it('keeps unsaved writing skills while committing only calendar preferences', async () => {
  const s = setup(),
    separator = await ready();
  fireEvent.click(screen.getByText('编辑技能草稿'));
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyUp(separator, { key: 'ArrowRight' });
  await screen.findByText('日历布局已保存。');
  expect(s.saved().writing_skills).toBeUndefined();
  expect(screen.getByLabelText('技能设置草稿').textContent).toContain('未保存技能');
  expect(screen.getByLabelText('个人偏好有草稿').textContent).toBe('true');
});
it('takes latest saved skill values after an old receipt instead of mistaking cloned arrays for edits', async () => {
  const s = setup('unknown'),
    separator = await ready();
  const first = { id: 'saved', name: '已存技能', instruction: '合成指令', enabled: true };
  s.replace({ writing_skills: [first], version: 1 });
  fireEvent.click(screen.getByText('重读布局偏好'));
  await waitFor(() =>
    expect(screen.getByLabelText('技能设置草稿').textContent).toContain('已存技能'),
  );
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyUp(separator, { key: 'ArrowRight' });
  await screen.findByText('合成布局未知结果');
  s.replace({ writing_skills: [{ ...first, name: '其他窗口最新技能' }], version: 3 });
  fireEvent.click(screen.getByText('核对布局保存结果'));
  await screen.findByText('日历布局已保存。');
  expect(screen.getByLabelText('技能设置草稿').textContent).toContain('其他窗口最新技能');
  expect(screen.getByLabelText('个人偏好有草稿').textContent).toBe('false');
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
it('retains the original unknown layout request across calendar unmount, verifies once, then restores the saved width', async () => {
  const s = setup('unknown'),
    separator = await ready();
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyUp(separator, { key: 'ArrowRight' });
  await screen.findByText('合成布局未知结果');
  const key = s.original()!.idempotency_key;
  fireEvent.click(screen.getByText('切换日历消费者'));
  fireEvent.click(screen.getByText('切换日历消费者'));
  fireEvent.click(await screen.findByText('核对布局保存结果'));
  await screen.findByText('日历布局已保存。');
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  expect(s.api.mock.calls.find(([r]) => r.operation === 'status')![0]).toMatchObject({
    idempotency_key: key,
  });
  expect(
    screen.getByRole('separator', { name: '调整日期区宽度' }).getAttribute('aria-valuenow'),
  ).toBe('276');
});
it('commits a finished drag exactly once even when native capture release has already expired', async () => {
  const s = setup(),
    separator = await ready();
  HTMLElement.prototype.releasePointerCapture = vi.fn(() => {
    throw new DOMException('Expired native capture', 'NotFoundError');
  });
  fireEvent.pointerDown(separator, { button: 0, clientX: 300, pointerId: 8 });
  fireEvent.pointerMove(separator, { clientX: 340, pointerId: 8 });
  fireEvent.pointerUp(separator, { clientX: 340, pointerId: 8 });
  fireEvent.lostPointerCapture(separator, { pointerId: 8 });
  await waitFor(() =>
    expect(s.saved().calendar_layout?.dates_width).toBeCloseTo(
      defaultCalendarLayout.dates_width + 40,
    ),
  );
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
it('clamps display widths for center reachability and narrow overlays without mutating saved preferences', () => {
  const layout = { dates_width: 460, inspector_width: 560 };
  const wide = calendarColumnLimits(1000, layout);
  expect(wide.dates + wide.inspector + 12 + 260).toBeLessThanOrEqual(1000);
  const narrow = calendarColumnLimits(440, layout, 640);
  expect(narrow.inspector).toBeLessThanOrEqual(616);
  expect(narrow.dates).toBe(460);
  expect(layout).toEqual({ dates_width: 460, inspector_width: 560 });
});
it('uses latest widths and untouched personal values after an old unknown ACK without inventing a stale draft', async () => {
  const s = setup('unknown'),
    separator = await ready();
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyUp(separator, { key: 'ArrowRight' });
  await screen.findByText('合成布局未知结果');
  s.replace({
    name: '其他窗口最新名称',
    version: 2,
    calendar_layout: { dates_width: 380, inspector_width: 420 },
  });
  fireEvent.click(screen.getByText('核对布局保存结果'));
  await screen.findByText('日历布局已保存。');
  expect(
    screen.getByRole('separator', { name: '调整日期区宽度' }).getAttribute('aria-valuenow'),
  ).toBe('380');
  expect((screen.getByLabelText('个人设置草稿') as HTMLInputElement).value).toBe(
    '其他窗口最新名称',
  );
  expect(screen.getByLabelText('个人偏好有草稿').textContent).toBe('false');
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
});
it('offers read-only recovery after a confirmed layout save with failed refresh and does not submit twice', async () => {
  const s = setup('refresh'),
    separator = await ready();
  fireEvent.keyDown(separator, { key: 'ArrowRight' });
  fireEvent.keyUp(separator, { key: 'ArrowRight' });
  await screen.findByText('已保存；最新资料刷新失败，可重新读取，不必再次保存。');
  fireEvent.click(screen.getByText('重读布局偏好'));
  await screen.findByText('已读取最新资料。');
  expect(s.api.mock.calls.filter(([r]) => r.operation === 'set')).toHaveLength(1);
  expect(
    screen.getByRole('separator', { name: '调整日期区宽度' }).getAttribute('aria-valuenow'),
  ).toBe('276');
});
