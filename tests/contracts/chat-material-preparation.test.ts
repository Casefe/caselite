import { expect, it, vi } from 'vitest';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
it('waits beyond the short IPC deadline for cancellable local preparation without losing the result', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (result: unknown) => void;
    const api = createCaseLitePreloadApi(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    let complete = false;
    const pending = api
      .material({
        protocol_version: 1,
        operation: 'preview',
        scope: 'home',
        automatic: true,
        instruction: 'test',
        model: 'gpt-4.1-mini',
        selected: [{ source_id: '11111111-1111-4111-8111-111111111111', pages: [1] }],
      })
      .then((r) => {
        complete = true;
        return r;
      });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(complete).toBe(false);
    finish({ ok: true, materials: [] });
    expect(await pending).toEqual({ ok: true, materials: [] });
  } finally {
    vi.useRealTimers();
  }
});
