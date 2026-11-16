import { randomUUID } from 'node:crypto';
import { BrowserWindow, session } from 'electron';
import { recognizeLocalImage } from './local-vision';
import { release } from 'node:os';
import { MATERIAL_MAX_PAGES, textPageSchema, type TextPage } from '@caselite/contracts';
import type { PdfProcessorPort } from '@caselite/application';
import { registerDesktopWindowCapabilities } from '../ipc/window-capabilities';
import {
  assertPdfWorkerEntry,
  bindPdfReading,
  openFixedPdfSource,
  pdfViewerResourceAllowed,
  pdfWorkerPageExpression,
  type FixedPdfSource,
} from '../pdf-viewer-host';

type OpenedPdf = {
  window: BrowserWindow;
  pages: number;
  source: FixedPdfSource;
  close(): void;
};

export function createPdfProcessor(workerEntry = PDF_WORKER_WEBPACK_ENTRY): PdfProcessorPort {
  async function open(bytes: Uint8Array, signal?: AbortSignal): Promise<OpenedPdf> {
    if (signal?.aborted) throw new Error('Cancelled');
    assertPdfWorkerEntry(workerEntry);
    // 每份原件使用独立内存 Session，不挂业务 preload，也不把上一份 PDF 的存储留给下一份。
    const isolated = session.fromPartition(`caselite-pdf-view-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on('will-download', (event) => event.preventDefault());
    const window = new BrowserWindow({
      show: false,
      width: 32,
      height: 32,
      webPreferences: {
        session: isolated,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        backgroundThrottling: false,
        devTools: false,
      },
    });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !pdfViewerResourceAllowed(workerEntry, details.url) }),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    let revoke = () => {};
    const close = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', close);
      revoke();
      if (!window.isDestroyed()) window.destroy();
    };
    const timer = setTimeout(close, 30_000);
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) {
      close();
      throw new Error('Cancelled');
    }
    try {
      revoke = registerDesktopWindowCapabilities(window, 'pdf-view', workerEntry);
      await window.loadURL(workerEntry);
      const pages = (await window.webContents.executeJavaScript(
        `window.caselitePdfWorker.open(${JSON.stringify(Buffer.from(bytes).toString('base64'))})`,
      )) as number;
      if (!Number.isSafeInteger(pages) || pages < 1 || pages > MATERIAL_MAX_PAGES)
        throw new Error('PDF page budget');
      clearTimeout(timer);
      return { window, pages, source: openFixedPdfSource(bytes, pages), close };
    } catch (error) {
      close();
      throw error;
    }
  }
  async function readPage(worker: OpenedPdf, page: number, ocr: boolean) {
    const bound = bindPdfReading(worker.source, {
      asset_sha256: worker.source.asset_sha256,
      source_version_id: worker.source.source_version_id,
      page,
    });
    return worker.window.webContents.executeJavaScript(pdfWorkerPageExpression(bound.page, ocr));
  }
  return {
    configuration: `pdfjs-6.3.289_vision-r3-accurate_zh-Hans-zh-Hant-en_v1_scale2_8MP_macos-${release()}`,
    async render(bytes, pages, signal) {
      const worker = await open(bytes, signal);
      const timer = setTimeout(worker.close, 60_000);
      try {
        if (
          pages.length > 12 ||
          pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > worker.pages)
        )
          throw new Error('Image page budget');
        const images: string[] = [];
        let size = 0;
        for (const page of pages) {
          const raw = (await readPage(worker, page, true)) as { image?: string };
          if (!raw.image) throw new Error('Image missing');
          size += raw.image.length;
          if (size > 24 * 1024 * 1024) throw new Error('Image byte budget');
          images.push(raw.image);
        }
        return images;
      } finally {
        clearTimeout(timer);
        worker.close();
      }
    },
    async inspect(bytes) {
      const worker = await open(bytes);
      try {
        return worker.pages;
      } finally {
        worker.close();
      }
    },
    async process(bytes, input) {
      const worker = await open(bytes, input.signal);
      const budget = setTimeout(() => worker.close(), 900_000);
      const stop = () => worker.close();
      input.signal.addEventListener('abort', stop, { once: true });
      try {
        for (let number = 1; number <= worker.pages; number++) {
          if (input.signal.aborted) throw new Error('Cancelled');
          const old = input.previous.find((page) => page.page === number);
          if (old && (old.origin === 'pdf_text' || old.origin === 'ocr_candidate')) continue;
          const raw = (await readPage(worker, number, input.ocr)) as TextPage & { image?: string };
          let page = textPageSchema.parse(raw);
          if (input.ocr && raw.image) {
            const blocks = await recognizeLocalImage(
              Buffer.from(raw.image, 'base64'),
              input.signal,
            );
            page = {
              ...page,
              text: blocks.map((block) => block.text).join('\n'),
              origin: blocks.some((block) => block.text.trim()) ? 'ocr_candidate' : 'failed',
              blocks,
            };
          }
          if (input.signal.aborted) throw new Error('Cancelled');
          input.onPage(page);
        }
      } finally {
        clearTimeout(budget);
        input.signal.removeEventListener('abort', stop);
        worker.close();
      }
    },
  };
}
