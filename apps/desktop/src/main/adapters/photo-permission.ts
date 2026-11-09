type WindowIdentity = {
  id: number;
  isDestroyed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
};
export function createPhotoPermissionGate<Window extends WindowIdentity>(input: {
  trusted(window: Window): boolean;
  askSystem(): Promise<boolean>;
  now?(): number;
}) {
  const grants = new Map<number, number>(),
    watched = new WeakSet<Window>();
  const now = input.now ?? Date.now;
  return {
    async prepare(window: Window) {
      if (window.isDestroyed() || !input.trusted(window)) return false;
      let allowed: boolean;
      try {
        allowed = await input.askSystem();
      } catch {
        allowed = false;
      }
      if (!allowed || window.isDestroyed() || !input.trusted(window)) return false;
      grants.set(window.id, now() + 30_000);
      if (!watched.has(window)) {
        watched.add(window);
        window.once('destroyed', () => grants.delete(window.id));
      }
      return true;
    },
    revoke(window: Window) {
      grants.delete(window.id);
    },
    permits(
      window: Window | null,
      permission: string,
      details: { mediaType?: string; mediaTypes?: string[]; isMainFrame?: boolean },
    ) {
      if (
        details.isMainFrame === false ||
        !window ||
        window.isDestroyed() ||
        !input.trusted(window) ||
        permission !== 'media'
      )
        return false;
      if ((grants.get(window.id) ?? 0) <= now()) {
        grants.delete(window.id);
        return false;
      }
      const kinds = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
      return kinds.length > 0 && kinds.every((kind) => kind === 'video');
    },
  };
}
