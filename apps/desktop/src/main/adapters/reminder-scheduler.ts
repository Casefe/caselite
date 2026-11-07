import { BrowserWindow, Notification, powerMonitor } from 'electron';
import type { createReminderApplication } from '@caselite/application';

export function startReminderScheduler(
  application: ReturnType<typeof createReminderApplication>,
  namespace: string,
) {
  const prefix = `caselite-reminder:${namespace}:`,
    live = new Map<string, Notification>();
  let stopped = false;
  const current = () => {
    const r = application.execute({ protocol_version: 1, operation: 'list' });
    if (!r.ok) throw new Error('Reminder schedule unavailable');
    return r.reminders;
  };
  const valid = (key: string) =>
    current().some(
      (r) => prefix + r.id + ':' + r.plan_revision === key && r.status === 'scheduled',
    );
  const attach = (n: Notification) => {
    live.set(n.id, n);
    n.on('click', () => {
      // 历史通知或延迟click必须重验计划；只聚焦应用，打开任务和已读仍由用户操作。
      try {
        if (!valid(n.id)) {
          n.close();
          return;
        }
        const window = BrowserWindow.getAllWindows()[0];
        if (window) {
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
        }
      } catch {
        /* 无法核对时不导航、不更改已读。 */
      }
    });
  };
  const tick = () => {
    if (stopped) return;
    try {
      for (const [key, n] of live)
        if (!valid(key)) {
          n.close();
          live.delete(key);
        }
      for (const r of application.claimDue(new Date().toISOString())) {
        const record = (status: 'shown' | 'failed' | 'unsupported') => {
          try {
            application.recordAttempt(r.id, r.plan_revision, status);
          } catch {
            /* 落盘失败保留未知，不能伪称送达。 */
          }
        };
        if (!Notification.isSupported()) {
          record('unsupported');
          continue;
        }
        try {
          const n = new Notification({
            id: prefix + r.id + ':' + r.plan_revision,
            groupId: prefix,
            title: 'CaseLite · 任务提醒',
            body: '你确认的任务提醒已到期。请在 CaseLite「提醒」中查看。',
          });
          attach(n);
          n.once('show', () => record('shown'));
          n.once('failed', () => record('failed'));
          n.show();
        } catch {
          record('failed');
        }
      }
    } catch {
      /* 读取/claim失败不调用OS，后续补查；UI仍可显示失败与保留的计划。 */
    }
  };
  // 仅恢复本工作区命名空间的历史通知，不清空其他窗口/工作区或其他功能通知。
  if (process.platform === 'darwin')
    void Notification.getHistory()
      .then((history) => {
        if (stopped) return;
        for (const n of history)
          if (n.id.startsWith(prefix)) {
            try {
              if (valid(n.id)) {
                if (!live.has(n.id)) attach(n);
              } else n.close();
            } catch {
              /* 无法验证的历史通知不绑定动作，留待下次启动核对。 */
            }
          }
      })
      .catch(() => {
        /* OS权限/签名失败不能记作历史清理成功。 */
      });
  tick();
  const timer = setInterval(tick, 5000);
  powerMonitor.on('resume', tick);
  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
      powerMonitor.removeListener('resume', tick);
      live.clear();
    },
  };
}
