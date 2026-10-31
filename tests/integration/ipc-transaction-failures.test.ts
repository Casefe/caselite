import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { registerApplicationIpc } from '../../apps/desktop/src/main/ipc/register-application-ipc';
import { IPC_CHANNELS, IPC_PROTOCOL_VERSION } from '../../packages/contracts/src/index';
import { openToolchainProbe } from '../../packages/local-db/src/index';

const migrationsFolder = fileURLToPath(
  new URL('../../packages/local-db/migrations/', import.meta.url),
);
type Handler = (event: { senderFrame: { url: string } }, payload: unknown) => unknown;

const envelope = {
  protocol_version: IPC_PROTOCOL_VERSION,
  workspace_id: 'workspace-synthetic',
  actor_id: 'actor-synthetic',
  device_id: 'device-synthetic',
  expected_version: 0,
};

describe('DEV-1578 synthetic SQLite transaction failure Spike', () => {
  it('rolls back a business write on repository or outbox failure and returns no database details', async () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'caselite-ipc-transaction-'));
    const connection = openToolchainProbe(
      join(temporaryRoot, 'synthetic.sqlite'),
      migrationsFolder,
    );

    try {
      // Test-only table: this is not the future product Outbox schema.
      connection.sqlite.exec(
        "CREATE TABLE synthetic_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL CHECK (event_type = 'allowed'))",
      );
      const insertBusiness = connection.sqlite.prepare(
        'INSERT INTO toolchain_probe (id, value) VALUES (?, ?)',
      );
      const insertEvent = connection.sqlite.prepare(
        'INSERT INTO synthetic_outbox (id, event_type) VALUES (?, ?)',
      );
      connection.sqlite.transaction(() => {
        insertBusiness.run('control', 'committed');
        insertEvent.run('control', 'allowed');
      })();
      const repositoryFailure = connection.sqlite.transaction((id: string) => {
        insertBusiness.run(id, 'temporary');
        insertBusiness.run(id, 'duplicate-key');
      });
      const outboxFailure = connection.sqlite.transaction((id: string) => {
        insertBusiness.run(id, 'temporary');
        insertEvent.run(id, 'rejected-event');
      });

      const handlers = new Map<string, Handler>();
      registerApplicationIpc({
        application: {
          async createMatter(request) {
            repositoryFailure(request.idempotency_key);
            throw new Error('Repository failure did not occur.');
          },
          async createAnchor(request) {
            outboxFailure(request.idempotency_key);
            throw new Error('Outbox failure did not occur.');
          },
        },
        ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler) },
        isTrustedSender: () => true,
      });

      const scenarios = [
        [
          IPC_CHANNELS.createMatter,
          {
            ...envelope,
            request_id: '11111111-1111-4111-8111-111111111111',
            idempotency_key: '22222222-2222-4222-8222-222222222222',
            payload: { title: '合成事项' },
          },
        ],
        [
          IPC_CHANNELS.createAnchor,
          {
            ...envelope,
            request_id: '33333333-3333-4333-8333-333333333333',
            idempotency_key: '44444444-4444-4444-8444-444444444444',
            matter_id: 'matter-synthetic',
            payload: {
              source_version_id: 'source-synthetic',
              page_number: 1,
              quoted_text: '合成原文',
            },
          },
        ],
      ] as const;

      for (const [channel, payload] of scenarios) {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`Missing fixed IPC handler: ${channel}`);
        const result = await handler({ senderFrame: { url: 'caselite://trusted' } }, payload);
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'INTERNAL', retryable: false, recovery_action: 'contact_support' },
        });
        expect(JSON.stringify(result)).not.toMatch(
          /toolchain_probe|synthetic_outbox|SQLITE|INSERT/,
        );
        expect(
          connection.sqlite.prepare('SELECT count(*) AS n FROM toolchain_probe').get(),
        ).toEqual({ n: 1 });
        expect(
          connection.sqlite.prepare('SELECT count(*) AS n FROM synthetic_outbox').get(),
        ).toEqual({ n: 1 });
        expect(connection.sqlite.prepare('SELECT id, value FROM toolchain_probe').all()).toEqual([
          { id: 'control', value: 'committed' },
        ]);
      }
    } finally {
      connection.sqlite.close();
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
