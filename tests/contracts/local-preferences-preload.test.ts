import { afterEach, expect, it, vi } from 'vitest';
import { LOCAL_PREFERENCES_CHANNEL } from '@caselite/contracts';
import {
  createCaseLitePreloadApi,
  IPC_COMMAND_TIMEOUT_MS,
} from '../../apps/desktop/src/preload/caselite-api';
afterEach(() => vi.useRealTimers());
it('keeps a timed-out preference command unknown and never retries it', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn(() => new Promise(() => {}));
  const request = { protocol_version: 1 as const, operation: 'read' as const };
  const pending = createCaseLitePreloadApi(invoke).preferences(request);
  await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS + 1);
  expect(await pending).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(invoke).toHaveBeenCalledExactlyOnceWith(LOCAL_PREFERENCES_CHANNEL, request);
});
it('sanitizes malformed or rejected IPC without exposing raw details', async () => {
  const request = { protocol_version: 1 as const, operation: 'read' as const };
  for (const invoke of [
    async () => ({ private_path: '/synthetic/private' }),
    async () => {
      throw new Error('private-detail');
    },
  ]) {
    const response = await createCaseLitePreloadApi(invoke).preferences(request);
    expect(response).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(JSON.stringify(response)).not.toContain('private');
  }
});
