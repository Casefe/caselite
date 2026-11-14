import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import type { AgentModel } from '../../packages/contracts/src';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';
import { createProviderTransport } from '../../apps/desktop/src/main/adapters/provider-transport';

const routes: Array<[AgentModel, string]> = [
  ['gpt-4.1-mini', 'https://api.openai.com/v1/responses'],
  ['deepseek-flash', 'https://api.deepseek.com/chat/completions'],
  ['deepseek-v4-pro', 'https://api.deepseek.com/chat/completions'],
  ['glm-4.7-flash', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['kimi-k2.6', 'https://api.moonshot.cn/v1/chat/completions'],
  ['deepseek-ai/DeepSeek-V4-Flash', 'https://api.siliconflow.cn/v1/chat/completions'],
];
const key = 'synthetic-only';
const run = (model: AgentModel) =>
  new Promise<unknown>((resolve) =>
    createPiRuntime().start({
      model,
      prompt: 'synthetic-only-input',
      key,
      onText() {},
      onEnd: resolve,
    }),
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Installed Pi providers through guarded synthetic HTTP transport (MOCK_ONLY)', () => {
  it.each([
    ['id', 'different-model'],
    ['provider', 'deepseek'],
    ['baseUrl', 'https://wrong.invalid/v1'],
  ] as const)(
    'refuses Agent-selected model %s changes before HTTP dispatch',
    async (field, value) => {
      const originalPrompt = Agent.prototype.prompt;
      // 只在测试中改真实 Agent 的下一次模型状态，随后继续原 prompt/streamFn 链路。
      const prompt = vi.spyOn(Agent.prototype, 'prompt').mockImplementation(function (
        this: Agent,
        input,
        images,
      ) {
        this.state.model = { ...this.state.model, [field]: value };
        return originalPrompt.call(this, input, images);
      });
      const send = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal('fetch', send);
      const result = await run('gpt-4.1-mini');
      expect(prompt).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ status: 'failed' });
      expect(send).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain('synthetic-only-input');
    },
  );

  it('parses a successful installed OpenAI Responses SSE stream with one guarded dispatch', async () => {
    const apiKey = 'sk-synthetic-only';
    const item = {
      id: 'msg_synthetic',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '合成中文正文', annotations: [] }],
    };
    const events = [
      { type: 'response.created', response: { id: 'resp_synthetic' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...item, status: 'in_progress', content: [] },
      },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        delta: '合成中文',
      },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        delta: '正文',
      },
      { type: 'response.output_item.done', output_index: 0, item },
      {
        type: 'response.completed',
        response: {
          id: 'resp_synthetic',
          status: 'completed',
          output: [item],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
        },
      },
    ];
    const send = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', send);
    const models = createModels();
    models.setProvider(openaiProvider());
    let maxRetries: number | undefined;
    const runtime = createPiRuntime((model, context, options) => {
      maxRetries = options?.maxRetries;
      return models.streamSimple(model, context, options);
    });
    const text: string[] = [];
    const result = await new Promise<unknown>((resolve) =>
      runtime.start({
        model: 'gpt-4.1-mini',
        prompt: 'synthetic-only-input',
        key: apiKey,
        onText: (value) => text.push(value),
        onEnd: resolve,
      }),
    );
    expect(result).toMatchObject({ status: 'succeeded', usage: { input: 3, output: 4 } });
    expect(text.at(-1)).toBe('合成中文正文');
    expect(maxRetries).toBe(0);
    expect(send).toHaveBeenCalledOnce();
    const [target, init] = send.mock.calls[0];
    expect(String(target)).toBe(routes[0][1]);
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-4.1-mini',
      stream: true,
      max_output_tokens: 2048,
    });
  });

  it('snapshots a URL once when its toString mutates the original hostname', async () => {
    const target = new URL(routes[0][1]);
    let conversions = 0;
    target.toString = () => {
      const value = URL.prototype.toString.call(target);
      if (conversions++ === 0) target.hostname = 'wrong.invalid';
      return value;
    };
    const received: Array<{ url: string; key: string | null; body: string }> = [];
    const send = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const actual = new Request(input, init);
      received.push({
        url: actual.url,
        key: actual.headers.get('authorization'),
        body: await actual.text(),
      });
      return new Response('synthetic');
    });
    vi.stubGlobal('fetch', send);
    await createProviderTransport('openai', () => true)(target, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: 'synthetic-only-input',
    });
    expect(received).toEqual([
      { url: routes[0][1], key: `Bearer ${key}`, body: 'synthetic-only-input' },
    ]);
    expect(received.filter((request) => new URL(request.url).hostname === 'wrong.invalid')).toEqual(
      [],
    );
    expect(conversions).toBe(1);
  });

  it('validates the native Request URL instead of an overridden public url getter', async () => {
    const request = new Request('https://wrong.invalid/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: 'synthetic-only-input',
    });
    Object.defineProperty(request, 'url', { get: () => routes[0][1] });
    const received: Array<{ url: string; key: string | null; body: string }> = [];
    const send = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const actual = new Request(input, init);
      received.push({
        url: actual.url,
        key: actual.headers.get('authorization'),
        body: await actual.text(),
      });
      return new Response('synthetic');
    });
    vi.stubGlobal('fetch', send);
    const result = await createProviderTransport(
      'openai',
      () => true,
    )(request).catch((error: unknown) => error);
    expect({ blocked: result instanceof Error, received }).toEqual({ blocked: true, received: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(routes)(
    'applies the exact target and no-redirect policy to %s',
    async (model, endpoint) => {
      const send = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response('{"error":{"message":"synthetic"}}', {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      );
      vi.stubGlobal('fetch', send);
      expect(await run(model)).toMatchObject({ status: 'failed' });
      expect(send).toHaveBeenCalledOnce();
      const [input, init] = send.mock.calls[0];
      expect(String(input)).toBe(endpoint);
      expect(init?.redirect).toBe('error');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${key}`);
      expect(JSON.stringify(init?.body)).toContain('synthetic-only-input');
    },
  );

  it.each(
    routes.flatMap(([model, endpoint]) =>
      [301, 302, 307, 308].map((status) => [model, endpoint, status] as const),
    ),
  )('refuses %s at %s HTTP %s without forwarding or retry', async (model, endpoint, status) => {
    const send = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response('synthetic', {
          status,
          headers: { location: 'https://wrong.invalid/collect' },
        }),
    );
    vi.stubGlobal('fetch', send);
    const result = await run(model);
    expect(result).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(send).toHaveBeenCalledOnce();
    expect(String(send.mock.calls[0][0])).toBe(endpoint);
  });

  it.each(routes)(
    'does not dispatch %s when cancelled before lazy SDK loading completes',
    async (model) => {
      const send = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal('fetch', send);
      const onText = vi.fn();
      const onEnd = vi.fn();
      const handle = createPiRuntime().start({ model, prompt: 'synthetic', key, onText, onEnd });
      handle.cancel();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(send).not.toHaveBeenCalled();
      expect(onText).not.toHaveBeenCalled();
      expect(onEnd).not.toHaveBeenCalled();
    },
  );
});
