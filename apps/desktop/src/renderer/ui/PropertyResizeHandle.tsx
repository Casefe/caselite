import { useLayoutEffect, useRef, useState } from 'react';
import ResizeSeparator from './ResizeSeparator';

type Module = 'tasks' | 'projects' | 'finance' | 'contacts' | 'documents' | 'knowledge';
const names: Record<Module, string> = {
  tasks: '任务',
  projects: '项目',
  finance: '财务',
  contacts: '联系人',
  documents: '文档',
  knowledge: '知识库',
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
    const documentLayout = module === 'documents' || module === 'knowledge';
    const container = documentLayout ? root : root?.parentElement;
    if (!root || !container) return;
    const directory = documentLayout
      ? root.querySelector<HTMLElement>(':scope > .collection-main')
      : null;
    const measure = () => {
      if (!container.clientWidth) return;
      const style = getComputedStyle(root);
      const defaultWidth = Number.parseFloat(style.getPropertyValue('--workspace-inspector-width'));
      // 文档的目录与预览均保留自己的空间，不能套用普通两栏的剩余宽度。
      const centerMinimum = documentLayout
        ? Number.parseFloat(style.getPropertyValue('--document-center-min-width')) || 280
        : 280;
      const directoryWidth = directory?.getBoundingClientRect().width ?? 0;
      setLimits({
        defaultWidth: Number.isFinite(defaultWidth) ? defaultWidth : 300,
        max: Math.max(240, Math.min(720, container.clientWidth - directoryWidth - centerMinimum)),
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(container);
    if (directory) observer?.observe(directory);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--property-panel-width');
    };
  }, [module]);
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
