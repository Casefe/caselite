import {
  IPC_PROTOCOL_VERSION,
  createAnchorRequestSchema,
  createMatterRequestSchema,
  listMattersQuerySchema,
} from '@caselite/contracts';
import { createSpikeApplication } from '@caselite/application';
import { describe, expect, it } from 'vitest';

const requestId = '11111111-1111-4111-8111-111111111111';
const idempotencyKey = '22222222-2222-4222-8222-222222222222';

function matterRequest(overrides: Record<string, unknown> = {}) {
  return {
    request_id: requestId,
    protocol_version: IPC_PROTOCOL_VERSION,
    workspace_id: 'workspace-spike',
    actor_id: 'actor-spike',
    device_id: 'device-spike',
    idempotency_key: idempotencyKey,
    expected_version: 0,
    payload: { title: '合成事项' },
    ...overrides,
  };
}

describe('application command, query and event contracts', () => {
  it('rejects missing request metadata and unsupported query limits', () => {
    expect(
      createMatterRequestSchema.safeParse({ payload: { title: '缺少信封字段' } }).success,
    ).toBe(false);
    expect(
      listMattersQuerySchema.safeParse({
        protocol_version: IPC_PROTOCOL_VERSION,
        workspace_id: 'workspace-spike',
        limit: 101,
      }).success,
    ).toBe(false);
  });

  it('defines a minimal anchor without inventing PDF coordinates', () => {
    const parsed = createAnchorRequestSchema.parse({
      ...matterRequest({
        request_id: '33333333-3333-4333-8333-333333333333',
        idempotency_key: '44444444-4444-4444-8444-444444444444',
      }),
      matter_id: 'matter-spike',
      payload: {
        source_version_id: 'source-version-spike',
        page_number: 1,
        quoted_text: '收到乙方合规发票后十个自然日内',
      },
    });

    expect('coordinates' in parsed.payload).toBe(false);
  });

  it('makes duplicate idempotency keys return the original result without a second effect', async () => {
    let nextId = 0;
    const application = createSpikeApplication({
      authorization: { canAct: async () => true },
      createId: () => '00000000-0000-4000-8000-' + String(++nextId).padStart(12, '0'),
      now: () => '2026-10-31T00:00:00.000Z',
    });
    const request = createMatterRequestSchema.parse(matterRequest());

    const first = await application.createMatter(request);
    const second = await application.createMatter(request);

    expect(first).toEqual(second);
    expect(nextId).toBe(2);
    expect(first).toMatchObject({
      ok: true,
      value: { local_save_status: 'not-persisted' },
    });
  });

  it('returns structured forbidden and conflict errors without persistence details', async () => {
    const denied = createSpikeApplication({
      authorization: { canAct: async () => false },
      createId: () => '00000000-0000-4000-8000-000000000001',
      now: () => '2026-10-31T00:00:00.000Z',
    });
    const request = createMatterRequestSchema.parse(matterRequest());

    await expect(denied.createMatter(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', recovery_action: 'request_access' },
    });

    const allowed = createSpikeApplication({
      authorization: { canAct: async () => true },
      createId: () => '00000000-0000-4000-8000-000000000001',
      now: () => '2026-10-31T00:00:00.000Z',
    });
    const conflict = createMatterRequestSchema.parse(matterRequest());
    const altered = { ...conflict, expected_version: 1 } as typeof conflict;

    await expect(allowed.createMatter(altered)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', recovery_action: 'refresh_and_retry' },
    });
  });
});
