import { AGENT_CHANNEL, agentResponseSchema, type AgentResponse } from '@caselite/contracts';
import type { createAgentApplication } from '@caselite/application';
import { BrowserWindow, ipcMain } from 'electron';
import { isTrustedDesktopSender } from './register-application-ipc';

export function registerAgentIpc(application: ReturnType<typeof createAgentApplication>) {
  const tracked = new Set<number>();
  ipcMain.handle(AGENT_CHANNEL, async (event, payload): Promise<AgentResponse> => {
    if (!isTrustedDesktopSender(event, BrowserWindow.getAllWindows()))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问模型。' };
    const id = event.sender.id;
    if (!tracked.has(id)) {
      tracked.add(id);
      event.sender.once('destroyed', () => {
        application.release(String(id));
        tracked.delete(id);
      });
    }
    return agentResponseSchema.parse(await application.execute(payload, String(id)));
  });
}
