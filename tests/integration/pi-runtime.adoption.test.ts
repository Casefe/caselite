import { afterEach, expect, it, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createPiRuntime } from '../../apps/desktop/src/main/adapters/pi-runtime';

// DEV-1845：真实 Pi 循环配合合成流验证运行隔离，不访问 Provider 或系统密钥。
const message = (text: string): AssistantMessage => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'openai-responses',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 1,
});
const disposers: Array<() => void> = [];
afterEach(() => {
  // 断言失败也先中止运行、结束合成流，避免给后续用例留下真实60秒计时器。
  for (const dispose of disposers.splice(0).reverse()) dispose();
  vi.useRealTimers();
});

it('expires at the 60-second boundary exactly once and ignores completion delivered after timeout', async () => {
  vi.useFakeTimers();
  let ready = () => {};
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const stream = createAssistantMessageEventStream();
  disposers.push(() => stream.end(message('已清理的合成流')));
  let dispatches = 0;
  const runtime = createPiRuntime(() => {
    dispatches++;
    ready();
    return stream;
  });
  const onText = vi.fn();
  const onEnd = vi.fn();
  const handle = runtime.start({
    model: 'gpt-4.1-mini',
    prompt: '仅合成超时输入',
    key: 'synthetic-only',
    onText,
    onEnd,
  });
  disposers.push(() => handle.cancel());
  await started;
  await vi.advanceTimersByTimeAsync(59_999);
  expect(onEnd).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onEnd.mock.calls[0][0]).toMatchObject({ status: 'failed' });
  expect(onEnd.mock.calls[0][0].message).toContain('超时');
  stream.push({ type: 'done', reason: 'stop', message: message('迟到结果') });
  await vi.advanceTimersByTimeAsync(0);
  handle.cancel();
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onText).not.toHaveBeenCalled();
  expect(dispatches).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps two runs isolated when old cancellation and old completion arrive during the next run', async () => {
  const streams = [createAssistantMessageEventStream(), createAssistantMessageEventStream()];
  disposers.push(() => streams.forEach((stream) => stream.end(message('已清理的合成流'))));
  const prompts: string[] = [];
  const signals: AbortSignal[] = [];
  let notify = () => {};
  const runtime = createPiRuntime((_model, context, options) => {
    prompts.push(JSON.stringify(context.messages));
    signals.push(options!.signal!);
    notify();
    return streams[signals.length - 1];
  });
  const aText = vi.fn();
  const aEnd = vi.fn();
  const bText = vi.fn();
  const bEnd = vi.fn();
  async function start(prompt: string, onText: typeof aText, onEnd: typeof aEnd) {
    const ready = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const handle = runtime.start({
      model: 'gpt-4.1-mini',
      prompt,
      key: 'synthetic-only',
      onText,
      onEnd,
    });
    disposers.push(() => handle.cancel());
    await ready;
    return handle;
  }
  const a = await start('run-A-private', aText, aEnd);
  a.cancel();
  const b = await start('run-B-only', bText, bEnd);
  a.cancel();
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  streams[0].push({ type: 'done', reason: 'stop', message: message('A-late') });
  streams[1].push({ type: 'done', reason: 'stop', message: message('B-result') });
  await vi.waitFor(() => expect(bEnd).toHaveBeenCalledTimes(1));
  expect(aText).not.toHaveBeenCalled();
  expect(aEnd).not.toHaveBeenCalled();
  expect(bText.mock.calls.map((call) => call[0])).toContain('B-result');
  expect(JSON.stringify(bText.mock.calls)).not.toContain('A-late');
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).not.toContain('run-A-private');
  expect(bEnd.mock.calls[0][0]).toMatchObject({ status: 'succeeded' });
  b.cancel();
});
