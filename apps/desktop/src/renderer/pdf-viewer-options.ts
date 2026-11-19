import { PDF_BUDGET } from './pdf-budget';

export function pdfJsRendererOptions(baseURI = document.baseURI) {
  return {
    ...PDF_BUDGET,
    cMapUrl: new URL('../pdf-resources/cmaps/', baseURI).toString(),
    cMapPacked: true,
    standardFontDataUrl: new URL('../pdf-resources/standard_fonts/', baseURI).toString(),
    wasmUrl: new URL('../pdf-resources/wasm/', baseURI).toString(),
  };
}

export function pdfJsWorkerSrc(moduleUrl: string | URL = import.meta.url) {
  return new URL('pdfjs-dist/build/pdf.worker.min.mjs', moduleUrl).toString();
}
