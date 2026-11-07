import { PDF_BUDGET, PDF_CANVAS_PIXELS } from '../pdf-budget';
import type { TextPage } from '../../preload/caselite-api';
import { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const options = {
  ...PDF_BUDGET,
  cMapUrl: new URL('../pdf-resources/cmaps/', document.baseURI).toString(),
  cMapPacked: true,
  standardFontDataUrl: new URL('../pdf-resources/standard_fonts/', document.baseURI).toString(),
  wasmUrl: new URL('../pdf-resources/wasm/', document.baseURI).toString(),
};

export default function PdfReader({
  bytes,
  name,
  onClose,
  textPages = [],
  initialWidth = 620,
}: {
  bytes: Uint8Array;
  textPages?: TextPage[];
  name: string;
  initialWidth?: number;
  onClose(): void;
}) {
  // PDF.js 会转移底层 buffer；阅读器只消费副本，不能损坏暂存原件。
  const file = useMemo(() => ({ data: bytes.slice() }), [bytes]);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [dimensions, setDimensions] = useState<{ page: number; ratio: number } | null>(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failure, setFailure] = useState('');
  const [width, setWidth] = useState(initialWidth);
  useEffect(() => {
    let stopped = false;
    if (pdf)
      void pdf
        .getPage(page)
        .then((loaded) => {
          const v = loaded.getViewport({ scale: 1 });
          if (!stopped) setDimensions({ page, ratio: v.height / v.width });
        })
        .catch(() => {
          if (!stopped) setFailure('无法读取页面尺寸，请核对原件。');
        });
    return () => {
      stopped = true;
    };
  }, [pdf, page]);
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
        {failure ? (
          <p role="alert">{failure}</p>
        ) : (
          <Document
            suspense={false}
            file={file}
            options={options}
            onLoadSuccess={(loaded) => {
              setPages(loaded.numPages);
              setPdf(loaded);
            }}
            onPassword={() => setFailure('此 PDF 已加密，请在本地解锁副本后重新导入。')}
            loading={<p>正在打开 PDF…</p>}
            error={<p role="alert">无法打开 PDF：文件可能损坏或加密，请核对后重新选择。</p>}
          >
            {dimensions?.page === page && (
              <Page
                suspense={false}
                pageNumber={page}
                width={Math.min(
                  width,
                  Math.sqrt(PDF_CANVAS_PIXELS / Math.max(dimensions.ratio, 0.01)),
                )}
                devicePixelRatio={1}
                onRenderError={() => setFailure('此页超出阅读预算或无法完整解析，请核对原件。')}
                renderAnnotationLayer={false}
              />
            )}
          </Document>
        )}
      </div>
      {textPages.find((item) => item.page === page) && (
        <section className="material-recognized" aria-label="本页提取文字">
          <strong>
            {textPages.find((item) => item.page === page)?.origin === 'ocr_candidate'
              ? '本地 OCR 文字 · 待核对'
              : '本页文字'}
          </strong>
          {textPages.find((item) => item.page === page)?.origin === 'ocr_candidate' && (
            <p>低清扫描可能错字或漏行。请对照原页核对金额、日期和条款，再纳入 AI 分析。</p>
          )}
          <pre>
            {textPages.find((item) => item.page === page)?.text ||
              '该页尚无可用文字，请运行本地 OCR。'}
          </pre>
        </section>
      )}
    </section>
  );
}
