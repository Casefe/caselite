import { app } from 'electron';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { textPageSchema, type TextPage } from '@caselite/contracts';
export async function recognizeLocalImage(
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<TextPage['blocks']> {
  const executable = app.isPackaged
    ? join(process.resourcesPath, 'caselite-vision')
    : resolve(process.cwd(), '../../artifacts/native/caselite-vision');
  return new Promise((done, reject) => {
    const child = execFile(
      executable,
      [],
      {
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        signal,
        env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
      },
      (error, stdout) => {
        if (error) {
          reject(new Error('Local OCR failed'));
          return;
        }
        try {
          done(textPageSchema.shape.blocks.parse(JSON.parse(stdout)));
        } catch {
          reject(new Error('Invalid local OCR result'));
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(bytes);
  });
}
