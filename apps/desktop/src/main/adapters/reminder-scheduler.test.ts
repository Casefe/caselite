import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const host = vi.hoisted(() => ({
  made: [] as unknown[],
  history: [] as unknown[],
  windows: [] as unknown[],
  resume: undefined as (() => void) | undefined,
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Notification extends EventEmitter {
    id: string;
    closed = false;
    constructor(options: { id: string }) {
      super();
      this.id = options.id;
      host.made.push(this);
    }
    show() {
      this.emit('failed');
    }
    close() {
      this.closed = true;
    }
    static isSupported() {
      return true;
    }
    static async getHistory() {
      return host.history;
    }
  }
  return {
    Notification,
    BrowserWindow: { getAllWindows: () => host.windows },
    powerMonitor: {
      on: (_e: string, fn: () => void) => {
        host.resume = fn;
      },
      removeListener: () => {
        host.resume = undefined;
      },
    },
  };
});
import { startReminderScheduler } from './reminder-scheduler';
import type { Reminder } from '@caselite/contracts';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  host.made = [];
  host.history = [];
  host.windows = [];
});
it('records failed OS events separately, invalidates an old notification and rechecks delayed click scope', async () => {
  vi.useFakeTimers();
  const row = { id: 'r', plan_revision: 1, status: 'scheduled' } as Reminder;
  let current = [row],
    claim = true;
  const record = vi.fn(),
    focus = vi.fn();
  host.windows = [{ isMinimized: () => false, show: vi.fn(), focus }];
  const scheduler = startReminderScheduler(
    {
      execute: () => ({ ok: true, reminders: current, choices: [], receipt: null }),
      claimDue: () => {
        if (!claim) return [];
        claim = false;
        return [row];
      },
      recordAttempt: record,
    },
    'synthetic',
  );
  const n = host.made[0] as EventEmitter & { closed: boolean };
  expect(record).toHaveBeenCalledWith('r', 1, 'failed');
  current = [{ ...row, plan_revision: 2, status: 'canceled' }];
  n.emit('click');
  expect(focus).not.toHaveBeenCalled();
  expect(n.closed).toBe(true);
  scheduler.tick();
  expect(host.made).toHaveLength(1);
  scheduler.stop();
  expect(host.resume).toBeUndefined();
});
it('restores only its workspace history and closes stale plans without clearing another workspace', async () => {
  // 该用例明确模拟macOS历史API，在Linux测试机也验证同一命名空间边界。
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
  const own = Object.assign(new EventEmitter(), {
      id: 'caselite-reminder:mine:r:1',
      close: vi.fn(),
    }),
    other = Object.assign(new EventEmitter(), {
      id: 'caselite-reminder:other:r:1',
      close: vi.fn(),
    });
  host.history = [own, other];
  const scheduler = startReminderScheduler(
    {
      execute: () => ({ ok: true, reminders: [], choices: [], receipt: null }),
      claimDue: () => [],
      recordAttempt: vi.fn(),
    },
    'mine',
  );
  await Promise.resolve();
  expect(own.close).toHaveBeenCalledOnce();
  expect(other.close).not.toHaveBeenCalled();
  scheduler.stop();
});
it('does not show notifications when persistent claim fails, then checks again through resume', () => {
  let fail = true;
  const claim = vi.fn(() => {
    if (fail) throw new Error('synthetic');
    return [];
  });
  const scheduler = startReminderScheduler(
    {
      execute: () => ({ ok: true, reminders: [], choices: [], receipt: null }),
      claimDue: claim,
      recordAttempt: vi.fn(),
    },
    'mine',
  );
  expect(host.made).toHaveLength(0);
  fail = false;
  host.resume?.();
  expect(claim).toHaveBeenCalledTimes(2);
  scheduler.stop();
});
