import { useEffect, useRef } from 'react';

export default function ResizeSeparator({
  label,
  value,
  min,
  max,
  direction = 1,
  disabled,
  className = '',
  onPreview,
  onCommit,
  onCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction?: 1 | -1;
  disabled: boolean;
  className?: string;
  onPreview(value: number): void;
  onCommit(value: number): void;
  onCancel(): void;
}) {
  const drag = useRef<{
    id: number;
    kind: string;
    x: number;
    width: number;
    latest: number;
  } | null>(null);
  const keyboard = useRef<number | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  useEffect(() => () => stopListening.current?.(), []);
  const clamp = (width: number) => Math.max(min, Math.min(max, width));
  function finishKeyboard() {
    if (keyboard.current === null) return;
    const width = keyboard.current;
    keyboard.current = null;
    onCommit(width);
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} 像素；左右键调整，Shift 加速，Home/End 到边界`}
      aria-disabled={disabled}
      className={`resize-separator ${className}`}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        const target = event.currentTarget;
        drag.current = {
          id: event.pointerId,
          kind: event.pointerType || 'mouse',
          x: event.clientX,
          width: value,
          latest: value,
        };
        stopListening.current?.();
        const move = (input: PointerEvent) => {
          const active = drag.current;
          if (!active || active.id !== input.pointerId) return;
          active.latest = clamp(active.width + (input.clientX - active.x) * direction);
          onPreview(active.latest);
        };
        const cancel = () => {
          if (!drag.current) return;
          drag.current = null;
          stopListening.current?.();
          onCancel();
        };
        const finish = (input: PointerEvent | MouseEvent) => {
          const active = drag.current;
          if (!active || ('pointerId' in input && active.id !== input.pointerId)) return;
          if (
            !('pointerId' in input) &&
            (active.kind !== 'mouse' || input.button !== 0 || (input.buttons & 1) !== 0)
          )
            return;
          active.latest = clamp(active.width + (input.clientX - active.x) * direction);
          drag.current = null;
          stopListening.current?.();
          if (active.latest !== active.width) onCommit(active.latest);
          // 原生释放可能已先完成；捕获清理失败不能截断已结束手势的唯一提交。
          try {
            if (target.hasPointerCapture(active.id)) target.releasePointerCapture(active.id);
          } catch {
            // 捕获不拥有持久化状态；保存和未知回执仍由原偏好控制器负责。
          }
        };
        const cancelPointer = (input: PointerEvent) => {
          if (drag.current?.id === input.pointerId) cancel();
        };
        // 原生拖动结束可能落在移动后的分隔线外；窗口捕获统一收尾，兼容仅派发 mouseup 的宿主。
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', finish, true);
        window.addEventListener('mouseup', finish, true);
        window.addEventListener('pointercancel', cancelPointer, true);
        window.addEventListener('blur', cancel);
        stopListening.current = () => {
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', finish, true);
          window.removeEventListener('mouseup', finish, true);
          window.removeEventListener('pointercancel', cancelPointer, true);
          window.removeEventListener('blur', cancel);
          stopListening.current = null;
        };
        target.setPointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        drag.current = null;
        stopListening.current?.();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (disabled || event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          keyboard.current = null;
          drag.current = null;
          stopListening.current?.();
          onCancel();
          return;
        }
        const step = event.shiftKey ? 32 : 8;
        const next =
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : event.key === 'ArrowLeft'
                ? (keyboard.current ?? value) - step * direction
                : event.key === 'ArrowRight'
                  ? (keyboard.current ?? value) + step * direction
                  : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        keyboard.current = clamp(next);
        onPreview(keyboard.current);
      }}
      onKeyUp={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) finishKeyboard();
      }}
      onBlur={finishKeyboard}
    />
  );
}
