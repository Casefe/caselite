import { app, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { release } from 'node:os';
import { MATERIAL_MAX_PAGES, textPageSchema, type TextPage } from '@caselite/contracts';
import type { PdfProcessorPort } from '@caselite/application';
export function createPdfProcessor(): PdfProcessorPort {
  async function open(bytes: Uint8Array, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Cancelled');
    const window = new BrowserWindow({
      show: false,
      width: 32,
      height: 32,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        backgroundThrottling: false,
        partition: 'caselite-pdf-processing',
      },
    });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: /^https?:/i.test(details.url) }),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.on('will-redirect', (e) => e.preventDefault());
    window.webContents.on('will-attach-webview', (e) => e.preventDefault());
    const close = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', close);
      if (!window.isDestroyed()) window.destroy();
    };
    const timer = setTimeout(close, 30_000);
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) {
      close();
      throw new Error('Cancelled');
    }
    try {
      await window.loadURL(PDF_WORKER_WEBPACK_ENTRY);
      const pages = (await window.webContents.executeJavaScript(
        `window.caselitePdfWorker.open(${JSON.stringify(Buffer.from(bytes).toString('base64'))})`,
      )) as number;
      if (!Number.isSafeInteger(pages) || pages < 1 || pages > MATERIAL_MAX_PAGES)
        throw new Error('PDF page budget');
      clearTimeout(timer);
      return {
        window,
        pages,
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  }
  async function vision(image: string, signal: AbortSignal): Promise<TextPage['blocks']> {
    const executable = app.isPackaged
      ? join(process.resourcesPath, 'caselite-vision')
      : resolve(process.cwd(), '../../artifacts/native/caselite-vision');
    return new Promise((done, reject) => {
      const child = execFile(
        executable,
        [],
        {
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024,
          signal,
          env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
        },
        (error, stdout) => {
          if (error) {
            reject(new Error('Local OCR failed'));
            return;
          }
          try {
            done(textPageSchema.shape.blocks.parse(JSON.parse(stdout)));
          } catch {
            reject(new Error('Invalid local OCR result'));
          }
        },
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(Buffer.from(image, 'base64'));
    });
  }
  return {
    configuration: `pdfjs-6.3.289_vision-r3-accurate_zh-Hans-zh-Hant-en_v1_scale2_8MP_macos-${release()}`,
    async render(bytes, pages, signal) {
      const worker = await open(bytes, signal);
      const timer = setTimeout(worker.close, 60_000);
      try {
        if (pages.length > 12 || pages.some((page) => page < 1 || page > worker.pages))
          throw new Error('Image page budget');
        const images: string[] = [];
        let size = 0;
        for (const page of pages) {
          const raw = (await worker.window.webContents.executeJavaScript(
            `window.caselitePdfWorker.page(${page},true)`,
          )) as { image?: string };
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
          const raw = (await worker.window.webContents.executeJavaScript(
            `window.caselitePdfWorker.page(${number},${input.ocr})`,
          )) as TextPage & { image?: string };
          let page = textPageSchema.parse(raw);
          if (input.ocr && raw.image) {
            const blocks = await vision(raw.image, input.signal);
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
