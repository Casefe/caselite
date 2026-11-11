import { useLayoutEffect, useRef, useState } from 'react';
import ResizeSeparator from './ResizeSeparator';

type Module = 'tasks' | 'projects' | 'finance' | 'contacts';
const names: Record<Module, string> = {
  tasks: '任务',
  projects: '项目',
  finance: '财务',
  contacts: '联系人',
};
// 仅保留当前窗口的布局选择；不把临时缩窗或取消的手势当作用户偏好。
const widths = new Map<Module, number>();

export default function PropertyResizeHandle({ module }: { module: Module }) {
  const handle = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; kind: string } | null>(null);
  const [requested, setRequested] = useState(() => widths.get(module));
  const [preview, setPreview] = useState<number | null>(null);
  const [limits, setLimits] = useState({ defaultWidth: 300, max: 720 });
  const width = Math.max(240, Math.min(limits.max, preview ?? requested ?? limits.defaultWidth));
  useLayoutEffect(() => {
    // 共享分隔线对“回到起点”的释放不提交；这里仍须清除中途预览。
    // 先于分隔线的手势监听执行，正常释放的最终宽度仍只由其 onCommit 确认。
    const release = (event: PointerEvent | MouseEvent) => {
      const active = pointer.current;
      if (!active) return;
      if ('pointerId' in event) {
        if (event.pointerId !== active.id) return;
      } else if (active.kind !== 'mouse' || event.button !== 0 || (event.buttons & 1) !== 0) {
        return;
      }
      pointer.current = null;
      setPreview(null);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('mouseup', release, true);
    return () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('mouseup', release, true);
    };
  }, []);
  useLayoutEffect(() => {
    const root = handle.current?.parentElement;
    const container = root?.parentElement;
    if (!root || !container) return;
    const measure = () => {
      if (!container.clientWidth) return;
      const defaultWidth = Number.parseFloat(
        getComputedStyle(root).getPropertyValue('--workspace-inspector-width'),
      );
      setLimits({
        defaultWidth: Number.isFinite(defaultWidth) ? defaultWidth : 300,
        max: Math.max(240, Math.min(720, container.clientWidth - 280)),
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--property-panel-width');
    };
  }, []);
  useLayoutEffect(() => {
    handle.current?.parentElement?.style.setProperty('--property-panel-width', `${width}px`);
  }, [width]);
  return (
    <div
      ref={handle}
      className="property-resize-handle"
      title="拖动调整属性栏宽度；双击恢复默认"
      onPointerDownCapture={(event) => {
        if (event.button === 0)
          pointer.current = { id: event.pointerId, kind: event.pointerType || 'mouse' };
      }}
      onDoubleClick={() => {
        widths.delete(module);
        setRequested(undefined);
        setPreview(null);
      }}
    >
      <ResizeSeparator
        label={`调整${names[module]}属性栏宽度`}
        value={width}
        min={240}
        max={limits.max}
        direction={-1}
        disabled={false}
        onPreview={setPreview}
        onCommit={(value) => {
          pointer.current = null;
          widths.set(module, value);
          setRequested(value);
          setPreview(null);
        }}
        onCancel={() => {
          pointer.current = null;
          setPreview(null);
        }}
      />
    </div>
  );
}
