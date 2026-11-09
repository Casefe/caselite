import { BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DeliverySnapshot, DeliveryExport } from '@caselite/contracts';
import { renderSnapshotPdfHtml } from './snapshot-pdf-html';

export async function generateSnapshotPdf(
  snapshot: DeliverySnapshot,
  state: number[],
  signal?: AbortSignal,
  converter: DeliveryExport['converter'] = 'electron-45.1.0-pdf-v2',
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const nonce = randomUUID().replaceAll('-', '');
  let html: string;
  try {
    if (!['electron-45.1.0-pdf-v1', 'electron-45.1.0-pdf-v2'].includes(converter))
      throw new Error('Unsupported converter');
    html = renderSnapshotPdfHtml(
      snapshot,
      new Uint8Array(state),
      nonce,
      converter === 'electron-45.1.0-pdf-v1',
    );
  } catch {
    throw new Error('UNSUPPORTED_PDF_CONTENT');
  }
  const isolated = session.fromPartition(`caselite-pdf-${nonce}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: details.url !== url }),
  );
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      javascript: true,
      devTools: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await Promise.race([
      (async () => {
        await window.loadURL(url);
        // HTML不含脚本；宿主只执行固定字体检查，不把用户文字拼入可执行代码。
        const loaded = await window.webContents.executeJavaScript(
          `Promise.all([document.fonts.load('12px CaseLiteCJK','中文'),document.fonts.load('bold 12px CaseLiteCJK','中文')]).then(fonts => fonts.every(face => face.length > 0)).catch(() => false)`,
        );
        if (!loaded) throw new Error('PDF_FONT_UNAVAILABLE');
        signal?.throwIfAborted();
        const bytes = await window.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          generateTaggedPDF: true,
        });
        if (bytes.length > 20_000_000 || bytes.subarray(0, 5).toString() !== '%PDF-')
          throw new Error('Invalid PDF output');
        return new Uint8Array(bytes);
      })(),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error('Export cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        timer = setTimeout(() => reject(new Error('PDF print timeout')), 15000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (!window.isDestroyed()) window.destroy();
    isolated.webRequest.onBeforeRequest(null);
  }
}
