import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProvider } from '@caselite/contracts';
import { createProviderTransport } from './provider-transport';

const routes: Array<[AgentProvider, string]> = [
  ['openai', 'https://api.openai.com/v1/responses'],
  ['deepseek', 'https://api.deepseek.com/chat/completions'],
  ['glm', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['kimi', 'https://api.moonshot.cn/v1/chat/completions'],
  ['siliconflow', 'https://api.siliconflow.cn/v1/chat/completions'],
];
const payload = {
  method: 'POST',
  headers: { authorization: 'Bearer synthetic-only' },
  body: 'synthetic-private-input',
};

afterEach(() => vi.unstubAllGlobals());

describe('Provider transport target and one-request boundary', () => {
  it.each(routes)('sends %s only once with redirects disabled', async (provider, endpoint) => {
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response('synthetic'));
    vi.stubGlobal('fetch', send);
    const transport = createProviderTransport(provider, () => true);
    await transport(endpoint, { ...payload, redirect: 'follow' });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ ...payload, redirect: 'error' }),
    );
    await expect(transport(endpoint, payload)).rejects.toThrow('Provider request refused');
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(routes)(
    'rejects every changed target for %s before sending body or credentials',
    async (provider, endpoint) => {
      const send = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal('fetch', send);
      const url = new URL(endpoint);
      const targets = [
        endpoint.replace('https:', 'http:'),
        endpoint.replace(url.hostname, 'wrong.invalid'),
        endpoint.replace(url.hostname, `${url.hostname}:444`),
        endpoint + '/other',
        endpoint + '?forward=1',
        endpoint + '#fragment',
        endpoint.replace('https://', 'https://synthetic:credential@'),
        'not-a-url',
      ];
      for (const target of targets) {
        await expect(
          createProviderTransport(provider, () => true)(target, payload),
        ).rejects.toThrow('Provider request refused');
      }
      await expect(
        createProviderTransport(provider, () => true)(endpoint, { ...payload, method: 'GET' }),
      ).rejects.toThrow('Provider request refused');
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([301, 302, 307, 308])(
    'rejects HTTP %s and refuses any follow-up request',
    async (status) => {
      const send = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response('synthetic', { status, headers: { location: 'https://wrong.invalid/' } }),
      );
      vi.stubGlobal('fetch', send);
      const transport = createProviderTransport('openai', () => true);
      await expect(transport(routes[0][1], payload)).rejects.toThrow('Provider request refused');
      await expect(transport('https://wrong.invalid/', payload)).rejects.toThrow(
        'Provider request refused',
      );
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it('rejects a transport that reports a followed redirect or a changed final URL', async () => {
    for (const properties of [{ redirected: true }, { url: 'https://wrong.invalid/' }]) {
      const response = new Response('synthetic');
      for (const [name, value] of Object.entries(properties))
        Object.defineProperty(response, name, { value });
      const send = vi.fn<typeof globalThis.fetch>(async () => response);
      vi.stubGlobal('fetch', send);
      await expect(
        createProviderTransport('openai', () => true)(routes[0][1], payload),
      ).rejects.toThrow('Provider request refused');
      expect(send).toHaveBeenCalledOnce();
    }
  });

  it('consumes the request allowance after a network failure', async () => {
    const send = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('synthetic network failure');
    });
    vi.stubGlobal('fetch', send);
    const transport = createProviderTransport('openai', () => true);
    await expect(transport(routes[0][1], payload)).rejects.toThrow('synthetic network failure');
    await expect(transport(routes[0][1], payload)).rejects.toThrow('Provider request refused');
    expect(send).toHaveBeenCalledOnce();
  });

  it('refuses an inactive run and pre-aborted run, request and init signals before sending', async () => {
    const send = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', send);
    const aborted = AbortSignal.abort();
    await expect(
      createProviderTransport('openai', () => false)(routes[0][1], payload),
    ).rejects.toThrow();
    await expect(
      createProviderTransport('openai', () => true, aborted)(routes[0][1], payload),
    ).rejects.toThrow();
    await expect(
      createProviderTransport('openai', () => true)(routes[0][1], { ...payload, signal: aborted }),
    ).rejects.toThrow();
    await expect(
      createProviderTransport(
        'openai',
        () => true,
      )(new Request(routes[0][1], { ...payload, signal: aborted })),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves Request payload and joins its cancellation with the run signal', async () => {
    const run = new AbortController();
    const request = new Request(routes[0][1], payload);
    const send = vi.fn<typeof globalThis.fetch>(async () => new Response('synthetic'));
    vi.stubGlobal('fetch', send);
    await createProviderTransport('openai', () => true, run.signal)(request);
    const captured = send.mock.calls[0][0] as Request;
    expect(captured).toBeInstanceOf(Request);
    expect(captured).not.toBe(request);
    expect(captured.url).toBe(request.url);
    expect(captured.method).toBe('POST');
    expect(captured.headers.get('authorization')).toBe(payload.headers.authorization);
    expect(captured.bodyUsed).toBe(false);
    expect(await captured.text()).toBe(payload.body);
    await expect(captured.text()).rejects.toThrow(TypeError);
    expect(captured.redirect).toBe('error');
    expect(captured.signal.aborted).toBe(false);
    run.abort();
    expect(captured.signal.aborted).toBe(true);
  });

  it('drops a response that arrives after cancellation', async () => {
    const run = new AbortController();
    const send = vi.fn<typeof globalThis.fetch>(async () => {
      run.abort();
      return new Response('late');
    });
    vi.stubGlobal('fetch', send);
    await expect(
      createProviderTransport('openai', () => true, run.signal)(routes[0][1], payload),
    ).rejects.toThrow('Provider request refused');
    expect(send).toHaveBeenCalledOnce();
  });
});
