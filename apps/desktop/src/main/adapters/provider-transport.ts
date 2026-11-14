import type { AgentProvider } from '@caselite/contracts';

const providerBaseUrls: Record<AgentProvider, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
};

export const providerBaseUrl = (provider: AgentProvider) => providerBaseUrls[provider];

export function createProviderTransport(
  provider: AgentProvider,
  isActive: () => boolean,
  runSignal?: AbortSignal,
): typeof globalThis.fetch {
  const endpoint = `${providerBaseUrl(provider)}/${provider === 'openai' ? 'responses' : 'chat/completions'}`;
  let attempted = false;
  return async (input, init) => {
    // SDK 内部重试也只能经过一次实际发送；失效请求不能用新目标或新信号重新获得发送权。
    if (attempted) throw new Error('Provider request refused');
    attempted = true;
    const sourceRequest = input instanceof Request ? input : undefined;
    const signals = [runSignal, sourceRequest?.signal, init?.signal].filter(
      (signal): signal is AbortSignal => signal != null,
    );
    const isCancelled = () => !isActive() || signals.some((signal) => signal.aborted);
    if (isCancelled()) throw new Error('Provider request refused');
    const requestInit = {
      ...init,
      signal: signals.length ? AbortSignal.any(signals) : undefined,
      redirect: 'error' as const,
    };
    let captured: Request | string;
    let target: URL;
    let method: string;
    try {
      // 校验和发送共用快照，避免可变 URL 的二次转换或 Request 自定义 getter 偷换目标。
      captured = sourceRequest ? new Request(sourceRequest, requestInit) : String(input);
      target = new URL(typeof captured === 'string' ? captured : captured.url);
      method = typeof captured === 'string' ? (requestInit.method ?? 'GET') : captured.method;
    } catch {
      throw new Error('Provider request refused');
    }
    // 固定完整 endpoint，先拒绝目标再触碰携带正文和 Key 的底层 fetch。
    if (target.href !== endpoint || method !== 'POST' || isCancelled())
      throw new Error('Provider request refused');
    const response = await globalThis.fetch(captured, sourceRequest ? undefined : requestInit);
    if (
      isCancelled() ||
      response.redirected ||
      (response.status >= 300 && response.status < 400) ||
      (response.url && response.url !== endpoint)
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Error('Provider request refused');
    }
    return response;
  };
}
