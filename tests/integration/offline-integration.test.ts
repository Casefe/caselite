import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createOfflineProbeApplication, createSpikeApplication } from '@caselite/application';
import { IPC_CHANNELS } from '@caselite/contracts';

import { registerApplicationIpc } from '../../apps/desktop/src/main/ipc/register-application-ipc';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
import { openOfflineProbePort } from '../../packages/local-db/src/index';

const migrations = resolve(
  fileURLToPath(new URL('../../packages/local-db/migrations/', import.meta.url)),
);
const writeRequest = {
  protocol_version: 1,
  action: 'write',
  record_id: 'dev-1566-synthetic',
  value: 'offline-integration-verified',
} as const;
const readRequest = {
  protocol_version: 1,
  action: 'read',
  record_id: 'dev-1566-synthetic',
} as const;

function harness(databasePath: string, migrationsFolder = migrations) {
  const port = openOfflineProbePort(databasePath, migrationsFolder);
  const handlers = new Map<
    string,
    (event: { senderFrame: { url: string } }, payload: unknown) => unknown
  >();
  registerApplicationIpc({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    application: createSpikeApplication({
      authorization: { canAct: async () => true },
      createId: () => crypto.randomUUID(),
      now: () => '2026-10-31T00:00:00.000Z',
    }),
    offlineProbe: createOfflineProbeApplication(port),
    isTrustedSender: (event) => event.senderFrame?.url === 'caselite://trusted',
  });
  const handler = handlers.get(IPC_CHANNELS.offlineProbe);
  if (!handler) throw new Error('Offline probe handler missing');
  const api = createCaseLitePreloadApi((channel, payload) => {
    expect(channel).toBe(IPC_CHANNELS.offlineProbe);
    return Promise.resolve(handler({ senderFrame: { url: 'caselite://trusted' } }, payload));
  });
  return { api, handler, close: () => port.close() };
}

describe('DEV-1566 controlled desktop database path', () => {
  it('passes through fixed preload/IPC and reads the same record after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'caselite-integrated-db-'));
    const nested = join(directory, '中文 路径');
    mkdirSync(nested);
    const databasePath = join(nested, 'probe.sqlite');
    try {
      const first = harness(databasePath);
      try {
        await expect(first.api.offlineProbe(writeRequest)).resolves.toMatchObject({
          ok: true,
          value: { stored_value: 'offline-integration-verified', migration_count: 1 },
        });
        await expect(
          first.handler({ senderFrame: { url: 'https://untrusted.example' } }, readRequest),
        ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
        await expect(
          first.handler(
            { senderFrame: { url: 'caselite://trusted' } },
            { ...writeRequest, record_id: 'arbitrary' },
          ),
        ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
        await expect(
          first.handler(
            { senderFrame: { url: 'caselite://trusted' } },
            { ...writeRequest, protocol_version: 0 },
          ),
        ).toMatchObject({ ok: false, error: { code: 'PROTOCOL_UNSUPPORTED' } });
      } finally {
        first.close();
      }
      const second = harness(databasePath);
      try {
        await expect(second.api.offlineProbe(readRequest)).resolves.toMatchObject({
          ok: true,
          value: { stored_value: 'offline-integration-verified', migration_count: 1 },
        });
      } finally {
        second.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not register the test channel in normal desktop mode', () => {
    const handlers = new Map<string, unknown>();
    registerApplicationIpc({
      ipcMain: {
        handle: (channel, handler) => {
          handlers.set(channel, handler);
        },
      },
      application: createSpikeApplication({
        authorization: { canAct: async () => true },
        createId: () => crypto.randomUUID(),
        now: () => '2026-10-31T00:00:00.000Z',
      }),
      isTrustedSender: () => true,
    });
    expect(handlers.has(IPC_CHANNELS.offlineProbe)).toBe(false);
  });

  it('returns a sanitized error when the test database cannot be written', () => {
    const app = createOfflineProbeApplication({
      write: () => {
        throw new Error('SQLITE_READONLY /private/example/probe.sqlite');
      },
      read: () => null,
      migrationCount: () => 1,
    });
    const result = app.run(writeRequest);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('SQLITE_READONLY');
    expect(JSON.stringify(result)).not.toContain('/private/example');
  });
});
