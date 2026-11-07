import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentModel } from '../../packages/contracts/src';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const key = 'synthetic-provider-key';
const sse = () =>
  new Response(
    [
      {
        id: 'synthetic',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'deepseek-flash',
        choices: [
          { index: 0, delta: { role: 'assistant', content: '合成事实核对' }, finish_reason: null },
        ],
      },
      {
        id: 'synthetic',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'deepseek-flash',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
const run = (
  model: AgentModel,
  onText = (text: string) => {
    void text;
  },
) =>
  new Promise<unknown>((resolve) =>
    createPiRuntime().start({ model, prompt: '仅此合成输入', key, onText, onEnd: resolve }),
  );

describe('Installed DeepSeek Provider with synthetic HTTP (no live API)', () => {
  it.each(['deepseek-flash', 'deepseek-v4-pro'] as const)(
    'serializes %s through the real provider and parses streamed output',
    async (model) => {
      const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => {
        void _url;
        void _init;
        return sse();
      });
      vi.stubGlobal('fetch', fetch);
      const text: string[] = [];
      expect(await run(model, (t) => text.push(t))).toMatchObject({
        status: 'succeeded',
        usage: { input: 3, output: 4 },
      });
      const [_url, init] = fetch.mock.calls[0];
      expect(String(_url)).toBe('https://api.deepseek.com/chat/completions');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model,
        stream: true,
        max_tokens: 2048,
        thinking: { type: 'disabled' },
      });
      expect(body.messages.filter((m: { role: string }) => m.role === 'user')).toEqual([
        { role: 'user', content: [{ type: 'text', text: '仅此合成输入' }] },
      ]);
      expect(body.tools ?? []).toEqual([]);
      expect(text.at(-1)).toBe('合成事实核对');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 429, 500])(
    'handles HTTP %s without retry or credential reflection',
    async (status) => {
      const fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: key + ' private-provider-response' } }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', fetch);
      const result = await run('deepseek-flash');
      expect(result).toMatchObject({ status: 'failed' });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain('private-provider-response');
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('fails a disconnected request without retry', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetch);
    expect(await run('deepseek-flash')).toMatchObject({ status: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts the actual HTTP request and drops late completion', async () => {
    let signal: AbortSignal | null | undefined;
    let ready = () => {};
    const dispatched = new Promise<void>((resolve) => {
      ready = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init.signal;
            ready();
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      ),
    );
    const onEnd = vi.fn(),
      onText = vi.fn();
    const handle = createPiRuntime().start({
      model: 'deepseek-flash',
      prompt: '取消合成输入',
      key,
      onText,
      onEnd,
    });
    await dispatched;
    handle.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signal?.aborted).toBe(true);
    expect(onText).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
  it('times out after the fixed deadline with no hidden continuation', async () => {
    vi.useFakeTimers();
    let ready = () => {};
    const dispatched = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn(
      (_url, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init.signal;
          ready();
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const onEnd = vi.fn();
    createPiRuntime().start({
      model: 'deepseek-flash',
      prompt: '超时合成输入',
      key,
      onText() {},
      onEnd,
    });
    await dispatched;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', message: expect.stringContaining('超时') }),
    );
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it.each([
  [
    'glm-4.7-flash',
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    { thinking: { type: 'disabled' } },
  ],
  ['kimi-k2.6', 'https://api.moonshot.cn/v1/chat/completions', { thinking: { type: 'disabled' } }],
  [
    'deepseek-ai/DeepSeek-V4-Flash',
    'https://api.siliconflow.cn/v1/chat/completions',
    { enable_thinking: false },
  ],
] as const)(
  'routes %s only to its configured service and reads the stream',
  async (model, endpoint, reasoning) => {
    const fetch = vi.fn(async (...args: [unknown, RequestInit?]) => {
      void args;
      return sse();
    });
    vi.stubGlobal('fetch', fetch);
    expect(await run(model)).toMatchObject({ status: 'succeeded' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(String(url)).toBe(endpoint);
    expect(request?.redirect).toBe('error');
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer ' + key);
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model,
      stream: true,
      max_tokens: 2048,
      ...reasoning,
    });
  },
);
