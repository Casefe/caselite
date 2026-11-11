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
function Panel({
  module = 'tasks',
}: {
  module?: 'tasks' | 'projects' | 'finance' | 'contacts' | 'documents' | 'knowledge';
}) {
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

function DocumentPanel({ module }: { module: 'documents' | 'knowledge' }) {
  return (
    <div>
      <section
        className="document-workspace"
        style={
          {
            '--workspace-inspector-width': '296px',
            '--document-center-min-width': '280px',
          } as React.CSSProperties
        }
      >
        <div className="collection-main">目录</div>
        <div className="document-center-workspace">
          <input aria-label="未保存的文档正文" defaultValue="待继续编辑" />
        </div>
        <aside>属性</aside>
        <PropertyResizeHandle module={module} />
      </section>
    </div>
  );
}

it.each(['documents', 'knowledge'] as const)(
  'limits %s to the space left after its directory and preview, without losing the requested width',
  (module) => {
    let workspaceWidth = 1400;
    let directoryWidth = 288;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('document-workspace') ? workspaceWidth : 1800;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(
        0,
        0,
        this.classList.contains('collection-main') ? directoryWidth : 1400,
        600,
      );
    });
    render(<DocumentPanel module={module} />);
    const separator = screen.getByRole('separator', {
      name: module === 'documents' ? '调整文档属性栏宽度' : '调整知识库属性栏宽度',
    });
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('296');
    keyboard('End');
    expect(separator.getAttribute('aria-valuenow')).toBe('720');
    const editor = screen.getByLabelText<HTMLInputElement>('未保存的文档正文');
    fireEvent.change(editor, { target: { value: '未提交文档输入' } });
    workspaceWidth = 1000;
    fireEvent(window, new Event('resize'));
    expect(separator.getAttribute('aria-valuemax')).toBe('432');
    expect(separator.getAttribute('aria-valuenow')).toBe('432');
    expect(screen.getByLabelText('未保存的文档正文')).toBe(editor);
    expect(editor.value).toBe('未提交文档输入');
    workspaceWidth = 1400;
    fireEvent(window, new Event('resize'));
    expect(separator.getAttribute('aria-valuenow')).toBe('720');
    workspaceWidth = 1000;
    directoryWidth = 230;
    const workspace = editor.closest('section')!;
    workspace.style.setProperty('--document-center-min-width', '200px');
    workspace.style.setProperty('--workspace-inspector-width', '252px');
    fireEvent(window, new Event('resize'));
    expect(separator.getAttribute('aria-valuemax')).toBe('570');
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('252');
  },
);

it('restores separate document and knowledge widths through remounts and cancels incomplete gestures', () => {
  let host = render(<Panel module="documents" />);
  let separator = screen.getByRole('separator');
  fireEvent.doubleClick(separator);
  keyboard('ArrowLeft');
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  host.unmount();
  host = render(<Panel module="knowledge" />);
  separator = screen.getByRole('separator');
  fireEvent.doubleClick(separator);
  fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true });
  fireEvent.keyUp(separator, { key: 'ArrowLeft' });
  expect(separator.getAttribute('aria-valuenow')).toBe('392');
  host.unmount();
  host = render(<Panel module="documents" />);
  separator = screen.getByRole('separator');
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  fireEvent.pointerDown(separator, { pointerId: 31, button: 0, clientX: 700 });
  fireEvent.pointerMove(window, { pointerId: 31, clientX: 580 });
  fireEvent.pointerUp(window, { pointerId: 31, clientX: 700 });
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  fireEvent.pointerDown(separator, { pointerId: 32, button: 0, clientX: 700 });
  fireEvent.pointerMove(window, { pointerId: 32, clientX: 580 });
  fireEvent.keyDown(separator, { key: 'Escape' });
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  fireEvent.pointerDown(separator, { pointerId: 33, button: 0, clientX: 700 });
  fireEvent.pointerMove(window, { pointerId: 33, clientX: 580 });
  fireEvent(window, new Event('blur'));
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  fireEvent.pointerDown(separator, { pointerId: 34, button: 0, clientX: 700 });
  fireEvent.pointerMove(window, { pointerId: 34, clientX: 580 });
  fireEvent.pointerCancel(window, { pointerId: 34 });
  expect(separator.getAttribute('aria-valuenow')).toBe('368');
  // 正常释放仍提交最终位置；取消保护不能让成功拖动失效。
  fireEvent.pointerDown(separator, { pointerId: 35, button: 0, clientX: 700 });
  fireEvent.pointerUp(window, { pointerId: 35, clientX: 580 });
  expect(separator.getAttribute('aria-valuenow')).toBe('488');
  keyboard('Home');
  expect(separator.getAttribute('aria-valuenow')).toBe('240');
  fireEvent.doubleClick(separator);
  host.unmount();
  render(<Panel module="knowledge" />);
  separator = screen.getByRole('separator');
  expect(separator.getAttribute('aria-valuenow')).toBe('392');
  fireEvent.doubleClick(separator);
});
