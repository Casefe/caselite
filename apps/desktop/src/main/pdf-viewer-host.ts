import { createHash } from 'node:crypto';
import { MATERIAL_MAX_CONTEXT, MATERIAL_MAX_PAGES } from '@caselite/contracts';

// 不可信 PDF 只在固定离线入口内解析。此策略不放宽 CSP，也不提供业务 preload、任意磁盘或可跨文档保留的凭据。
export const PDF_WORKER_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export type FixedPdfSource = {
  readonly asset_sha256: string;
  readonly page_count: number;
  readonly source_version_id: string | null;
};

export type PdfReadingRequest = {
  readonly asset_sha256: string;
  readonly page: number;
  readonly source_version_id?: string | null;
  readonly quote?: string;
};

export type BoundPdfReading = {
  readonly asset_sha256: string;
  readonly source_version_id: string | null;
  readonly page: number;
  readonly quote: string | null;
};

function assertSha256(value: string) {
  if (!SHA256.test(value)) throw new Error('PDF_SOURCE_MISMATCH');
}

function assertVersion(value: string | null) {
  if (value !== null && !UUID.test(value)) throw new Error('PDF_SOURCE_MISMATCH');
}

export function assertPdfWorkerEntry(entry: string): URL {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error('PDF_VIEWER_ENTRY');
  }
  // 入口本身不能携带凭据，也不能指向任意远端；打包入口是 file，开发服务器只接受本机。
  if (url.username || url.password) throw new Error('PDF_VIEWER_ENTRY');
  if (url.protocol === 'file:') return url;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname))
    return url;
  throw new Error('PDF_VIEWER_ENTRY');
}

function fileResourceRoot(pathname: string): string | null {
  const marker = '/pdf_worker/';
  const at = pathname.lastIndexOf(marker);
  if (at > 0) {
    const root = pathname.slice(0, at + 1);
    return root === '/' ? null : root;
  }
  const directory = pathname.replace(/[^/]*$/, '');
  if (directory.length < 2) return null;
  return directory;
}

function fileAllowed(entry: URL, requestPath: string) {
  if (requestPath === entry.pathname) return true;
  const root = fileResourceRoot(entry.pathname);
  // 根目录不能作为资源根，否则 file 阅读器会变成任意磁盘读取。
  return root !== null && root !== '/' && requestPath.startsWith(root);
}

export function pdfViewerResourceAllowed(entryHref: string, requestUrl: string) {
  // blob/data 没有主机和磁盘路径；PDF.js 在 file 入口用 blob Worker，页面画布用 data。
  if (/^(?:blob|data):/i.test(requestUrl)) return true;
  let entry: URL;
  let request: URL;
  try {
    entry = new URL(entryHref);
    request = new URL(requestUrl);
  } catch {
    return false;
  }
  if (request.username || request.password || entry.username || entry.password) return false;
  if (request.protocol !== entry.protocol || request.host !== entry.host) return false;
  if (request.protocol === 'file:') return fileAllowed(entry, request.pathname);
  // 外链图片、脚本和凭据端点一律取消。http 开发入口也不能借阅读器访问网络。
  return false;
}

export function openFixedPdfSource(
  bytes: Uint8Array,
  pageCount: number,
  sourceVersionId?: string,
): FixedPdfSource {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1)
    throw new Error('PDF_SOURCE_MISMATCH');
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MATERIAL_MAX_PAGES)
    throw new Error('PDF_PAGE_MISSING');
  const source_version_id = sourceVersionId ?? null;
  assertVersion(source_version_id);
  return Object.freeze({
    asset_sha256: createHash('sha256').update(bytes).digest('hex'),
    page_count: pageCount,
    source_version_id,
  });
}

export function bindPdfReading(
  source: FixedPdfSource,
  request: PdfReadingRequest,
): BoundPdfReading {
  assertSha256(source.asset_sha256);
  assertSha256(request.asset_sha256);
  assertVersion(source.source_version_id);
  const source_version_id = request.source_version_id ?? null;
  assertVersion(source_version_id);
  // 选区和页码必须点名同一字节身份；省略或替换哈希都不能改绑到另一份原件。
  if (
    request.asset_sha256 !== source.asset_sha256 ||
    source_version_id !== source.source_version_id
  )
    throw new Error('PDF_SOURCE_MISMATCH');
  if (!Number.isSafeInteger(request.page) || request.page < 1 || request.page > source.page_count)
    throw new Error('PDF_PAGE_MISSING');
  if (
    request.quote !== undefined &&
    (typeof request.quote !== 'string' ||
      request.quote.length < 1 ||
      request.quote.length > MATERIAL_MAX_CONTEXT)
  )
    throw new Error('PDF_SELECTION_REJECTED');
  return Object.freeze({
    asset_sha256: source.asset_sha256,
    source_version_id: source.source_version_id,
    page: request.page,
    quote: request.quote ?? null,
  });
}

export function pdfWorkerPageExpression(page: number, ocr: boolean) {
  // 只允许拼入已绑定的安全整数和布尔字面量，调用方字符串不能进入脚本。
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > MATERIAL_MAX_PAGES ||
    typeof ocr !== 'boolean'
  )
    throw new Error('PDF_PAGE_MISSING');
  return `window.caselitePdfWorker.page(${page},${ocr ? 'true' : 'false'})`;
}
