import { Component, useMemo, useState, type ReactNode } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

class PdfDocumentErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <p role="alert">PDF 文件损坏或不存在，无法打开。请选择其他测试样本。</p>
    ) : (
      this.props.children
    );
  }
}

// Webpack emits this as a local asset. The two fixed failure URLs are used
// only by the packaged integration probe; no caller supplies an arbitrary URL.
const workerFault = new URLSearchParams(document.location.search).get('caselite-pdf-worker-fault');
pdfjs.GlobalWorkerOptions.workerSrc =
  workerFault === 'missing'
    ? new URL('../pdf-resources/not-present-worker.mjs', document.baseURI).toString()
    : workerFault === 'mismatch'
      ? new URL('../pdf-resources/mismatch-worker.mjs', document.baseURI).toString()
      : new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

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
  {
    label: '缺失 PDF（预期报错）',
    url: new URL('../pdf-resources/not-present.pdf', document.baseURI).toString(),
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
      {fixtureIndex >= 3 ? (
        <p>缺失或损坏的测试文件应显示错误，不影响已保存的测试记录。</p>
      ) : fixture.expectedText ? (
        <p>文字 PDF：请尝试选取页面文字。重复句子的页码不能混淆。</p>
      ) : (
        <p>扫描 PDF：仅图像可见；此测试不提供 OCR 或可选取的原文。</p>
      )}
      <div className="pdf-spike-page">
        <PdfDocumentErrorBoundary key={fixture.label}>
          {error ? (
            <p role="alert">PDF 文件损坏或不存在，无法打开。请选择其他测试样本。</p>
          ) : (
            <Document
              file={file}
              options={pdfOptions}
              loading={<p>正在打开合成 PDF…</p>}
              error={<p role="alert">PDF 文件损坏或不存在，无法打开。请选择其他测试样本。</p>}
              onLoadSuccess={({ numPages }) => setPages(numPages)}
              onLoadError={() => setError(true)}
              onSourceError={() => setError(true)}
            >
              <Page
                pageNumber={page}
                scale={scale}
                renderAnnotationLayer={false}
                renderTextLayer={fixture.expectedText}
              />
            </Document>
          )}
        </PdfDocumentErrorBoundary>
      </div>
    </section>
  );
}
