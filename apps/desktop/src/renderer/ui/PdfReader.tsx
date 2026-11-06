import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const options = {
  cMapUrl: new URL('../pdf-resources/cmaps/', document.baseURI).toString(),
  cMapPacked: true,
  standardFontDataUrl: new URL('../pdf-resources/standard_fonts/', document.baseURI).toString(),
  wasmUrl: new URL('../pdf-resources/wasm/', document.baseURI).toString(),
  isEvalSupported: false,
};

export default function PdfReader({
  bytes,
  name,
  onClose,
}: {
  bytes: Uint8Array;
  name: string;
  onClose(): void;
}) {
  // PDF.js 会转移底层 buffer；阅读器只消费副本，不能损坏暂存原件。
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(620);
  return (
    <section className="material-reader" aria-label="PDF 阅读器">
      <header>
        <strong>{name}</strong>
        <div>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span aria-label="材料页码">
            {page} / {pages || '…'}
          </span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            下一页
          </button>
          <button
            type="button"
            onClick={() => setWidth(Math.max(320, width - 100))}
            aria-label="缩小 PDF"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setWidth(Math.min(1400, width + 100))}
            aria-label="放大 PDF"
          >
            ＋
          </button>
          <button type="button" onClick={onClose}>
            收起阅读
          </button>
        </div>
      </header>
      <div className="material-paper">
        <Document
          file={file}
          options={options}
          onLoadSuccess={({ numPages }) => setPages(numPages)}
          onPassword={(_callback, _reason) => setPages(0)}
          loading={<p>正在打开 PDF…</p>}
          error={<p role="alert">无法打开 PDF：文件可能损坏或加密，请核对后重新选择。</p>}
        >
          <Page pageNumber={page} width={width} renderAnnotationLayer={false} />
        </Document>
      </div>
    </section>
  );
}
