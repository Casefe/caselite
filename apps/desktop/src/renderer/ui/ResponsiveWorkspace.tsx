import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useId,
  useState,
  type ReactNode,
} from 'react';

export function workspaceSize(width: number, screenWidth: number) {
  const screen = screenWidth > 0 ? screenWidth : Math.max(1, width);
  const navigationHidden = width * 2 < screen;
  const inlineProperties = width * 3 < screen || (width * 2 >= screen && width * 3 < screen * 2);
  return { navigationHidden, inlineProperties };
}

type Layout = ReturnType<typeof workspaceSize>;
const ResponsiveWorkspace = createContext<
  Layout & {
    navigationEpoch: number;
    presentationEpoch: number;
    drawerOpen: boolean;
    toggleDrawer(): void;
    closeDrawer(): void;
    slots: ReadonlyMap<string, HTMLDivElement>;
    registerSlot(id: string, element: HTMLDivElement | null): void;
  }
>({
  navigationHidden: false,
  inlineProperties: false,
  navigationEpoch: 0,
  presentationEpoch: 0,
  drawerOpen: false,
  toggleDrawer() {},
  closeDrawer() {},
  slots: new Map(),
  registerSlot() {},
});

export function ResponsiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const [size, setSize] = useState(() => ({
    ...workspaceSize(window.innerWidth, window.screen.width),
    navigationEpoch: 0,
    presentationEpoch: 0,
  }));
  const [drawerEpoch, setDrawerEpoch] = useState<number | null>(null);
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLDivElement>>(() => new Map());
  const registerSlot = useCallback(
    (id: string, element: HTMLDivElement | null) =>
      setSlots((old) => {
        if ((old.get(id) ?? null) === element) return old;
        const next = new Map(old);
        if (element) next.set(id, element);
        else next.delete(id);
        return next;
      }),
    [],
  );
  useEffect(() => {
    const measure = () => {
      if (document.visibilityState === 'hidden') return;
      const next = workspaceSize(window.innerWidth, window.screen.width);
      setSize((old) =>
        old.navigationHidden === next.navigationHidden &&
        old.inlineProperties === next.inlineProperties
          ? old
          : {
              ...next,
              navigationEpoch:
                old.navigationEpoch + Number(old.navigationHidden !== next.navigationHidden),
              presentationEpoch:
                old.presentationEpoch + Number(old.inlineProperties !== next.inlineProperties),
            },
      );
    };
    // 跨显示器移动未必触发 resize；只读取浏览器逻辑尺寸，不新增 Electron 权限或持久偏好。
    const timer = window.setInterval(measure, 1000);
    window.addEventListener('resize', measure);
    window.addEventListener('pageshow', measure);
    document.addEventListener('visibilitychange', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.removeEventListener('visibilitychange', measure);
    };
  }, []);
  const closeDrawer = useCallback(() => setDrawerEpoch(null), []);
  const toggleDrawer = useCallback(
    () => setDrawerEpoch((old) => (old === size.navigationEpoch ? null : size.navigationEpoch)),
    [size.navigationEpoch],
  );
  const value = useMemo(
    () => ({
      ...size,
      drawerOpen: size.navigationHidden && drawerEpoch === size.navigationEpoch,
      toggleDrawer,
      closeDrawer,
      slots,
      registerSlot,
    }),
    [size, drawerEpoch, toggleDrawer, closeDrawer, slots, registerSlot],
  );
  return <ResponsiveWorkspace.Provider value={value}>{children}</ResponsiveWorkspace.Provider>;
}

export function useResponsiveWorkspace() {
  return useContext(ResponsiveWorkspace);
}

export function InlinePropertiesSlot({ className = '' }: { className?: string }) {
  const { registerSlot } = useResponsiveWorkspace();
  const id = useId();
  const ref = useCallback(
    (element: HTMLDivElement | null) => registerSlot(id, element),
    [registerSlot, id],
  );
  return <div ref={ref} className={`inline-properties-slot ${className}`} />;
}
