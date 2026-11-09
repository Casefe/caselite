import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
} from 'react-resizable-panels';

export type PreviewPane = 'primary' | 'secondary';

export function useSplitPreviewSelection() {
  const [state, setState] = useState({
    primary: null as string | null,
    secondary: null as string | null,
    active: 'primary' as PreviewPane,
    split: false,
  });
  return {
    ...state,
    selectedId: state[state.active],
    reset() {
      setState((current) => ({ ...current, primary: null, secondary: null, active: 'primary' }));
    },
    select(id: string | null) {
      setState((current) => ({ ...current, [current.active]: id }));
    },
    pin(pane: PreviewPane, id: string) {
      setState((current) => (current[pane] ? current : { ...current, [pane]: id }));
    },
    activate(active: PreviewPane) {
      setState((current) =>
        current.active === active || (!current.split && active === 'secondary')
          ? current
          : { ...current, active },
      );
    },
    toggle(primaryId: string | null) {
      setState((current) => ({
        ...current,
        primary: current.primary ?? primaryId,
        split: !current.split,
        active: current.split ? 'primary' : current.active,
      }));
    },
  };
}

type PreviewContent = { title: string; content: ReactNode };

export default function SplitPreviewWorkspace({
  primary,
  secondary,
  activePane,
  split,
  disabled = false,
  onActivate,
  onToggle,
  actions,
  title,
}: {
  primary: PreviewContent | null;
  secondary: PreviewContent | null;
  activePane: PreviewPane;
  split: boolean;
  disabled?: boolean;
  onActivate(pane: PreviewPane): void;
  onToggle(): void;
  actions?: ReactNode;
  title?: string;
}) {
  const id = useId();
  const primaryId = `${id}-primary`;
  const secondaryId = `${id}-secondary`;
  const group = useRef<GroupImperativeHandle | null>(null);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const layout = useRef<Layout>({ [primaryId]: 50, [secondaryId]: 50 });
  // 两栏一直留在同一Group；收起和换方向不能重建正文实例或丢失滚动/选区。
  useLayoutEffect(() => {
    group.current?.setLayout(split ? layout.current : { [primaryId]: 100, [secondaryId]: 0 });
  }, [split, primaryId, secondaryId]);

  const pane = (slot: PreviewPane, value: PreviewContent | null) => (
    <section
      className="split-preview-pane"
      data-preview-pane={slot}
      data-active={activePane === slot}
      aria-label={slot === 'primary' ? '主预览' : '副预览'}
      inert={slot === 'secondary' && !split}
      onPointerDown={() => !disabled && onActivate(slot)}
      onFocusCapture={() => !disabled && onActivate(slot)}
    >
      <header className="split-preview-pane-heading">
        <button
          type="button"
          aria-pressed={activePane === slot}
          disabled={disabled}
          onClick={() => onActivate(slot)}
        >
          {slot === 'primary' ? '主预览' : '副预览'}
        </button>
        <strong title={value?.title}>{value?.title ?? '选择文件'}</strong>
      </header>
      <div className="split-preview-scroll">
        {value?.content ?? (
          <div className="split-preview-empty">
            <h2>{slot === 'primary' ? '选择文档' : '在此栏打开另一份文档'}</h2>
            <p>先选择预览栏，再单击左侧目录中的文档。</p>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <section className="split-preview-workspace" aria-label="预览工作区" data-split={split}>
      <header className="split-preview-toolbar">
        <span className="split-preview-title" title={title}>
          {title ?? '预览'}
        </span>
        <div>
          {actions}
          <button type="button" aria-pressed={split} disabled={disabled} onClick={onToggle}>
            {split ? '收起双栏' : '双栏预览'}
          </button>
          <button
            type="button"
            disabled={disabled || !split}
            onClick={() =>
              setOrientation((value) => (value === 'horizontal' ? 'vertical' : 'horizontal'))
            }
          >
            {orientation === 'horizontal' ? '上下分栏' : '左右分栏'}
          </button>
        </div>
      </header>
      <Group
        id={`${id}-previews`}
        className="split-preview-group"
        groupRef={group}
        orientation={orientation}
        disabled={disabled || !split}
        onLayoutChanged={(value, meta) => {
          if (split && meta.isUserInteraction) layout.current = value;
        }}
      >
        <Panel id={primaryId} defaultSize="100%" minSize={split ? '25%' : '100%'}>
          {pane('primary', primary)}
        </Panel>
        <Separator
          className="split-preview-separator"
          aria-label="调整预览分栏"
          disabled={disabled || !split}
          hidden={!split}
        />
        <Panel
          id={secondaryId}
          defaultSize="0%"
          minSize={split ? '25%' : '0%'}
          maxSize={split ? '75%' : '0%'}
        >
          {pane('secondary', secondary)}
        </Panel>
      </Group>
    </section>
  );
}
