import { describe, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';

const response = (): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text: '合成 SDK 输出' }],
  api: 'openai-responses',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  usage: {
    input: 3,
    output: 4,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 7,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: Date.now(),
});
describe('Actual Pi Core with synthetic provider stream (MOCK_ONLY provider)', () => {
  it('uses one dispatch with exactly the supplied input, no tools, no ambient credentials or retries', async () => {
    let calls = 0;
    const runtime = createPiRuntime((_model, context, options) => {
      calls++;
      expect(context.messages.filter((message) => message.role === 'user')).toMatchObject([
        { content: [{ type: 'text', text: '唯一输入' }] },
      ]);
      expect(
        context.messages
          .filter((message) => message.role === 'system')
          .every((message) => !message.toolsAdded?.length),
      ).toBe(true);
      expect(options).toMatchObject({
        apiKey: 'synthetic-only',
        env: {},
        maxRetries: 0,
        maxTokens: 2048,
      });
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: response() }));
      return stream;
    });
    const result = await new Promise((resolve) =>
      runtime.start({
        model: 'gpt-4.1-mini',
        prompt: '唯一输入',
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      }),
    );
    expect(result).toMatchObject({ status: 'succeeded', usage: { input: 3, output: 4 } });
    expect(calls).toBe(1);
  });
  it('refuses unknown tool calls without any follow-up provider request', async () => {
    let calls = 0;
    const runtime = createPiRuntime(() => {
      calls++;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() =>
        stream.push({
          type: 'done',
          reason: 'toolUse',
          message: {
            ...response(),
            stopReason: 'toolUse',
            content: [
              { type: 'toolCall', id: 'bad', name: 'bash', arguments: { command: 'cat private' } },
            ],
          },
        }),
      );
      return stream;
    });
    const result = await new Promise((resolve) =>
      runtime.start({
        model: 'gpt-4.1-mini',
        prompt: '工具拒绝夹具',
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result).toMatchObject({ status: 'failed' });
    expect(calls).toBe(1);
  });
  it('propagates abort and drops a late successful completion', async () => {
    let signal: AbortSignal | undefined;
    let complete = () => {};
    let dispatchReady = () => {};
    const ready = new Promise<void>((resolve) => {
      dispatchReady = resolve;
    });
    const runtime = createPiRuntime((_model, _context, options) => {
      signal = options?.signal;
      const stream = createAssistantMessageEventStream();
      complete = () => stream.push({ type: 'done', reason: 'stop', message: response() });
      dispatchReady();
      return stream;
    });
    const seen: string[] = [];
    const handle = runtime.start({
      model: 'gpt-4.1-mini',
      prompt: '停止夹具',
      key: 'synthetic-only',
      onText: (text) => seen.push(text),
      onEnd: () => seen.push('end'),
    });
    await ready;
    handle.cancel();
    expect(signal?.aborted).toBe(true);
    complete();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([]);
  });
  it('maps upstream error text to a safe error without retrying', async () => {
    let calls = 0;
    const runtime = createPiRuntime(() => {
      calls++;
      throw new Error('private upstream response');
    });
    const result = await new Promise((resolve) =>
      runtime.start({
        model: 'gpt-4.1-mini',
        prompt: '错误夹具',
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      }),
    );
    expect(result).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(result)).not.toContain('private upstream');
    expect(calls).toBe(1);
  });
});

it.each(['gpt-4.1-mini', 'deepseek-flash'] as const)(
  'passes scan images and instructions together to the real Pi Core for %s',
  async (model) => {
    let calls = 0;
    const runtime = createPiRuntime((_model, context) => {
      calls++;
      expect(context.messages.filter((m) => m.role === 'user')).toMatchObject([
        {
          content: [
            { type: 'text', text: '读第1页扫描图' },
            { type: 'image', mimeType: 'image/png', data: 'c3ludGhldGlj' },
          ],
        },
      ]);
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: response() }));
      return stream;
    });
    await new Promise((resolve) =>
      runtime.start({
        model,
        prompt: '读第1页扫描图',
        images: [{ type: 'image', mimeType: 'image/png', data: 'c3ludGhldGlj' }],
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      }),
    );
    expect(calls).toBe(1);
  },
);
it('refuses images for the installed text-only DeepSeek model before dispatch', () => {
  const runtime = createPiRuntime(() => {
    throw new Error('Must not dispatch');
  });
  expect(() =>
    runtime.start({
      model: 'deepseek-v4-pro',
      prompt: 'scan',
      images: [{ type: 'image', mimeType: 'image/png', data: 'synthetic' }],
      key: 'synthetic-only',
      onText() {},
      onEnd() {},
    }),
  ).toThrow('Vision unavailable');
});

it('serializes the scan image into the installed DeepSeek provider HTTP request (mock transport)', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=';
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        [
          'data: ' +
            JSON.stringify({
              id: 'synthetic',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '合成结果' },
                  finish_reason: null,
                },
              ],
            }),
          'data: ' +
            JSON.stringify({
              id: 'synthetic',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  try {
    const result = await new Promise((resolve) =>
      createPiRuntime().start({
        model: 'deepseek-flash',
        prompt: '唯一要求',
        images: [{ type: 'image', mimeType: 'image/png', data: png }],
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      }),
    );
    expect(result).toMatchObject({ status: 'succeeded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(options!.body as string);
    const user = payload.messages.filter((message: { role: string }) => message.role === 'user');
    expect(user).toHaveLength(1);
    expect(user[0].content).toMatchObject([
      { type: 'text', text: '唯一要求' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png } },
    ]);
  } finally {
    fetchMock.mockRestore();
  }
});
