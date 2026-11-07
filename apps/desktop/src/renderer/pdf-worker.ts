import { PDF_BUDGET, PDF_CANVAS_PIXELS } from './pdf-budget';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
let document: PDFDocumentProxy | undefined;
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();
const resource = (path: string) =>
  new URL(`../pdf-resources/${path}/`, globalThis.document.baseURI).toString();
const api = {
  async open(base64: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    document = await pdfjs.getDocument({
      ...PDF_BUDGET,
      data: bytes,
      cMapUrl: resource('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: resource('standard_fonts'),
      wasmUrl: resource('wasm'),
    }).promise;
    return document.numPages;
  },
  async page(number: number, ocr: boolean) {
    if (!document) throw new Error('No document');
    const page = await document.getPage(number);
    const view = page.getViewport({ scale: 1 });
    try {
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => 'str' in item)
        .map((item) =>
          'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '',
        )
        .join('')
        .trim();
      if (text.length > 100_000) throw new Error('Page text limit');
      const operators = await page.getOperatorList();
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      let largeImage = false;
      for (let i = 0; i < operators.fnArray.length; i++) {
        const fn = operators.fnArray[i];
        if (fn === pdfjs.OPS.save) stack.push([...matrix]);
        else if (fn === pdfjs.OPS.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        else if (fn === pdfjs.OPS.transform) {
          const n = operators.argsArray[i] as number[];
          const m = matrix;
          matrix = [
            m[0] * n[0] + m[2] * n[1],
            m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3],
            m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4],
            m[1] * n[4] + m[3] * n[5] + m[5],
          ];
        } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
          if (
            Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) >
            view.width * view.height * 0.2
          )
            largeImage = true;
        }
      }
      const needsOcr = largeImage || text.replace(/\s/g, '').length < 20 || text.includes('\ufffd');
      let image: string | undefined;
      if (ocr) {
        const scale = Math.min(2, Math.sqrt(PDF_CANVAS_PIXELS / (view.width * view.height)));
        const viewport = page.getViewport({ scale });
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          await page.render({ canvas, viewport }).promise;
          image = canvas.toDataURL('image/png').split(',')[1];
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      return {
        page: number,
        text,
        origin: needsOcr ? 'needs_ocr' : 'pdf_text',
        blocks: [],
        width: view.width,
        height: view.height,
        rotation: view.rotation,
        image,
      };
    } finally {
      page.cleanup();
    }
  },
};
Object.assign(window, { caselitePdfWorker: api });
