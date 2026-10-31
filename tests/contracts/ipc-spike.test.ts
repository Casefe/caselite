import {
  IPC_CHANNELS,
  IPC_PROTOCOL_VERSION,
  createAnchorRequestSchema,
  createMatterRequestSchema,
} from '@caselite/contracts';
import { createSpikeApplication } from '@caselite/application';
import { describe, expect, it } from 'vitest';

import { registerApplicationIpc } from '../../apps/desktop/src/main/ipc/register-application-ipc';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';

type Handler = (event: { senderFrame: { url: string } }, payload: unknown) => unknown;

const request = createMatterRequestSchema.parse({
  request_id: '55555555-5555-4555-8555-555555555555',
  protocol_version: IPC_PROTOCOL_VERSION,
  workspace_id: 'workspace-spike',
  actor_id: 'actor-spike',
  device_id: 'device-spike',
  idempotency_key: '66666666-6666-4666-8666-666666666666',
  expected_version: 0,
  payload: { title: 'IPC 合同演练事项' },
});

const anchorRequest = createAnchorRequestSchema.parse({
  request_id: '88888888-8888-4888-8888-888888888888',
  protocol_version: IPC_PROTOCOL_VERSION,
  workspace_id: 'workspace-spike',
  actor_id: 'actor-spike',
  device_id: 'device-spike',
  idempotency_key: '99999999-9999-4999-8999-999999999999',
  expected_version: 0,
  matter_id: 'matter-spike',
  payload: {
    source_version_id: 'source-version-spike',
    page_number: 1,
    quoted_text: '收到乙方合规发票后十个自然日内',
  },
});

function createHarness() {
  const handlers = new Map<string, Handler>();
  const application = createSpikeApplication({
    authorization: { canAct: async () => true },
    createId: () => crypto.randomUUID(),
    now: () => '2026-10-31T00:00:00.000Z',
  });

  registerApplicationIpc({
    application,
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    isTrustedSender: (event) => event.senderFrame.url === 'caselite://trusted',
  });

  return { handlers };
}

describe('typed preload to main IPC Spike', () => {
  it('exposes only two named business actions through preload', () => {
    const api = createCaseLitePreloadApi(async () => ({
      ok: false,
      error: {
        code: 'INTERNAL',
        message: '测试替身。',
        retryable: false,
        recovery_action: 'contact_support',
        correlation_id: '77777777-7777-4777-8777-777777777777',
      },
    }));

    expect(Object.keys(api).sort()).toEqual(['createAnchor', 'createMatter']);
  });

  it('uses the fixed channel and returns a validated application result', async () => {
    const { handlers } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.createMatter);
    if (!handler) throw new Error('CreateMatter handler was not registered.');
    const api = createCaseLitePreloadApi(async (channel, payload) => {
      expect(channel).toBe(IPC_CHANNELS.createMatter);
      return handler({ senderFrame: { url: 'caselite://trusted' } }, payload);
    });

    await expect(api.createMatter(request)).resolves.toMatchObject({
      ok: true,
      value: { entity_kind: 'matter', local_save_status: 'not-persisted' },
    });
  });

  it('routes CreateAnchor through its own fixed channel', async () => {
    const { handlers } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.createAnchor);
    if (!handler) throw new Error('CreateAnchor handler was not registered.');
    const api = createCaseLitePreloadApi(async (channel, payload) => {
      expect(channel).toBe(IPC_CHANNELS.createAnchor);
      return handler({ senderFrame: { url: 'caselite://trusted' } }, payload);
    });

    await expect(api.createAnchor(anchorRequest)).resolves.toMatchObject({
      ok: true,
      value: { entity_kind: 'anchor', local_save_status: 'not-persisted' },
    });
  });

  it('rejects an untrusted sender, old protocol, and malformed request safely', async () => {
    const { handlers } = createHarness();
    const handler = handlers.get(IPC_CHANNELS.createMatter);
    if (!handler) throw new Error('CreateMatter handler was not registered.');

    await expect(
      handler({ senderFrame: { url: 'https://untrusted.example' } }, request),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    await expect(
      handler({ senderFrame: { url: 'caselite://trusted' } }, { ...request, protocol_version: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROTOCOL_UNSUPPORTED', recovery_action: 'upgrade_client' },
    });
    await expect(
      handler({ senderFrame: { url: 'caselite://trusted' } }, { protocol_version: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST', recovery_action: 'correct_input' },
    });
  });
});
