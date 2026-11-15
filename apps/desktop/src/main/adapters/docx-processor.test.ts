import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const workers = vi.hoisted(() => ({ instances: [] as unknown[] }));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 1);
    constructor() {
      super();
      workers.instances.push(this);
    }
  },
}));
import { createDocxProcessor, readDocxSemanticHtml } from './docx-processor';

type TestWorker = EventEmitter & { terminate: ReturnType<typeof vi.fn> };
const latest = () => workers.instances.at(-1) as TestWorker;
const valid = { paragraphs: ['第一段', '第二段'], review: { revisions: false, comments: false } };
beforeEach(() => {
  workers.instances.length = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it.each([
  {},
  { ...valid, paragraphs: ['第一段', 42] },
  { ...valid, review: { revisions: 'false', comments: false } },
  { ...valid, paragraphs: ['x'.repeat(100_001)] },
])('rejects invalid worker payloads without publishing partial pages', async (value) => {
  const pages: unknown[] = [];
  const pending = createDocxProcessor().process(new Uint8Array([1]), {
    signal: new AbortController().signal,
    ocr: false,
    previous: [],
    onPage: (page) => pages.push(page),
  });
  const rejected = expect(pending).rejects.toThrow('Invalid DOCX');
  latest().emit('message', value);
  await rejected;
  expect(pages).toEqual([]);
});

it('rejects invalid semantic payloads instead of returning a false preview', async () => {
  const pending = readDocxSemanticHtml(new Uint8Array([1]));
  const rejected = expect(pending).rejects.toThrow('Invalid DOCX');
  latest().emit('message', { html: '<p>正文</p>', warningCount: -1 });
  await rejected;
});

it.each(['cancel', 'timeout', 'error', 'exit'])(
  'settles once on %s and ignores a late successful worker result',
  async (mode) => {
    const controller = new AbortController();
    const pages: unknown[] = [];
    const pending = createDocxProcessor().process(new Uint8Array([1]), {
      signal: controller.signal,
      ocr: false,
      previous: [],
      onPage: (page) => pages.push(page),
    });
    const rejected = expect(pending).rejects.toThrow();
    const worker = latest();
    if (mode === 'cancel') controller.abort();
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(8000);
    if (mode === 'error') worker.emit('error', new Error('synthetic worker failure'));
    if (mode === 'exit') worker.emit('exit', 1);
    worker.emit('message', valid);
    await rejected;
    worker.emit('exit', 1);
    expect(pages).toEqual([]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('stops publishing further paragraphs when the consumer cancels during delivery', async () => {
  const controller = new AbortController();
  const pages: string[] = [];
  const pending = createDocxProcessor().process(new Uint8Array([1]), {
    signal: controller.signal,
    ocr: false,
    previous: [],
    onPage(page) {
      pages.push(page.text);
      controller.abort();
    },
  });
  const rejected = expect(pending).rejects.toThrow('CANCELLED');
  latest().emit('message', valid);
  await rejected;
  expect(pages).toEqual(['第一段']);
});

it('propagates a consumer failure and stops subsequent delivery', async () => {
  const onPage = vi.fn(() => {
    throw new Error('consumer refused');
  });
  const pending = createDocxProcessor().process(new Uint8Array([1]), {
    signal: new AbortController().signal,
    ocr: false,
    previous: [],
    onPage,
  });
  const rejected = expect(pending).rejects.toThrow('consumer refused');
  latest().emit('message', valid);
  await rejected;
  expect(onPage).toHaveBeenCalledTimes(1);
});

it('waits for the worker termination acknowledgement before returning output', async () => {
  const pending = readDocxSemanticHtml(new Uint8Array([1]));
  let acknowledge!: () => void;
  latest().terminate.mockImplementation(
    () =>
      new Promise<void>((done) => {
        acknowledge = done;
      }),
  );
  let resolved = false;
  void pending.then(() => {
    resolved = true;
  });
  latest().emit('message', { html: '<p>正文</p>', warningCount: 0 });
  await Promise.resolve();
  expect(resolved).toBe(false);
  acknowledge();
  await expect(pending).resolves.toEqual({ html: '<p>正文</p>', warningCount: 0 });
});

it('rejects a failed termination acknowledgement instead of reporting successful output', async () => {
  const pending = readDocxSemanticHtml(new Uint8Array([1]));
  latest().terminate.mockRejectedValue(new Error('synthetic termination failure'));
  const rejected = expect(pending).rejects.toThrow('DOCX worker termination failed');
  latest().emit('message', { html: '<p>正文</p>', warningCount: 0 });
  await rejected;
});
