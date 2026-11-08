import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { PdfProcessorPort } from '@caselite/application';

type TextResult = { paragraphs: string[]; review: { revisions: boolean; comments: boolean } };
type SemanticResult = { html: string; warningCount: number };
function read<Result>(bytes: Uint8Array, signal?: AbortSignal, semantic = false) {
  return new Promise<Result>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('CANCELLED'));
    const worker = new Worker(
      join(__dirname.includes('app.asar') ? process.resourcesPath : __dirname, 'docx-worker.cjs'),
      {
        resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
      },
    );
    const stop = () => finish(new Error('DOCX timeout or cancelled'));
    const timeout = setTimeout(stop, 8000);
    function finish(error?: Error, value?: Parameters<typeof resolve>[0]) {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', stop);
      void worker.terminate();
      if (error || !value) reject(error ?? new Error('Invalid DOCX'));
      else resolve(value);
    }
    signal?.addEventListener('abort', stop, { once: true });
    worker.once('error', finish);
    worker.once('exit', () => finish(new Error('DOCX worker stopped')));
    worker.once('message', (value) => finish(undefined, value));
    worker.postMessage({ bytes, semantic });
  });
}

export function readDocxSemanticHtml(bytes: Uint8Array) {
  return read<SemanticResult>(bytes, undefined, true);
}

export function createDocxProcessor(): PdfProcessorPort {
  return {
    configuration: 'docx-mammoth-1.13.0-text-v1',
    async inspect(bytes) {
      return (await read<TextResult>(bytes)).paragraphs.length;
    },
    async process(bytes, input) {
      const { paragraphs, review } = await read<TextResult>(bytes, input.signal);
      paragraphs.forEach((text, i) =>
        input.onPage({
          page: i + 1,
          text,
          origin: 'docx_text',
          docx_review: review,
          blocks: [],
          width: 1,
          height: 1,
          rotation: 0,
        }),
      );
    },
  };
}
