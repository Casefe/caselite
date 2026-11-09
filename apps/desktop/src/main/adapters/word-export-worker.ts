import { parentPort } from 'node:worker_threads';
import { deliverySnapshotSchema } from '@caselite/contracts';
import { renderSnapshotWord } from './snapshot-word';

parentPort?.once('message', async (input: { snapshot: unknown; state: Uint8Array }) => {
  try {
    const bytes = await renderSnapshotWord(
      deliverySnapshotSchema.parse(input.snapshot),
      input.state,
    );
    parentPort?.postMessage(bytes);
  } catch {
    parentPort?.postMessage({ error: 'UNSUPPORTED_WORD_CONTENT' });
  }
});
