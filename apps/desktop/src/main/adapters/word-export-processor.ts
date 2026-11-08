import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { DeliverySnapshot } from '@caselite/contracts';

export function generateSnapshotWord(
  snapshot: DeliverySnapshot,
  state: number[],
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      join(
        __dirname.includes('app.asar') ? process.resourcesPath : __dirname,
        'word-export-worker.cjs',
      ),
      { resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 } },
    );
    let finished = false;
    const timer = setTimeout(() => finish(), 15000);
    function finish(bytes?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (bytes instanceof Uint8Array && bytes.length && bytes.length <= 20_000_000) resolve(bytes);
      else
        reject(
          new Error(
            bytes && typeof bytes === 'object' && 'error' in bytes
              ? 'UNSUPPORTED_WORD_CONTENT'
              : 'Word export stopped or timed out',
          ),
        );
    }
    worker.once('message', finish);
    worker.once('error', () => finish());
    worker.once('exit', () => finish());
    worker.postMessage({ snapshot, state: new Uint8Array(state) });
  });
}
