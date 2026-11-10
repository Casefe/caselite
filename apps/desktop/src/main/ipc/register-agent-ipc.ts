import { AGENT_CHANNEL, agentResponseSchema, type AgentResponse } from '@caselite/contracts';
import type { createAgentApplication } from '@caselite/application';
import { ipcMain, type WebContents } from 'electron';
import { isTrustedBusinessSender, onBusinessAccessRevoked } from './window-capabilities';

export function registerAgentIpc(application: ReturnType<typeof createAgentApplication>) {
  const tracked = new WeakSet<WebContents>();
  ipcMain.handle(AGENT_CHANNEL, async (event, payload): Promise<AgentResponse> => {
    if (!isTrustedBusinessSender(event))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面无权访问模型。' };
    const id = event.sender.id;
    if (!tracked.has(event.sender)) {
      tracked.add(event.sender);
      // 换代时也释放准备中/运行中的请求，不能仅隐藏响应却继续派发模型。
      onBusinessAccessRevoked(event, () => {
        tracked.delete(event.sender);
        application.release(String(id));
      });
    }
    const result = await application.execute(payload, String(id));
    if (!isTrustedBusinessSender(event))
      return { ok: false, code: 'FORBIDDEN', message: '当前页面已关闭或失去访问权限。' };
    return agentResponseSchema.parse(result);
  });
}
