export type WorkspacePage<T> = { key: string; title: string; icon: string; state: T };
export type WorkspaceTab<T> = {
  id: number;
  entries: WorkspacePage<T>[];
  index: number;
};
export type WorkspaceTabs<T> = {
  tabs: WorkspaceTab<T>[];
  active: number;
  nextId: number;
  recent: WorkspacePage<T>[];
  closed: WorkspaceTab<T>[];
};
export function currentPage<T>(tab: WorkspaceTab<T>) {
  return tab.entries[tab.index];
}
export function activeTab<T>(session: WorkspaceTabs<T>) {
  return session.tabs.find((tab) => tab.id === session.active)!;
}
export function createTabs<T>(page: WorkspacePage<T>): WorkspaceTabs<T> {
  return {
    tabs: [{ id: 1, entries: [page], index: 0 }],
    active: 1,
    nextId: 2,
    recent: [page],
    closed: [],
  };
}
export function rememberPage<T>(
  session: WorkspaceTabs<T>,
  page: WorkspacePage<T>,
  replace = false,
) {
  const tab = activeTab(session);
  const same = currentPage(tab).key === page.key;
  const entries =
    same || replace
      ? tab.entries.map((entry, index) => (index === tab.index ? page : entry))
      : [...tab.entries.slice(0, tab.index + 1), page].slice(-50);
  return {
    ...session,
    tabs: session.tabs.map((item) =>
      item.id === tab.id
        ? { ...item, entries, index: same || replace ? tab.index : entries.length - 1 }
        : item,
    ),
    recent:
      page.key === 'new-tab'
        ? session.recent
        : [page, ...session.recent.filter((entry) => entry.key !== page.key)].slice(0, 30),
  };
}
export function addTab<T>(session: WorkspaceTabs<T>, page: WorkspacePage<T>) {
  return {
    ...session,
    tabs: [...session.tabs, { id: session.nextId, entries: [page], index: 0 }],
    active: session.nextId,
    nextId: session.nextId + 1,
  };
}
export function closeTab<T>(session: WorkspaceTabs<T>, id: number, fallback: WorkspacePage<T>) {
  const index = session.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return session;
  const closing = session.tabs[index];
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  const next = {
    ...session,
    tabs,
    active:
      id === session.active ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? 0) : session.active,
    closed: [closing, ...session.closed].slice(0, 10),
  };
  return tabs.length ? next : addTab(next, fallback);
}
export function reorderTab<T>(session: WorkspaceTabs<T>, id: number, before: number) {
  if (id === before) return session;
  const moving = session.tabs.find((tab) => tab.id === id);
  if (!moving || !session.tabs.some((tab) => tab.id === before)) return session;
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  tabs.splice(
    tabs.findIndex((tab) => tab.id === before),
    0,
    moving,
  );
  return { ...session, tabs };
}
