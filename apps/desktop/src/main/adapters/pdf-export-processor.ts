import { assertExportFontCoverage } from './export-font-coverage';
import { BrowserWindow, session } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import {
  exportConfigurationSchema,
  type ExportConfiguration,
  type DeliverySnapshot,
  type DeliveryExport,
} from '@caselite/contracts';
import { renderSnapshotPdfHtml } from './snapshot-pdf-html';

export async function generateSnapshotPdf(
  snapshot: DeliverySnapshot,
  state: number[],
  signal?: AbortSignal,
  converter: DeliveryExport['converter'] = 'electron-45.1.0-pdf-v2',
  configuration?: ExportConfiguration,
  fontData?: Uint8Array,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const nonce = randomUUID().replaceAll('-', '');
  let html: string;
  try {
    if (
      !['electron-45.1.0-pdf-v1', 'electron-45.1.0-pdf-v2', 'electron-45.1.0-pdf-v3'].includes(
        converter,
      ) ||
      Boolean(configuration) !== (converter === 'electron-45.1.0-pdf-v3')
    )
      throw new Error('Unsupported converter');
    if (
      configuration &&
      (!fontData ||
        fontData.length > 100_000_000 ||
        createHash('sha256').update(fontData).digest('hex') !== configuration.font.sha256)
    )
      throw new Error('PDF_FONT_UNAVAILABLE');
    html = renderSnapshotPdfHtml(
      snapshot,
      new Uint8Array(state),
      nonce,
      converter === 'electron-45.1.0-pdf-v1',
      configuration ? exportConfigurationSchema.parse(configuration) : undefined,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'PDF_FONT_UNAVAILABLE') throw error;
    throw new Error('UNSUPPORTED_PDF_CONTENT', { cause: error });
  }
  const style = configuration?.style;
  if (fontData && style) assertExportFontCoverage(fontData, html + style.header + style.footer);
  const escape = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  // 只有受控页码占位会生成span，用户文字始终转义，不执行HTML/脚本。
  const fontUrl = configuration ? `https://caselite-print.invalid/${nonce}/font.ttf` : '';
  const running = (value: string) =>
    `<div style="width:100%;font-family:'${configuration?.font.family}';font-size:9pt;padding:0 ${style?.margins.right}mm 0 ${style?.margins.left}mm">${escape(value).replaceAll('{page}', '<span class="pageNumber"></span>').replaceAll('{pages}', '<span class="totalPages"></span>')}</div>`;
  const isolated = session.fromPartition(`caselite-pdf-${nonce}`, { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  const url = configuration
    ? `https://caselite-print.invalid/${nonce}/document`
    : 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  if (configuration) {
    // 仅本次隔离Session截获两个精确URL；不启动端口、不访问网络/任意文件，也不注册全局协议。
    isolated.protocol.handle('https', (request) => {
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      if (request.url === url)
        return new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      if (request.url === fontUrl)
        return new Response(fontData!.slice().buffer, {
          headers: {
            'content-type': 'font/ttf',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
          },
        });
      return new Response(null, { status: 403 });
    });
  }
  isolated.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: details.url !== url && (!fontUrl || details.url !== fontUrl) }),
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
          pageSize: style?.paper ?? 'A4',
          ...(style
            ? {
                margins: {
                  top: style.margins.top / 25.4,
                  right: style.margins.right / 25.4,
                  bottom: style.margins.bottom / 25.4,
                  left: style.margins.left / 25.4,
                },
                displayHeaderFooter: Boolean(style.header || style.footer),
                headerTemplate: style.header ? running(style.header) : '<span></span>',
                footerTemplate: style.footer ? running(style.footer) : '<span></span>',
              }
            : {}),
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
    if (configuration) isolated.protocol.unhandle('https');
  }
}
