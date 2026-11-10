import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it } from 'vitest';
import { createDesktopWindowCapabilities } from './window-capabilities';

const entry = 'file:///synthetic/中文%20路径/workbench.html';
function fakeWindow() {
  const contents = Object.assign(new EventEmitter(), {
    id: 7,
    mainFrame: { url: entry },
    isDestroyed: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
  }) as unknown as BrowserWindow;
  return { window, contents, event: () => ({ sender: contents, senderFrame: contents.mainFrame }) };
}

describe('host-owned desktop window capabilities', () => {
  it('denies unregistered windows even with the same URL and reused numeric identity', () => {
    const access = createDesktopWindowCapabilities();
    const trusted = fakeWindow(),
      other = fakeWindow();
    access.register(trusted.window, 'workbench', entry);
    expect(access.allows(trusted.event(), 'business')).toBe(true);
    expect(access.allows(other.event(), 'business')).toBe(false);
    expect(access.allows({ ...trusted.event(), senderFrame: { url: entry } }, 'business')).toBe(
      false,
    );
    expect(access.allows({ ...trusted.event(), sender: {} }, 'business')).toBe(false);
    expect(access.allows({ ...trusted.event(), senderFrame: null }, 'business')).toBe(false);
  });

  it('gives the consent role only initial appearance and consent access', () => {
    const access = createDesktopWindowCapabilities(),
      w = fakeWindow();
    access.register(w.window, 'consent', entry);
    expect(access.allows(w.event(), 'appearance')).toBe(true);
    expect(access.allows(w.event(), 'consent')).toBe(true);
    expect(access.allows(w.event(), 'business')).toBe(false);
    expect(access.allows(w.event(), 'probe')).toBe(false);
    access.register(w.window, 'workbench', entry);
    expect(access.allows(w.event(), 'consent')).toBe(false);
  });

  it.each(['closed', 'destroyed', 'render-process-gone', 'explicit'])(
    'revokes access on %s and never revives an old request after registration',
    (reason) => {
      const access = createDesktopWindowCapabilities(),
        w = fakeWindow();
      const revoke = access.register(w.window, 'workbench', entry),
        pending = w.event();
      expect(access.allows(pending, 'business')).toBe(true);
      if (reason === 'explicit') revoke();
      else (reason === 'closed' ? w.window : w.contents).emit(reason);
      expect(access.allows(w.event(), 'business')).toBe(false);
      access.register(w.window, 'workbench', entry);
      revoke();
      expect(access.allows(pending, 'business')).toBe(false);
      expect(access.allows(w.event(), 'business')).toBe(true);
    },
  );

  it('invalidates pending requests across reload while allowing the new preload before DOM ready', () => {
    const access = createDesktopWindowCapabilities(),
      w = fakeWindow();
    access.register(w.window, 'workbench', entry);
    const pending = w.event();
    expect(access.allows(pending, 'business')).toBe(true);
    w.contents.emit('did-start-navigation', {}, entry + '?engineering=1', false, true);
    expect(access.allows(pending, 'business')).toBe(false);
    expect(access.allows(w.event(), 'appearance')).toBe(true);
    expect(access.allows(w.event(), 'business')).toBe(true);
  });

  it('does not revoke on subframe or same-document navigation, but rejects a different entry', () => {
    const access = createDesktopWindowCapabilities(),
      w = fakeWindow();
    access.register(w.window, 'workbench', entry);
    const pending = w.event();
    expect(access.allows(pending, 'business')).toBe(true);
    w.contents.emit('did-start-navigation', {}, 'https://untrusted.invalid', false, false);
    w.contents.emit('did-start-navigation', {}, entry + '#section', true, true);
    expect(access.allows(pending, 'business')).toBe(true);
    w.contents.emit('did-start-navigation', {}, 'about:blank', false, true);
    expect(access.allows(w.event(), 'business')).toBe(false);
  });

  it.each(['file:///synthetic/other.html', 'https://untrusted.invalid', 'not a URL'])(
    'rejects unexpected frame URL %s even if object identities match',
    (url) => {
      const access = createDesktopWindowCapabilities(),
        w = fakeWindow();
      access.register(w.window, 'workbench', entry);
      w.contents.mainFrame.url = url;
      expect(access.allows(w.event(), 'business')).toBe(false);
    },
  );
});
