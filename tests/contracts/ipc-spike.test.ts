import {
  IPC_CHANNELS,
  APPEARANCE_CHANNEL,
  FINANCE_CHANNEL,
  CONTACTS_CHANNEL,
  MATERIAL_BATCH_CHANNEL,
  IPC_PROTOCOL_VERSION,
  createAnchorRequestSchema,
  createMatterRequestSchema,
  emptyTaskCalendar,
  MATERIAL_FILE_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  CREATION_ATTACHMENT_LIMIT,
} from '@caselite/contracts';
import { createSpikeApplication } from '@caselite/application';
import { describe, expect, it, vi } from 'vitest';

import {
  isTrustedDesktopSender,
  registerApplicationIpc,
} from '../../apps/desktop/src/main/ipc/register-application-ipc';
import {
  createCaseLitePreloadApi,
  IPC_COMMAND_TIMEOUT_MS,
  CREDENTIAL_COMMAND_TIMEOUT_MS,
} from '../../apps/desktop/src/preload/caselite-api';

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
  it('accepts only the live desktop window main frame, independent of file URL spelling', () => {
    const mainFrame = { url: 'file:///tmp/中文%20路径/index.html' };
    const otherFrame = { url: mainFrame.url };
    const webContents = { mainFrame };
    const window = { isDestroyed: () => false, webContents };

    expect(isTrustedDesktopSender({ sender: webContents, senderFrame: mainFrame }, [window])).toBe(
      true,
    );
    expect(isTrustedDesktopSender({ sender: webContents, senderFrame: otherFrame }, [window])).toBe(
      false,
    );
    expect(isTrustedDesktopSender({ sender: {}, senderFrame: mainFrame }, [window])).toBe(false);
    expect(isTrustedDesktopSender({ sender: webContents, senderFrame: null }, [window])).toBe(
      false,
    );
    expect(
      isTrustedDesktopSender({ sender: webContents, senderFrame: mainFrame }, [
        { isDestroyed: () => true, webContents },
      ]),
    ).toBe(false);
  });

  it('exposes only fixed, named actions through preload', () => {
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

    expect(Object.keys(api).sort()).toEqual([
      'agent',
      'appearance',
      'catalog',
      'contacts',
      'createAnchor',
      'createMatter',
      'creationPolicy',
      'dropPdf',
      'exportStyleDefaults',
      'finance',
      'folder',
      'material',
      'materialBatch',
      'offlineProbe',
      'pickPdf',
      'preferences',
      'reminder',
      'task',
      'validateTaskCalendar',
    ]);
  });

  it('exposes only a copied fixed export default value, without mutating host defaults', () => {
    const first = createCaseLitePreloadApi(async () => undefined);
    const second = createCaseLitePreloadApi(async () => undefined);
    expect(first.exportStyleDefaults?.paper).toBe('A4');
    expect(first.exportStyleDefaults).not.toBe(second.exportStyleDefaults);
    first.exportStyleDefaults!.margins.top = 30;
    expect(second.exportStyleDefaults?.margins.top).toBe(20);
  });

  it('exposes immutable creation policy and strict pure calendar validation without dispatching IPC', () => {
    const invoke = vi.fn(async () => undefined);
    const api = createCaseLitePreloadApi(invoke);
    expect(api.creationPolicy).toEqual({
      file_extensions: [...MATERIAL_FILE_EXTENSIONS],
      max_file_bytes: MATERIAL_MAX_BYTES,
      max_files: CREATION_ATTACHMENT_LIMIT,
    });
    expect(Object.isFrozen(api.creationPolicy)).toBe(true);
    expect(Object.isFrozen(api.creationPolicy!.file_extensions)).toBe(true);
    expect(api.validateTaskCalendar!(emptyTaskCalendar)).toBe(true);
    expect(
      api.validateTaskCalendar!({
        ...emptyTaskCalendar,
        schedule: { date: '2026-11-11', start: '15:00', end: '14:00', timezone: 'Asia/Shanghai' },
      }),
    ).toBe(false);
    expect(
      api.validateTaskCalendar!({
        ...emptyTaskCalendar,
        unknown: true,
      } as typeof emptyTaskCalendar),
    ).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses only the fixed material batch channel and rejects malformed or unknown replies', async () => {
    const request = { protocol_version: 1, operation: 'list', scope: 'home' } as const;
    const invoke = vi.fn(async () => ({ ok: true, batch: { id: 'not-an-identity' } }));
    const api = createCaseLitePreloadApi(invoke);
    await expect(api.materialBatch(request)).resolves.toMatchObject({
      ok: false,
      code: 'RESULT_UNKNOWN',
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(MATERIAL_BATCH_CHANNEL, request);
    invoke.mockRejectedValueOnce(new Error('synthetic IPC disconnect'));
    await expect(api.materialBatch(request)).resolves.toMatchObject({
      ok: false,
      code: 'RESULT_UNKNOWN',
    });
  });

  it('uses the fixed contacts channel and rejects malformed replies', async () => {
    const request = { operation: 'list', protocol_version: 1 } as const;
    const invoke = vi.fn(async () => ({ ok: true, contacts: 'invalid', receipt: null }));
    const api = createCaseLitePreloadApi(invoke);
    await expect(api.contacts(request)).resolves.toMatchObject({
      ok: false,
      code: 'RESULT_UNKNOWN',
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(CONTACTS_CHANNEL, request);
  });

  it('normalizes legacy contacts at the actual preload boundary and rejects invalid details', async () => {
    const contact = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '合成客户',
      kind: 'person',
      phone: '',
      email: '',
      project_ids: [],
      version: 1,
      updated_at: '2026-11-10T00:00:00Z',
    };
    let reply: unknown = { ok: true, contacts: [contact], receipt: null };
    const api = createCaseLitePreloadApi(async () => reply);
    const request = { protocol_version: 1, operation: 'list' } as const;
    await expect(api.contacts(request)).resolves.toMatchObject({
      ok: true,
      contacts: [
        {
          ...contact,
          wechat: '',
          company: '',
          position: '',
          city: '',
          relationship: '',
          tags: [],
          last_contact: null,
        },
      ],
    });
    for (const invalid of [{ wechat: 42 }, { tags: ['重复', '重复'] }, { city: '坏\u0000值' }]) {
      reply = { ok: true, contacts: [{ ...contact, ...invalid }], receipt: null };
      await expect(api.contacts(request)).resolves.toMatchObject({
        ok: false,
        code: 'RESULT_UNKNOWN',
      });
    }
    reply = {
      ok: true,
      contacts: [contact],
      receipt: null,
      detail: {
        contact_id: contact.id,
        entries: [{ id: contact.id }],
        task_ids: [],
        document_ids: [],
      },
    };
    await expect(
      api.contacts({ protocol_version: 1, operation: 'read', contact_id: contact.id }),
    ).resolves.toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  });

  it('routes appearance only through its fixed channel and rejects malformed responses', async () => {
    const invoke = vi.fn(async (channel: string) => {
      expect(channel).toBe(APPEARANCE_CHANNEL);
      return { ok: true, theme: 'unexpected' };
    });
    const api = createCaseLitePreloadApi(invoke);
    await expect(api.appearance({ protocol_version: 1, operation: 'read' })).resolves.toMatchObject(
      { ok: false },
    );
    expect(invoke).toHaveBeenCalledWith(APPEARANCE_CHANNEL, {
      protocol_version: 1,
      operation: 'read',
    });
  });

  it('routes finance status through its fixed channel and rejects an invalid success receipt', async () => {
    const invoke = vi.fn(async () => ({ ok: true, kind: 'status', evidence: null }));
    const api = createCaseLitePreloadApi(invoke);
    const status = {
      protocol_version: 1 as const,
      operation: 'status' as const,
      project_id: '77777777-7777-4777-8777-777777777777',
      idempotency_key: '88888888-8888-4888-8888-888888888888',
    };
    await expect(api.finance(status)).resolves.toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(invoke).toHaveBeenCalledWith(FINANCE_CHANNEL, status);
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

  it('turns an application failure into a safe structured error', async () => {
    const handlers = new Map<string, Handler>();
    registerApplicationIpc({
      application: {
        createMatter: async () => {
          throw new Error('SQLITE_READONLY /private/client-case.db secret-value');
        },
        createAnchor: async () => {
          throw new Error('Outbox failed at /private/outbox.db');
        },
      },
      ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler) },
      isTrustedSender: () => true,
    });

    for (const [channel, payload] of [
      [IPC_CHANNELS.createMatter, request],
      [IPC_CHANNELS.createAnchor, anchorRequest],
    ] as const) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error('Required IPC handler was not registered.');
      const result = await handler({ senderFrame: { url: 'caselite://trusted' } }, payload);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INTERNAL', recovery_action: 'contact_support' },
      });
      expect(JSON.stringify(result)).not.toMatch(/SQLITE|outbox\.db|client-case\.db|secret-value/);
    }
  });

  it('returns an uncertain outcome after a bounded IPC wait without retrying either command', async () => {
    vi.useFakeTimers();
    try {
      const invoke = vi.fn(async () => new Promise<unknown>(() => undefined));
      const api = createCaseLitePreloadApi(invoke);
      const matterResult = api.createMatter(request);
      const anchorResult = api.createAnchor(anchorRequest);

      await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS);

      for (const result of [await matterResult, await anchorResult]) {
        expect(result).toMatchObject({
          ok: false,
          error: {
            code: 'IPC_TIMEOUT',
            retryable: false,
            recovery_action: 'check_status',
          },
        });
      }
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
        IPC_CHANNELS.createMatter,
        IPC_CHANNELS.createAnchor,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report a late IPC success as saved after the timeout', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      const api = createCaseLitePreloadApi(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = api.createMatter(request);
      await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS);
      const timedOut = await pending;
      finish({ ok: true, value: { entity_kind: 'matter' } });
      await Promise.resolve();
      expect(timedOut).toMatchObject({ ok: false, error: { code: 'IPC_TIMEOUT' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes rejected and malformed IPC replies', async () => {
    const rejected = createCaseLitePreloadApi(async () => {
      throw new Error('SQLITE_ERROR /private/client-case.db secret-value');
    });
    const malformed = createCaseLitePreloadApi(async () => ({ secret: '/private/client-case.db' }));

    for (const result of [
      await rejected.createMatter(request),
      await malformed.createAnchor(anchorRequest),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
      expect(JSON.stringify(result)).not.toMatch(/SQLITE|client-case\.db|secret-value/);
    }
  });

  it('waits for a native save dialog while ordinary task commands retain their deadline', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      const invoke = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            finish = resolve;
          }),
      );
      const api = createCaseLitePreloadApi(invoke);
      const id = '55555555-5555-4555-8555-555555555555';
      let settled = false;
      const saving = api
        .task({
          protocol_version: 1,
          operation: 'save_export',
          task_id: id,
          document_id: id,
          snapshot_id: id,
          export_id: id,
          format: 'pdf',
        })
        .then((value) => {
          settled = true;
          return value;
        });
      const finishDialog = finish;
      const ordinary = api.task({ protocol_version: 1, operation: 'read', task_id: id });
      await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS * 2);
      expect(settled).toBe(false);
      expect(await ordinary).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
      finishDialog({ ok: true, tasks: [], state: null, receipt: null, export_saved: false });
      expect(await saving).toMatchObject({ ok: true, export_saved: false });
      expect(invoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

it.each(['configure', 'refresh_credentials'] as const)(
  'waits for the bounded credential %s receipt without extending model dispatch waits',
  async (operation) => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      const invoke = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const api = createCaseLitePreloadApi(invoke);
      const request =
        operation === 'configure'
          ? { protocol_version: 1 as const, operation, key: 'sk-synthetic-only' }
          : { protocol_version: 1 as const, operation };
      let settled = false;
      const pending = api.agent(request).then((value) => {
        settled = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(45_000);
      expect(settled).toBe(false);
      finish({
        ok: true,
        configured: false,
        model: 'deepseek-flash',
        providers: { openai: false, deepseek: false },
        credential_errors: { deepseek: 'UNAVAILABLE' },
        runs: [],
      });
      expect(await pending).toMatchObject({
        ok: true,
        configured: false,
        credential_errors: { deepseek: 'UNAVAILABLE' },
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it('bounds hanging credential recovery to fifty seconds and ignores its late receipt without retrying', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createCaseLitePreloadApi(invoke).agent({
      protocol_version: 1,
      operation: 'refresh_credentials',
    });
    await vi.advanceTimersByTimeAsync(CREDENTIAL_COMMAND_TIMEOUT_MS);
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    finish({
      ok: true,
      configured: true,
      model: 'deepseek-flash',
      providers: { deepseek: true, openai: false },
      runs: [],
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the paid start receipt deadline at fifteen seconds with zero retries', async () => {
  vi.useFakeTimers();
  try {
    const invoke = vi.fn(() => new Promise(() => {}));
    const pending = createCaseLitePreloadApi(invoke).agent({
      protocol_version: 1,
      operation: 'start',
      scope: 'home',
      run_id: '11111111-1111-4111-8111-111111111111',
      prompt: '合成输入',
      confirmed: true,
    });
    await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
