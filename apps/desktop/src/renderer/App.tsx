import { lazy, Suspense, useState } from 'react';

const PdfSpike = lazy(() => import('./PdfSpike'));

export default function App() {
  const [showPdfSpike, setShowPdfSpike] = useState(false);
  return (
    <main>
      <h1>CaseLite 工程骨架</h1>
      <p>Electron + React + TypeScript</p>
      <p>当前仅用于验证桌面启动与构建，尚未提供案件或正式文档处理功能。</p>
      <button type="button" onClick={() => setShowPdfSpike((value) => !value)}>
        {showPdfSpike ? '关闭 PDF 测试页' : '打开 PDF 测试页'}
      </button>
      {showPdfSpike && (
        <Suspense fallback={<p>正在加载 PDF 测试页…</p>}>
          <PdfSpike />
        </Suspense>
      )}
    </main>
  );
}
