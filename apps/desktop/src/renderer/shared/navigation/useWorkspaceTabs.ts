import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  activeTab,
  addTab,
  closeTab,
  createTabs,
  currentPage,
  rememberPage,
  reorderTab,
  type WorkspacePage,
  type WorkspaceTabs,
} from './workspace-tabs';

export function useWorkspaceTabs<T>({
  pageKey,
  title,
  getPage,
  restore,
  canLeave,
  newPage,
  ready,
}: {
  pageKey: string;
  title: string;
  getPage(): WorkspacePage<T>;
  restore(page: WorkspacePage<T>): Promise<boolean>;
  canLeave(): boolean;
  newPage(): WorkspacePage<T>;
  ready: boolean;
}) {
  const [session, setSession] = useState(() => createTabs(getPage()));
  const latest = useRef(session);
  const pending = useRef(false);
  const generation = useRef(0);
  const expected = useRef<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const callbacks = useRef({ getPage, restore, canLeave, newPage, ready });
  useLayoutEffect(() => {
    callbacks.current = { getPage, restore, canLeave, newPage, ready };
  });
  function update(next: WorkspaceTabs<T>) {
    latest.current = next;
    setSession(next);
  }
  // 这里只保留窗口会话的定位；正文/业务对象每次仍通过原受控入口读取。
  useEffect(() => {
    if (!ready || pending.current) return;
    if (expected.current && expected.current !== pageKey) return;
    expected.current = null;
    const page = callbacks.current.getPage();
    const old = currentPage(activeTab(latest.current));
    if (old.key === page.key && old.title === page.title) return;
    const next = rememberPage(latest.current, page);
    latest.current = next;
    setSession(next);
  }, [pageKey, title, ready, transitioning]);
  function capture() {
    // 普通页面导航可以取消尚未完成的历史读取；迟到结果不能回写标签或最近访问。
    generation.current++;
    pending.current = false;
    expected.current = null;
    setTransitioning(false);
    const next = rememberPage(latest.current, callbacks.current.getPage(), true);
    latest.current = next;
    setSession(next);
  }
  async function apply(build: (saved: WorkspaceTabs<T>) => WorkspaceTabs<T>) {
    if (pending.current || !callbacks.current.ready || !callbacks.current.canLeave()) return false;
    const saved = rememberPage(latest.current, callbacks.current.getPage(), true);
    const next = build(saved);
    const target = currentPage(activeTab(next));
    if (next.active === saved.active && target.key === currentPage(activeTab(saved)).key) {
      update(next);
      return true;
    }
    const token = ++generation.current;
    pending.current = true;
    setTransitioning(true);
    try {
      const restored = await callbacks.current.restore(target);
      if (token !== generation.current) return false;
      if (!restored) {
        update(saved);
        return false;
      }
      expected.current = target.key;
      update(rememberPage(next, target, true));
      return true;
    } catch {
      if (token === generation.current) update(saved);
      return false;
    } finally {
      if (token === generation.current) {
        pending.current = false;
        setTransitioning(false);
      }
    }
  }
  const actions = {
    capture,
    add: () => apply((saved) => addTab(saved, callbacks.current.newPage())),
    select: (id: number) => {
      if (id === latest.current.active || !latest.current.tabs.some((tab) => tab.id === id)) return;
      return apply((saved) => ({ ...saved, active: id }));
    },
    close: (id: number) => apply((saved) => closeTab(saved, id, callbacks.current.newPage())),
    move: (delta: number) => {
      const tab = activeTab(latest.current),
        index = tab.index + delta;
      if (index < 0 || index >= tab.entries.length) return;
      return apply((saved) => ({
        ...saved,
        tabs: saved.tabs.map((item) => (item.id === saved.active ? { ...item, index } : item)),
      }));
    },
    visit: (page: WorkspacePage<T>) => apply((saved) => rememberPage(saved, page)),
    reopen: () => {
      if (!latest.current.closed.length) return;
      return apply((saved) => ({
        ...saved,
        tabs: [...saved.tabs, saved.closed[0]],
        active: saved.closed[0].id,
        closed: saved.closed.slice(1),
      }));
    },
    reorder: (id: number, before: number) => update(reorderTab(latest.current, id, before)),
  };
  return { session, transitioning, ...actions };
}
