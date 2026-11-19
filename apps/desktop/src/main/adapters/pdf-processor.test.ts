import { beforeEach, describe, expect, it, vi } from 'vitest';

const entry = 'file:///synthetic/renderer/pdf_worker/index.html';

type IsolatedSession = {
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> };
};

const fake = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  function emitter() {
    const listeners = new Map<string, Set<Listener>>();
    const api = {
      on(event: string, listener: Listener) {
        const set = listeners.get(event) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(event, set);
        return api;
      },
      once(event: string, listener: Listener) {
        const wrapped: Listener = (...args) => {
          listeners.get(event)?.delete(wrapped);
          listener(...args);
        };
        return api.on(event, wrapped);
      },
      emit(event: string, ...args: unknown[]) {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
      },
      listenerCount(event: string) {
        return listeners.get(event)?.size ?? 0;
      },
    };
    return api;
  }
  const windows: Array<{
    options: {
      webPreferences: {
        preload?: string;
        sandbox: boolean;
        contextIsolation: boolean;
        nodeIntegration: boolean;
        nodeIntegrationInWorker: boolean;
        nodeIntegrationInSubFrames: boolean;
        webSecurity: boolean;
        allowRunningInsecureContent: boolean;
        webviewTag: boolean;
        devTools: boolean;
      };
    };
    webContents: ReturnType<typeof createContents>;
    listenerCount(event: string): number;
    isDestroyed(): boolean;
    emit(event: string, ...args: unknown[]): void;
  }> = [];
  const sessions: Array<{
    partition: string;
    options: { cache?: boolean };
    session: IsolatedSession;
  }> = [];
  let onLoad: ((contents: ReturnType<typeof createContents>) => void) | null = null;
  function createContents(session: IsolatedSession) {
    const contents = Object.assign(emitter(), {
      mainFrame: { url: '' },
      destroyed: false,
      session,
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.startsWith('window.caselitePdfWorker.open(')) return 1;
        if (script === 'window.caselitePdfWorker.page(1,true)') return { image: 'abc' };
        if (script === 'window.caselitePdfWorker.page(1,false)')
          return {
            page: 1,
            text: '合成',
            origin: 'pdf_text',
            blocks: [],
            width: 10,
            height: 10,
            rotation: 0,
          };
        throw new Error(`unexpected worker script: ${script}`);
      }),
      loadURL: vi.fn(async (url: string) => {
        contents.mainFrame.url = url;
        onLoad?.(contents);
      }),
      isDestroyed() {
        return contents.destroyed;
      },
    });
    return contents;
  }
  function createWindow(
    options: (typeof windows)[number]['options'] & {
      webPreferences: { session: IsolatedSession };
    },
  ) {
    const window = Object.assign(emitter(), {
      options,
      destroyed: false,
      webContents: createContents(options.webPreferences.session),
      isDestroyed() {
        return window.destroyed;
      },
      loadURL(url: string) {
        return window.webContents.loadURL(url);
      },
      destroy() {
        window.destroyed = true;
        window.webContents.destroyed = true;
        window.emit('closed');
      },
    });
    windows.push(window);
    return window;
  }
  return {
    windows,
    sessions,
    setOnLoad(listener: typeof onLoad) {
      onLoad = listener;
    },
    BrowserWindow: vi.fn(createWindow),
    fromPartition(partition: string, options: { cache?: boolean }) {
      const session: IsolatedSession = {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        on: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() },
      };
      sessions.push({ partition, options, session });
      return session;
    },
  };
});

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: fake.BrowserWindow,
  session: {
    fromPartition: (partition: string, options: { cache?: boolean }) =>
      fake.fromPartition(partition, options),
  },
}));

import { createPdfProcessor } from './pdf-processor';

const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

beforeEach(() => {
  fake.windows.length = 0;
  fake.sessions.length = 0;
  fake.setOnLoad(null);
  vi.clearAllMocks();
});

describe('isolated PDF processing window', () => {
  it('opens without business preload, keeps an in-memory session, and denies capabilities', async () => {
    const seen: boolean[] = [];
    let closedListeners = 0;
    const capabilities = await import('../ipc/window-capabilities');
    fake.setOnLoad((contents) => {
      const event = { sender: contents, senderFrame: contents.mainFrame };
      seen.push(
        capabilities.isTrustedBusinessSender(event),
        capabilities.isTrustedAppearanceSender(event),
        capabilities.isTrustedConsentSender(event),
        capabilities.isTrustedProbeSender(event),
      );
      closedListeners = fake.windows[0].listenerCount('closed');
    });
    const processor = createPdfProcessor(entry);
    await expect(processor.inspect(bytes)).resolves.toBe(1);
    const window = fake.windows[0];
    expect(window.options.webPreferences.preload).toBeUndefined();
    expect(window.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
    });
    expect(fake.sessions[0].partition.startsWith('caselite-pdf-view-')).toBe(true);
    expect(fake.sessions[0].partition.startsWith('persist:')).toBe(false);
    expect(fake.sessions[0].options).toEqual({ cache: false });
    expect(seen).toEqual([false, false, false, false]);
    expect(closedListeners).toBeGreaterThan(0);
    const allow = vi.fn();
    fake.sessions[0].session.setPermissionRequestHandler.mock.calls[0][0]({}, 'media', allow);
    expect(allow).toHaveBeenCalledWith(false);
    expect(fake.sessions[0].session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const download = { preventDefault: vi.fn() };
    const onDownload = fake.sessions[0].session.on.mock.calls.find(
      (call) => call[0] === 'will-download',
    )?.[1] as (event: { preventDefault(): void }) => void;
    onDownload(download);
    expect(download.preventDefault).toHaveBeenCalledOnce();
    expect(window.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const navigation = { preventDefault: vi.fn() };
    window.webContents.emit('will-navigate', navigation);
    window.webContents.emit('will-redirect', navigation);
    window.webContents.emit('will-attach-webview', navigation);
    expect(navigation.preventDefault).toHaveBeenCalledTimes(3);
    const policy = fake.sessions[0].session.webRequest.onBeforeRequest.mock.calls[0][0] as (
      details: { url: string },
      callback: (result: { cancel: boolean }) => void,
    ) => void;
    const decisions: Array<{ url: string; cancel: boolean }> = [];
    for (const url of [
      entry,
      'file:///synthetic/renderer/pdf-resources/cmaps/a.bcmap',
      'https://evil.example/pixel.png',
      'file:///etc/passwd',
      'blob:null/11111111-1111-4111-8111-111111111111',
    ]) {
      policy({ url }, (result) => decisions.push({ url, cancel: result.cancel }));
    }
    expect(decisions).toEqual([
      { url: entry, cancel: false },
      { url: 'file:///synthetic/renderer/pdf-resources/cmaps/a.bcmap', cancel: false },
      { url: 'https://evil.example/pixel.png', cancel: true },
      { url: 'file:///etc/passwd', cancel: true },
      { url: 'blob:null/11111111-1111-4111-8111-111111111111', cancel: false },
    ]);
    expect(window.isDestroyed()).toBe(true);
  });

  it('uses a new memory partition per document and only a fixed page script', async () => {
    const processor = createPdfProcessor(entry);
    await processor.inspect(bytes);
    await processor.inspect(Uint8Array.from([1, 2, 3]));
    expect(new Set(fake.sessions.map((item) => item.partition)).size).toBe(2);
    fake.windows.length = 0;
    if (!processor.render) throw new Error('missing render');
    const render = processor.render.bind(processor);
    await expect(render(bytes, [1])).resolves.toEqual(['abc']);
    const opened = fake.windows[0];
    expect(opened.webContents.executeJavaScript).toHaveBeenCalledWith(
      'window.caselitePdfWorker.page(1,true)',
    );
    await expect(render(bytes, [0])).rejects.toThrow('Image page budget');
    await expect(render(bytes, ['1);alert(1)' as unknown as number])).rejects.toThrow(
      'Image page budget',
    );
    const scripts = fake.windows.flatMap((window) =>
      window.webContents.executeJavaScript.mock.calls.map((call) => String(call[0])),
    );
    expect(scripts.some((script) => script.includes('alert'))).toBe(false);
    const pages: unknown[] = [];
    await processor.process(bytes, {
      ocr: false,
      previous: [],
      signal: new AbortController().signal,
      onPage: (page) => pages.push(page),
    });
    expect(pages).toMatchObject([{ page: 1, text: '合成', origin: 'pdf_text' }]);
  });

  it('does not construct a window for a remote worker entry', async () => {
    const processor = createPdfProcessor('https://evil.example/pdf_worker/index.html');
    await expect(processor.inspect(bytes)).rejects.toThrow('PDF_VIEWER_ENTRY');
    expect(fake.windows).toHaveLength(0);
    expect(fake.sessions).toHaveLength(0);
  });
});
