// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PropertyResizeHandle from './PropertyResizeHandle';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
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
});
function Panel({ module = 'tasks' }: { module?: 'tasks' | 'projects' | 'finance' | 'contacts' }) {
  return (
    <div>
      <section style={{ '--workspace-inspector-width': '360px' } as React.CSSProperties}>
        <input aria-label="未保存的正文" defaultValue="待继续编辑" />
        <PropertyResizeHandle module={module} />
      </section>
    </div>
  );
}
function keyboard(key: string) {
  fireEvent.keyDown(screen.getByRole('separator'), { key });
  fireEvent.keyUp(screen.getByRole('separator'), { key });
}
it('drags the boundary and preserves the live editor and its unsaved input', () => {
  render(<Panel />);
  const separator = screen.getByRole('separator');
  fireEvent.doubleClick(separator);
  const editor = screen.getByLabelText('未保存的正文');
  fireEvent.change(editor, { target: { value: '尚未保存的输入' } });
  fireEvent.pointerDown(separator, { pointerId: 1, button: 0, clientX: 700 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 580 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 580 });
  expect(separator.getAttribute('aria-valuenow')).toBe('480');
  expect(editor.closest('section')?.style.getPropertyValue('--property-panel-width')).toBe('480px');
  expect(screen.getByLabelText('未保存的正文')).toBe(editor);
  expect((editor as HTMLInputElement).value).toBe('尚未保存的输入');
});
it('cancels interrupted drags and keyboard previews, and resets to the CSS default', () => {
  render(<Panel module="projects" />);
  const separator = screen.getByRole('separator');
  fireEvent.doubleClick(separator);
  keyboard('ArrowLeft');
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  fireEvent.pointerDown(separator, { pointerId: 2, button: 0, clientX: 600 });
  fireEvent.pointerMove(window, { pointerId: 2, clientX: 400 });
  fireEvent.pointerCancel(window, { pointerId: 2 });
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  fireEvent.keyDown(separator, { key: 'End' });
  fireEvent.keyDown(separator, { key: 'Escape' });
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  keyboard('Home');
  expect(separator.getAttribute('aria-valuenow')).toBe('240');
  fireEvent.doubleClick(separator);
  expect(separator.getAttribute('aria-valuenow')).toBe('360');
});
it('clears the preview when the release returns to the starting position without a final move', () => {
  render(<Panel />);
  const separator = screen.getByRole('separator');
  fireEvent.doubleClick(separator);
  fireEvent.pointerDown(separator, { pointerId: 7, button: 0, clientX: 700 });
  fireEvent.pointerMove(window, { pointerId: 7, clientX: 580 });
  expect(separator.getAttribute('aria-valuenow')).toBe('480');
  fireEvent.pointerUp(window, { pointerId: 7, clientX: 700 });
  expect(separator.getAttribute('aria-valuenow')).toBe('360');
});
it('keeps module choices through remounts and restores them after temporary window clamping', () => {
  const host = render(<Panel module="finance" />);
  fireEvent.doubleClick(screen.getByRole('separator'));
  keyboard('End');
  host.unmount();
  const other = render(<Panel module="contacts" />);
  fireEvent.doubleClick(screen.getByRole('separator'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('360');
  other.unmount();
  render(<Panel module="finance" />);
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('720');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('320');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('720');
});
