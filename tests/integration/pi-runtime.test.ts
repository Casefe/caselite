import { describe, expect, it } from 'vitest';
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
