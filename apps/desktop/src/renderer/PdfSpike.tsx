import { useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// Webpack emits this as a local asset. No CDN, customer file or filesystem
// capability is exposed to the renderer by this isolated compatibility spike.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

declare global {
  interface Window {
    __caselitePdfNativeWorker?: boolean;
  }
}

const workerProbe = new pdfjs.PDFWorker();
void workerProbe.promise
  .then(() => {
    window.__caselitePdfNativeWorker =
      typeof Worker === 'function' && workerProbe.port instanceof Worker;
    workerProbe.destroy();
  })
  .catch(() => {
    window.__caselitePdfNativeWorker = false;
  });

const fixtures = [
  {
    label: '合同 v1（文字 PDF）',
    url: new URL(
      '../../../../tests/fixtures/case-materials/development/contract-v1-text.pdf',
      import.meta.url,
    ).toString(),
    expectedText: true,
  },
  {
    label: '合同 v1（扫描 PDF）',
    url: new URL(
      '../../../../tests/fixtures/case-materials/development/contract-v1-scan.pdf',
      import.meta.url,
    ).toString(),
    expectedText: false,
  },
  {
    label: '双页重复文字',
    url: new URL(
      '../../../../tests/fixtures/case-materials/development/anchor-repeat-two-pages.pdf',
      import.meta.url,
    ).toString(),
    expectedText: true,
  },
  {
    label: '损坏 PDF（预期报错）',
    url: new URL(
      '../../../../tests/fixtures/case-materials/development/damaged.pdf',
      import.meta.url,
    ).toString(),
    expectedText: false,
  },
] as const;

const pdfOptions = {
  cMapUrl: new URL('../pdf-resources/cmaps/', document.baseURI).toString(),
  standardFontDataUrl: new URL('../pdf-resources/standard_fonts/', document.baseURI).toString(),
  wasmUrl: new URL('../pdf-resources/wasm/', document.baseURI).toString(),
};

export default function PdfSpike() {
  const [fixtureIndex, setFixtureIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const fixture = fixtures[fixtureIndex];
  const file = useMemo(() => fixture.url, [fixture]);

  return (
    <section aria-label="DEV-1568 PDF 离线测试页">
      <h2>PDF 离线兼容测试</h2>
      <p>仅使用仓库中的合成样本；此页不保存案件、引用或锚点。</p>
      <label htmlFor="pdf-fixture">测试样本</label>{' '}
      <select
        id="pdf-fixture"
        value={fixtureIndex}
        onChange={(event) => {
          setFixtureIndex(Number(event.target.value));
          setPage(1);
          setPages(0);
          setError(false);
          setSelectedText('');
        }}
      >
        {fixtures.map((item, index) => (
          <option key={item.label} value={index}>
            {item.label}
          </option>
        ))}
      </select>
      <div className="pdf-spike-controls">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </button>
        <output aria-label="PDF 页码">
          {page} / {pages || '…'}
        </output>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          下一页
        </button>
        <button type="button" disabled={scale <= 0.5} onClick={() => setScale(scale - 0.25)}>
          缩小
        </button>
        <output aria-label="PDF 缩放">{Math.round(scale * 100)}%</output>
        <button type="button" disabled={scale >= 2} onClick={() => setScale(scale + 0.25)}>
          放大
        </button>
        <button
          type="button"
          onClick={() => setSelectedText(window.getSelection()?.toString() ?? '')}
        >
          查看选中文字
        </button>
      </div>
      {selectedText && <p>选中：{selectedText.slice(0, 200)}</p>}
      {fixture.expectedText ? (
        <p>文字 PDF：请尝试选取页面文字。重复句子的页码不能混淆。</p>
      ) : (
        <p>扫描 PDF：仅图像可见；此测试不提供 OCR 或可选取的原文。</p>
      )}
      {error && <p role="alert">无法打开此合成 PDF；现有资料未被修改。</p>}
      <div className="pdf-spike-page">
        <Document
          key={fixture.label}
          file={file}
          options={pdfOptions}
          loading={<p>正在打开合成 PDF…</p>}
          error={<p>PDF 解析失败。</p>}
          onLoadSuccess={({ numPages }) => {
            setPages(numPages);
            setError(false);
          }}
          onLoadError={() => setError(true)}
        >
          <Page
            pageNumber={page}
            scale={scale}
            renderAnnotationLayer={false}
            renderTextLayer={fixture.expectedText}
          />
        </Document>
      </div>
    </section>
  );
}
