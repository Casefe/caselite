import { describe, expect, it, vi } from 'vitest';
import { LEGAL_CONSENT_CHANNEL } from '@caselite/contracts';
import { createLegalPreloadApi } from './legal-api';

describe('legal-only preload', () => {
  it('exposes no business or generic IPC and rejects malformed requests and responses', async () => {
    const invoke = vi.fn(async () => ({ unexpected: 'invalid' }));
    const api = createLegalPreloadApi(invoke);
    expect(Object.keys(api)).toEqual(['execute']);
    await expect(api.execute({ protocol_version: 1, operation: 'read' })).resolves.toMatchObject({
      ok: false,
    });
    expect(invoke).toHaveBeenCalledWith(LEGAL_CONSENT_CHANNEL, {
      protocol_version: 1,
      operation: 'read',
    });
    invoke.mockClear();
    await expect(
      api.execute({ protocol_version: 1, operation: 'accept' } as never),
    ).resolves.toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
