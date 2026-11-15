import { describe, expect, it, vi } from 'vitest';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  createModels,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { createAgentApplication } from '../../packages/application/src/agent-application';
import {
  AGENT_SYSTEM_TEXT,
  AGENT_TEXT_MAX_BYTES,
  agentUtf8Bytes,
} from '../../packages/application/src/agent-input-budget';
import type { AgentRun } from '../../packages/contracts/src';
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

it.each([false, true])(
  'serializes the scan image into the installed DeepSeek provider HTTP request (mock transport)',
  async (large) => {
    let png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII=';
    if (large) {
      const original = Buffer.from(png, 'base64');
      const chunk = Buffer.from('tEXtComment\0' + 'synthetic scan '.repeat(3000));
      const length = Buffer.alloc(4),
        checksum = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length - 4);
      checksum.writeUInt32BE(crc32(chunk));
      png = Buffer.concat([
        original.subarray(0, -12),
        length,
        chunk,
        checksum,
        original.subarray(-12),
      ]).toString('base64');
      expect(png.length).toBeGreaterThan(32_000);
      expect(Buffer.from(png, 'base64').length).toBeLessThan(100_000);
    }
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
  },
);

it.each([401, 429, 400, 0])(
  'preserves one dispatch and no retries on mock HTTP failure %s with full long text',
  async (status) => {
    const text = '中文English😀'.repeat(5000) + 'LAST_PAGE_NOT_TRUNCATED';
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const payload = JSON.parse(init!.body as string);
      expect(payload.messages.at(-1).content).toBe(text);
      expect(payload.max_tokens ?? payload.max_completion_tokens).toBe(2048);
      if (!status) throw new Error('synthetic offline');
      return new Response(
        JSON.stringify({
          error: { message: status === 400 ? 'context length exceeded' : 'synthetic failure' },
        }),
        { status },
      );
    });
    try {
      const result = await new Promise((resolve) =>
        createPiRuntime().start({
          model: 'deepseek-flash',
          prompt: text,
          key: 'synthetic-only',
          onText() {},
          onEnd: resolve,
        }),
      );
      expect(result).toMatchObject({ status: 'failed' });
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      mock.mockRestore();
    }
  },
);

it('rechecks final SDK messages in onPayload, rejects unexpected wrapping before any HTTP', async () => {
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw Error('Must not reach HTTP');
  });
  let hook!: NonNullable<Parameters<StreamFn>[2]>['onPayload'];
  let model!: Parameters<StreamFn>[0];
  const runtime = createPiRuntime((m, _context, options) => {
    model = m;
    hook = options!.onPayload;
    expect(() =>
      hook!({ messages: [{ role: 'user', content: 'a'.repeat(262_145) }] }, m),
    ).toThrow();
    const p = { messages: [], padding: '' };
    p.padding = 'a'.repeat(2 * 1024 * 1024 - JSON.stringify(p).length);
    expect(() => hook!(p, m)).not.toThrow();
    expect(() => hook!({ ...p, padding: p.padding + 'a' }, m)).toThrow('2 MiB');

    expect(() =>
      hook!({ messages: [{ role: 'user', content: '\u0000'.repeat(350_000) }] }, m),
    ).toThrow('2 MiB');
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: response() }));
    return stream;
  });
  let handle!: ReturnType<typeof runtime.start>;
  try {
    await new Promise((resolve) => {
      handle = runtime.start({
        model: 'deepseek-flash',
        prompt: '短输入',
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      });
    });
    expect(mock).not.toHaveBeenCalled();
    expect(() => hook!({ messages: [] }, model)).toThrow('Dispatch refused');
    handle.cancel();
  } finally {
    mock.mockRestore();
  }
});

it('permits worst JSON escaping of budgeted text without mutating the SDK request', async () => {
  const text = '\u0000'.repeat(200_000) + 'END';
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = init!.body as string;
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(1_200_000);
    expect(JSON.parse(body).messages.at(-1).content).toBe(text);
    return new Response('{"error":{"message":"synthetic"}}', { status: 400 });
  });
  try {
    await new Promise((resolve) =>
      createPiRuntime().start({
        model: 'deepseek-flash',
        prompt: text,
        key: 'synthetic-only',
        onText() {},
        onEnd: resolve,
      }),
    );
    expect(mock).toHaveBeenCalledTimes(1);
  } finally {
    mock.mockRestore();
  }
});

it.each(['gpt-4.1-mini', 'deepseek-flash'] as const)(
  'checks actual SDK short %s serialization including the controlled theme declaration',
  async (model) => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const p = JSON.parse(init!.body as string);
      expect(p.tools).toHaveLength(1);
      expect(JSON.stringify(p.tools)).toContain('set_theme');
      if (model === 'gpt-4.1-mini') {
        expect(p.input).toBeDefined();
        expect(JSON.stringify(p)).toContain('light');
      } else {
        expect(p.messages).toBeDefined();
        expect(JSON.stringify(p.messages)).toContain('light');
      }
      return new Response('{"error":{"message":"synthetic failure"}}', { status: 400 });
    });
    const propose = vi.fn();
    try {
      const result = await new Promise((resolve) =>
        createPiRuntime().start({
          model,
          prompt: '切换浅色主题',
          key: 'synthetic-only',
          theme: { target: 'light', propose },
          onText() {},
          onEnd: resolve,
        }),
      );
      expect(result).toMatchObject({ status: 'failed' });
      expect(mock).toHaveBeenCalledTimes(1);
      expect(propose).not.toHaveBeenCalled();
    } finally {
      mock.mockRestore();
    }
  },
);

it('cancellation before the payload hook refuses HTTP and ignores late completion', async () => {
  let options!: NonNullable<Parameters<StreamFn>[2]>;
  let model!: Parameters<StreamFn>[0];
  let complete!: () => void;
  let ready!: () => void;
  const prepared = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No HTTP expected'));
  const onText = vi.fn();
  const onEnd = vi.fn();
  const runtime = createPiRuntime((m, _context, opts) => {
    model = m;
    options = opts!;
    const stream = createAssistantMessageEventStream();
    complete = () => stream.push({ type: 'done', reason: 'stop', message: response() });
    ready();
    return stream;
  });
  try {
    const handle = runtime.start({
      model: 'deepseek-flash',
      prompt: '完整材料'.repeat(9000),
      key: 'synthetic-only',
      onText,
      onEnd,
    });
    await prepared;
    handle.cancel();
    expect(options.signal?.aborted).toBe(true);
    expect(() =>
      options.onPayload!({ messages: [{ role: 'user', content: '迟到载荷' }] }, model),
    ).toThrow('Dispatch refused');
    complete();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  } finally {
    fetchMock.mockRestore();
  }
});

it.each([
  { model: 'gpt-4.1-mini' as const, extra: 0 },
  { model: 'gpt-4.1-mini' as const, extra: 1 },
  { model: 'deepseek-flash' as const, extra: 0 },
  { model: 'deepseek-flash' as const, extra: 1 },
])(
  'keeps the actual SDK $model body/visible boundary plus $extra separate from protocol tags',
  async ({ model, extra }) => {
    const bodyLength =
      model === 'gpt-4.1-mini' ? 32_000 : AGENT_TEXT_MAX_BYTES - agentUtf8Bytes(AGENT_SYSTEM_TEXT);
    const text =
      'a'.repeat(bodyLength - 'END_SENTINEL'.length) + 'END_SENTINEL' + 'x'.repeat(extra);
    const sdk = createModels();
    sdk.setProvider(openaiProvider());
    sdk.setProvider(deepseekProvider());
    let hookCalls = 0;
    const hookPayloads: string[] = [];
    const hookReturns: unknown[] = [];
    const httpBodies: string[] = [];
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      httpBodies.push(init!.body as string);
      return new Response('{"error":{"message":"synthetic boundary transport"}}', { status: 400 });
    });
    const runtime = createPiRuntime((selected, context, options) =>
      sdk.streamSimple(selected, context, {
        ...options,
        onPayload: (payload, finalModel) => {
          hookCalls++;
          hookPayloads.push(JSON.stringify(payload));
          const result = options!.onPayload!(payload, finalModel);
          hookReturns.push(result);
          hookPayloads.push(JSON.stringify(payload));
          return result;
        },
      }),
    );
    const registered: AgentRun[] = [];
    const register = vi.fn((run: AgentRun) => {
      registered.push(run);
      return { created: true, run };
    });
    let ended!: () => void;
    const completed = new Promise<void>((resolve) => {
      ended = resolve;
    });
    const start = vi.fn((input: Parameters<typeof runtime.start>[0]) =>
      runtime.start({
        ...input,
        onEnd: (result) => {
          input.onEnd(result);
          ended();
        },
      }),
    );
    const app = createAgentApplication({
      credentials: {
        get: () => 'synthetic-only',
        set() {},
        clear() {},
        getDefaultModel: () => model,
        setDefaultModel() {},
      },
      taskExists: () => true,
      history: { load: () => registered, register, save() {} },
      runtime: { ...runtime, start },
      resolveContext: async () => text,
    });
    try {
      const result = await app.execute(
        {
          protocol_version: 1,
          operation: 'start',
          scope: randomUUID(),
          run_id: randomUUID(),
          model,
          prompt: '总结附件内容',
          context_id: randomUUID(),
          confirmed: true,
        },
        'boundary-window',
      );
      expect(result).toMatchObject(extra ? { ok: false, code: 'BUDGET' } : { ok: true });
      if (!extra) await completed;
      expect(register).toHaveBeenCalledTimes(extra ? 0 : 1);
      expect(start).toHaveBeenCalledTimes(extra ? 0 : 1);
      expect(hookCalls).toBe(extra ? 0 : 1);
      expect(mock).toHaveBeenCalledTimes(extra ? 0 : 1);
      if (!extra) {
        expect(hookReturns).toEqual([undefined]);
        expect(hookPayloads[0]).toBe(hookPayloads[1]);
        const payload = JSON.parse(httpBodies[0]) as {
          messages?: { role: string; content: string | { type: string; text: string }[] }[];
          input?: { role: string; content: string | { type: string; text: string }[] }[];
          instructions?: string;
        };
        const messages = payload.messages ?? payload.input!;
        const content = (message: (typeof messages)[number]) =>
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) => part.text).join('');
        const userText = messages
          .filter((message) => message.role === 'user')
          .map(content)
          .join('');
        const systemText =
          messages
            .filter((message) => ['system', 'developer'].includes(message.role))
            .map(content)
            .join('') + (payload.instructions ?? '');
        expect(userText).toBe(text);
        expect(systemText).toBe(AGENT_SYSTEM_TEXT);
        expect(userText.endsWith('END_SENTINEL')).toBe(true);
        expect(agentUtf8Bytes(httpBodies[0])).toBeGreaterThan(
          agentUtf8Bytes(userText + systemText),
        );
        if (model === 'deepseek-flash')
          expect(agentUtf8Bytes(userText + systemText)).toBe(AGENT_TEXT_MAX_BYTES);
        else expect(userText).toHaveLength(32_000);
      } else {
        expect(registered).toHaveLength(0);
        expect(httpBodies).toHaveLength(0);
      }
    } finally {
      mock.mockRestore();
    }
  },
);
