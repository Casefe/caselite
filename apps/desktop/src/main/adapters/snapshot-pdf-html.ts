import * as Y from 'yjs';
import { validateBody } from '@caselite/local-db';
import type { DeliverySnapshot } from '@caselite/contracts';

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const invalidXml = (value: string) =>
  Array.from(value).some((char) => {
    const c = char.codePointAt(0)!;
    return c < 32 && ![9, 10, 13].includes(c);
  });
export function renderSnapshotPdfHtml(
  snapshot: DeliverySnapshot,
  state: Uint8Array,
  nonce: string,
) {
  if (
    !/^[a-f0-9]{32}$/.test(nonce) ||
    state.length > 2_000_000 ||
    snapshot.source_refs.length ||
    invalidXml(snapshot.title)
  )
    throw new Error('UNSUPPORTED_PDF_CONTENT');
  validateBody(state, true);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    let count = 0,
      textSize = 0;
    function visit(node: Y.XmlElement | Y.XmlText, depth: number, tableDepth = 0): string {
      if (++count > 20_000 || depth > 32) throw new Error('UNSUPPORTED_PDF_CONTENT');
      if (node instanceof Y.XmlText)
        return node
          .toDelta()
          .map((part: { insert: string; attributes?: Record<string, unknown> }) => {
            textSize += part.insert.length;
            if (textSize > 300_000 || invalidXml(part.insert))
              throw new Error('UNSUPPORTED_PDF_CONTENT');
            let value = escape(part.insert);
            const a = part.attributes ?? {};
            for (const [mark, tag] of [
              ['bold', 'strong'],
              ['italic', 'em'],
              ['strike', 's'],
              ['underline', 'u'],
              ['code', 'code'],
            ])
              if (a[mark]) value = `<${tag}>${value}</${tag}>`;
            return value;
          })
          .join('');
      const name = node.nodeName,
        a = node.getAttributes();
      const children = () =>
        node
          .toArray()
          .map((child) => visit(child as Y.XmlElement | Y.XmlText, depth + 1, tableDepth))
          .join('');
      if (name === 'paragraph') return `<p>${children() || '<br>'}</p>`;
      if (name === 'heading') {
        const level = Number(a.level ?? 1);
        if (level < 1 || level > 6) throw new Error('UNSUPPORTED_PDF_CONTENT');
        return `<h${level}>${children()}</h${level}>`;
      }
      if (name === 'blockquote') return `<blockquote>${children()}</blockquote>`;
      if (name === 'bulletList') return `<ul>${children()}</ul>`;
      if (name === 'orderedList') {
        const start = a.start ?? 1,
          type = a.type ?? '1';
        if (
          !Number.isSafeInteger(start) ||
          Number(start) < 1 ||
          Number(start) > 1_000_000 ||
          !['1', 'a', 'A', 'i', 'I'].includes(String(type))
        )
          throw new Error('UNSUPPORTED_PDF_CONTENT');
        return `<ol start="${start}" type="${type}">${children()}</ol>`;
      }
      if (name === 'listItem') return `<li>${children()}</li>`;
      if (name === 'codeBlock') return `<pre>${children()}</pre>`;
      if (name === 'hardBreak') return '<br>';
      if (name === 'horizontalRule') return '<hr>';
      if (name === 'table') {
        if (tableDepth) throw new Error('UNSUPPORTED_PDF_CONTENT');
        const rows = node.toArray() as Y.XmlElement[];
        const headerCount = rows.findIndex((row) =>
          (row.toArray() as Y.XmlElement[]).some((cell) => cell.nodeName !== 'tableHeader'),
        );
        const head = headerCount < 0 ? rows.length : headerCount;
        const safeHead = rows
          .slice(0, head)
          .every((row, i) =>
            (row.toArray() as Y.XmlElement[]).every(
              (cell) => Number(cell.getAttribute('rowspan') ?? 1) <= head - i,
            ),
          );
        const rowHtml = (row: Y.XmlElement) => visit(row, depth + 1, tableDepth + 1);
        return `<table>${head && safeHead ? `<thead>${rows.slice(0, head).map(rowHtml).join('')}</thead><tbody>${rows.slice(head).map(rowHtml).join('')}</tbody>` : `<tbody>${rows.map(rowHtml).join('')}</tbody>`}</table>`;
      }
      if (name === 'tableRow') return `<tr>${children()}</tr>`;
      if (name === 'tableCell' || name === 'tableHeader') {
        if (
          (a.colwidth != null &&
            (!Array.isArray(a.colwidth) || a.colwidth.some((width) => width !== 0))) ||
          (a.align && a.align !== 'left')
        )
          throw new Error('UNSUPPORTED_PDF_CONTENT');
        const tag = name === 'tableHeader' ? 'th' : 'td';
        return `<${tag} colspan="${Number(a.colspan ?? 1)}" rowspan="${Number(a.rowspan ?? 1)}">${children()}</${tag}>`;
      }
      throw new Error('UNSUPPORTED_PDF_CONTENT');
    }
    const body = doc
      .getXmlFragment('default')
      .toArray()
      .map((node) => visit(node as Y.XmlElement, 0))
      .join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'nonce-${nonce}'; style-src-attr 'none'; font-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.title)}（草稿）</title><style nonce="${nonce}">
@font-face{font-family:CaseLiteCJK;src:local("Songti SC Regular"),local("STSongti-SC-Regular");font-weight:normal;font-style:normal}
@font-face{font-family:CaseLiteCJK;src:local("Songti SC Bold"),local("STSongti-SC-Bold");font-weight:bold;font-style:normal}
@page{size:A4;margin:20mm}*{box-sizing:border-box}body{font:12pt/1.65 CaseLiteCJK,"Songti SC",serif;overflow-wrap:anywhere;color:#111}h1{font-size:22pt}h2{font-size:18pt}h3{font-size:16pt}h4,h5,h6{font-size:13pt}h1,h2,h3,h4,h5,h6{break-after:avoid;margin:16pt 0 8pt}p{white-space:pre-wrap;margin:0 0 8pt}li>p{margin:0}ul,ol{padding-left:24pt}blockquote{border-left:2pt solid #999;padding-left:12pt;margin:12pt}pre,code{font-family:monospace;white-space:pre-wrap}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12pt 0}th,td{border:0.6pt solid #555;padding:5pt;vertical-align:top}th{background:#eee}td p,th p{margin:0}tr{break-inside:avoid}thead{display:table-header-group}.draft,.provenance{font-size:9pt;color:#666}.provenance{margin-top:16pt;border-top:0.5pt solid #aaa;padding-top:6pt}
</style></head><body><p class="draft">草稿 · 未经法律核验</p><h1>${escape(snapshot.title)}</h1>${body}<p class="provenance">快照 ${snapshot.id} · 正文修订 ${snapshot.body_revision}<br>正文摘要 ${snapshot.content_sha256}</p></body></html>`;
  } finally {
    doc.destroy();
  }
}
