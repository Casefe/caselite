import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { PdfProcessorPort } from '@caselite/application';

type TextResult = { paragraphs: string[]; review: { revisions: boolean; comments: boolean } };
type SemanticResult = { html: string; warningCount: number };
function isTextResult(value: unknown): value is TextResult {
  if (!value || typeof value !== 'object') return false;
  const { paragraphs, review } = value as TextResult;
  if (!Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > 200) return false;
  let length = 0;
  // structured clone保留稀疏位置；逐项读取才能拒绝空洞，不能用跳过空洞的every/reduce。
  for (const text of paragraphs) {
    if (typeof text !== 'string' || !text.length || text.length > 100_000) return false;
    length += text.length;
    if (length > 1_000_000) return false;
  }
  return !!review && typeof review.revisions === 'boolean' && typeof review.comments === 'boolean';
}
function isSemanticResult(value: unknown): value is SemanticResult {
  if (!value || typeof value !== 'object') return false;
  const { html, warningCount } = value as SemanticResult;
  return (
    typeof html === 'string' &&
    html.length > 0 &&
    html.length <= 1_000_000 &&
    Number.isSafeInteger(warningCount) &&
    warningCount >= 0
  );
}
function read<Result>(
  bytes: Uint8Array,
  validate: (value: unknown) => value is Result,
  signal?: AbortSignal,
  semantic = false,
) {
  return new Promise<Result>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('CANCELLED'));
    const worker = new Worker(
      join(__dirname.includes('app.asar') ? process.resourcesPath : __dirname, 'docx-worker.cjs'),
      {
        resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
      },
    );
    let settled = false;
    const stop = () => finish(new Error('CANCELLED'));
    const timeout = setTimeout(() => finish(new Error('DOCX timeout')), 8000);
    function finish(error?: Error, value?: Parameters<typeof resolve>[0]) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', stop);
      // 取消、超时和迟到回执只能结算一次；等自有worker退出后才释放调用方的执行槽。
      void worker.terminate().then(
        () => {
          if (error || !value) reject(error ?? new Error('Invalid DOCX'));
          else resolve(value);
        },
        () => reject(error ?? new Error('DOCX worker termination failed')),
      );
    }
    signal?.addEventListener('abort', stop, { once: true });
    worker.on('error', (error) => finish(error));
    worker.once('exit', () => finish(new Error('DOCX worker stopped')));
    worker.on('message', (value: unknown) => {
      if (settled) return;
      if (!validate(value)) finish(new Error('Invalid DOCX'));
      else finish(undefined, value);
    });
    try {
      worker.postMessage({ bytes, semantic });
    } catch {
      finish(new Error('Invalid DOCX'));
    }
  });
}

export function readDocxSemanticHtml(bytes: Uint8Array) {
  return read(bytes, isSemanticResult, undefined, true);
}

export function createDocxProcessor(): PdfProcessorPort {
  return {
    configuration: 'docx-mammoth-1.13.0-text-v1',
    async inspect(bytes) {
      return (await read(bytes, isTextResult)).paragraphs.length;
    },
    async process(bytes, input) {
      const { paragraphs, review } = await read(bytes, isTextResult, input.signal);
      for (const [i, text] of paragraphs.entries()) {
        if (input.signal.aborted) throw new Error('CANCELLED');
        input.onPage({
          page: i + 1,
          text,
          origin: 'docx_text',
          docx_review: review,
          blocks: [],
          width: 1,
          height: 1,
          rotation: 0,
        });
      }
      if (input.signal.aborted) throw new Error('CANCELLED');
    },
  };
}
