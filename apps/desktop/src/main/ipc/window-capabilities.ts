import type { BrowserWindow } from 'electron';
import { isTrustedDesktopSender } from './register-application-ipc';

type Sender = Parameters<typeof isTrustedDesktopSender>[0];
type Capability = 'business' | 'appearance' | 'consent' | 'probe';
type Role = 'workbench' | 'consent';
type Grant = {
  window: BrowserWindow;
  entry: URL;
  role: Role;
  revision: number;
  invalidated: Set<() => void>;
};
const capabilities: Record<Role, readonly Capability[]> = {
  workbench: ['business', 'appearance', 'probe'],
  consent: ['appearance', 'consent'],
};

function matchesEntry(url: string, entry: URL) {
  try {
    const current = new URL(url);
    return (
      current.protocol === entry.protocol &&
      current.host === entry.host &&
      current.pathname === entry.pathname &&
      !current.username &&
      !current.password
    );
  } catch {
    return false;
  }
}

export function createDesktopWindowCapabilities() {
  const grants = new Map<unknown, Grant>();
  const requests = new WeakMap<object, { grant: Grant; revision: number }>();
  const invalidate = (grant: Grant) => {
    grant.revision++;
    const listeners = [...grant.invalidated];
    grant.invalidated.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // 先撤销授权；消费者清理失败不能恢复权限或阻断其他消费者的清理。
      }
    }
  };
  const access = {
    register(window: BrowserWindow, role: Role, entry: string) {
      const contents = window.webContents;
      const grant: Grant = {
        window,
        role,
        entry: new URL(entry),
        revision: 0,
        invalidated: new Set(),
      };
      const previous = grants.get(contents);
      if (previous) {
        grants.delete(contents);
        invalidate(previous);
      }
      grants.set(contents, grant);
      const revoke = () => {
        if (grants.get(contents) !== grant) return;
        grants.delete(contents);
        invalidate(grant);
      };
      // 只由宿主登记角色；解析/导出等未登记窗口即使存活、同URL也没有业务能力。
      window.once('closed', revoke);
      contents.once('destroyed', revoke);
      contents.once('render-process-gone', revoke);
      contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
        if (grants.get(contents) !== grant || !mainFrame || inPlace) return;
        // 允许原入口重载，但旧请求不能跨文档继续；新preload可在dom-ready前读取外观。
        if (!matchesEntry(url, grant.entry)) revoke();
        else invalidate(grant);
      });
      contents.on('did-navigate', (_event, url) => {
        if (!matchesEntry(url, grant.entry)) revoke();
      });
      return revoke;
    },
    onBusinessRevoked(event: Sender, listener: () => void) {
      if (!access.allows(event, 'business')) {
        listener();
        return () => {};
      }
      const grant = grants.get(event.sender)!;
      grant.invalidated.add(listener);
      return () => grant.invalidated.delete(listener);
    },
    allows(event: Sender, capability: Capability): boolean {
      try {
        const grant = grants.get(event.sender);
        if (
          !grant ||
          !capabilities[grant.role].includes(capability) ||
          grant.window.webContents.isDestroyed() ||
          !isTrustedDesktopSender(event, [grant.window]) ||
          !matchesEntry(event.senderFrame!.url, grant.entry)
        )
          return false;
        const previous = requests.get(event);
        if (previous) return previous.grant === grant && previous.revision === grant.revision;
        // 同一IPC事件的后续异步复验固定本代，不能因重载或重新登记而恢复旧授权。
        requests.set(event, { grant, revision: grant.revision });
        return true;
      } catch {
        return false;
      }
    },
  };
  return access;
}

const desktopWindows = createDesktopWindowCapabilities();
export const registerDesktopWindowCapabilities = desktopWindows.register;
export const onBusinessAccessRevoked = desktopWindows.onBusinessRevoked;
export const isTrustedBusinessSender = (event: Sender) => desktopWindows.allows(event, 'business');
export const isTrustedAppearanceSender = (event: Sender) =>
  desktopWindows.allows(event, 'appearance');
export const isTrustedConsentSender = (event: Sender) => desktopWindows.allows(event, 'consent');
export const isTrustedProbeSender = (event: Sender) => desktopWindows.allows(event, 'probe');
