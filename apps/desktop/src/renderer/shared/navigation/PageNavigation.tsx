import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';

export type ChildPage = { key: string; title: string; icon: string; state: unknown };
export type PageNavigationBridge = {
  initial: unknown;
  register(read: () => ChildPage): () => void;
  report(page: Omit<ChildPage, 'state'>): void;
  beforeChange(): void;
  inspector: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    pageKey: string;
    initialize(key: string, open: boolean): void;
  };
};
const PageNavigation = createContext<PageNavigationBridge | null>(null);
export function PageNavigationProvider({
  value,
  children,
}: {
  value: PageNavigationBridge;
  children: ReactNode;
}) {
  return <PageNavigation.Provider value={value}>{children}</PageNavigation.Provider>;
}
export function usePageNavigation() {
  return useContext(PageNavigation);
}
export function useWorkspaceInspector(
  initial: boolean,
  inverted = false,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [fallback, setFallback] = useState(initial);
  const inspector = usePageNavigation()?.inspector;
  const initialize = inspector?.initialize;
  const pageKey = inspector?.pageKey;
  useLayoutEffect(() => {
    if (pageKey) initialize?.(pageKey, inverted ? !initial : initial);
  }, [initialize, pageKey, initial, inverted]);
  if (!inspector) return [fallback, setFallback];
  if (!inverted) return [inspector.open, inspector.setOpen];
  return [
    !inspector.open,
    (action) =>
      inspector.setOpen((open) => !(typeof action === 'function' ? action(!open) : action)),
  ];
}
export function useChildPage(read: () => ChildPage, ready = true) {
  const navigation = usePageNavigation();
  const register = navigation?.register;
  const report = navigation?.report;
  const latest = useRef(read);
  useLayoutEffect(() => {
    latest.current = read;
  });
  useLayoutEffect(() => {
    if (!register) return;
    const getter = () => latest.current();
    return register(getter);
  }, [register]);
  const page = read();
  useLayoutEffect(() => {
    if (ready) report?.({ key: page.key, title: page.title, icon: page.icon });
  }, [report, ready, page.key, page.title, page.icon]);
}
