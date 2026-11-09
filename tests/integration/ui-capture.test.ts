import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { captureUi, reserveOutput, validatePlan } from '../../scripts/capture-ui.mjs';
import { readCapture } from '../../scripts/lib/ui-capture-spec.mjs';

const root =
  process.env.UI_CAPTURE_TEST_ROOT ||
  realpathSync(mkdtempSync(join(tmpdir(), 'caselite-ui-capture-')));
const base = (url = 'http://127.0.0.1:12345/reference') => ({
  version: 1,
  authorized: true,
  url,
  allowedUrls: [url],
  scope: '#sample',
  redact: ['[data-private]'],
  viewport: { width: 960, height: 720 },
  theme: 'light',
  steps: [],
});

describe('bounded local UI capture', () => {
  it('rejects unauthorized plans, cross-origin scope, oversized viewport and unauthorized interactions', () => {
    for (const plan of [
      { ...base(), authorized: false },
      { ...base(), url: 'file:///private/example' },
      { ...base(), allowedUrls: [...base().allowedUrls, 'https://example.invalid/'] },
      { ...base(), viewport: { width: 100000, height: 720 } },
      { ...base(), steps: Array(13).fill({}) },
      {
        ...base(),
        steps: [
          {
            id: 'manifest',
            state: 'empty',
            expect: { selector: '#status', visibility: 'visible' },
          },
        ],
      },
      {
        ...base(),
        steps: [{ id: 'a', state: 'selected', action: { type: 'click', selector: 'button' } }],
      },
    ])
      expect(() => validatePlan(plan)).toThrow();
  });

  it('reserves fresh private directories and rejects reuse, traversal, repo output and symlink roots', () => {
    const area = mkdtempSync(join(root, 'paths-'));
    const first = join(area, 'first');
    expect(reserveOutput(area, first)).toBe(first);
    expect(() => reserveOutput(area, first)).toThrow();
    expect(() => reserveOutput(area, join(area, '../escape'))).toThrow('OUTPUT_ESCAPE');
    const link = join(area, 'link');
    symlinkSync(first, link);
    expect(() => reserveOutput(link, join(link, 'child'))).toThrow('SYMLINK_OUTPUT');
    expect(() => reserveOutput(area, join(area, 'repo'), area)).toThrow(
      'PRIVATE_EXTERNAL_ROOT_REQUIRED',
    );
    chmodSync(area, 0o755);
    expect(() => reserveOutput(area, join(area, 'public'))).toThrow(
      'PRIVATE_EXTERNAL_ROOT_REQUIRED',
    );
  });

  it('captures real Chrome evidence and rejects redirect, popup, limits, missing AX, cancellation and hash tampering', async () => {
    const area = mkdtempSync(join(root, 'browser-'));
    let escaped = 0;
    const other = createServer((_req, res) => {
      escaped++;
      res.end('outside');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherPort = (other.address() as { port: number }).port;
    const fixture = readFileSync(
      new URL('../fixtures/ui-capture/reference.html', import.meta.url),
      'utf8',
    );
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `http://127.0.0.1:${otherPort}/outside` });
        res.end();
      } else if (req.url === '/popup')
        res.end(
          '<main id="sample"><button onclick="window.open(\'/target\')">Open</button></main>',
        );
      else if (req.url === '/large') res.end('<main id="sample" style="width:5000px">large</main>');
      else if (req.url === '/many')
        res.end(`<main id="sample">${'<span>x</span>'.repeat(301)}</main>`);
      else if (req.url === '/no-ax')
        res.end('<main id="sample" aria-hidden="true"><b>hidden</b></main>');
      else if (req.url === '/cross')
        res.end(`<main id="sample">inside<img src="http://127.0.0.1:${otherPort}/outside"></main>`);
      else if (req.url === '/huge-ax') res.end(`<main id="sample">${'x'.repeat(40000)}</main>`);
      else if (req.url === '/shadow' || req.url === '/closed-shadow')
        res.end(
          `<main id="sample"><div id="host"></div></main><script>document.querySelector('#host').attachShadow({mode:'${req.url === '/shadow' ? 'open' : 'closed'}'}).innerHTML='<a href="/export?auth=SHADOW-DO-NOT-CAPTURE-TOKEN">Visible shadow link</a>'</script>`,
        );
      else if (req.url === '/native-label')
        res.end(
          '<label for="button" hidden>OUTSIDE-NATIVE-HIDDEN-SECRET</label><main id="sample"><button id="button">Public Button</button></main>',
        );
      else if (req.url === '/scope-escape')
        res.end(
          '<main id="sample"><p id="status">INSIDE</p></main><button onclick="document.querySelector(\'#status\').textContent=\'OUTSIDE_BUTTON_CLICKED\'">outside</button>',
        );
      else if (req.url === '/privacy')
        res.end(
          '<span id="external" hidden>OUTSIDE-HIDDEN-SECRET</span><main id="sample" aria-labelledby="external"><a href="/export?auth=DO-NOT-CAPTURE-TOKEN">Visible public link</a></main>',
        );
      else if (req.url === '/timeout') {
        /* 合成悬挂请求，验证导航超时与清理。 */
      } else if (req.url === '/unreachable') {
        res.statusCode = 503;
        res.end();
      } else res.end(fixture);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const results: unknown[] = [];
    async function run(name: string, override = {}, signal?: AbortSignal) {
      const receipt = await captureUi({
        plan: { ...base(origin + '/reference'), ...override },
        privateRoot: area,
        output: join(area, name),
        signal,
      });
      results.push({ name, receipt });
      expect(receipt.cleanedUp).toBe(true);
      return receipt;
    }
    async function runCli(name: string, path: string, terminate = false) {
      const planFile = join(area, `${name}-plan.json`);
      writeFileSync(planFile, JSON.stringify(base(origin + path)), { flag: 'wx', mode: 0o600 });
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL('../../scripts/capture-ui.mjs', import.meta.url)),
          planFile,
          area,
          join(area, name),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });
      const timer = terminate ? setTimeout(() => child.kill('SIGTERM'), 800) : undefined;
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      clearTimeout(timer);
      results.push({
        name,
        command: 'node scripts/capture-ui.mjs PLAN PRIVATE_ROOT NEW_OUTPUT',
        code,
        output,
      });
      const receipt = JSON.parse(readFileSync(join(area, name, 'manifest.json'), 'utf8'));
      expect(receipt.cleanedUp).toBe(true);
      expect(code).toBe(terminate ? 1 : 0);
      expect(receipt.status).toBe(terminate ? 'FAIL' : 'PASS_REAL');
      if (terminate) expect(receipt.failure).toBe('CANCELLED');
    }
    try {
      await runCli('cli-pass', '/reference');
      await runCli('cli-cancel', '/timeout', true);
      const passed = await run('pass');
      expect(passed.status).toBe('PASS_REAL');
      expect(passed.states).toEqual({
        empty: 'NOT_RUN',
        loading: 'NOT_RUN',
        error: 'NOT_RUN',
        selected: 'NOT_RUN',
        expanded: 'NOT_RUN',
      });
      const content = readFileSync(join(area, 'pass/initial.json'), 'utf8');
      expect(content).not.toContain('DO-NOT-CAPTURE');
      expect(content).not.toContain('合成敏感占位');
      expect(readCapture(join(area, 'pass')).snapshots.initial.dom.length).toBeGreaterThan(5);
      for (const [name, path, code] of [
        ['redirect', '/redirect', 'REDIRECT_BLOCKED'],
        ['large', '/large', 'SCOPE_SIZE_LIMIT'],
        ['many', '/many', 'DOM_SIZE_LIMIT'],
        ['cross', '/cross', 'REQUEST_BOUNDARY'],
        ['huge-ax', '/huge-ax', 'AX_SIZE_LIMIT'],
        ['shadow', '/shadow', 'SHADOW_DOM_UNSUPPORTED'],
        ['closed-shadow', '/closed-shadow', 'SHADOW_DOM_UNSUPPORTED'],
        ['native-label', '/native-label', 'EXTERNAL_LABEL_UNSUPPORTED'],
        ['no-ax', '/no-ax', 'AX_UNAVAILABLE'],
        ['unreachable', '/unreachable', 'PAGE_UNREACHABLE'],
        ['timeout', '/timeout', 'PAGE_TIMEOUT'],
      ]) {
        const url = origin + path;
        const result = await run(name, { url, allowedUrls: [url] });
        expect(result.status).toBe('FAIL');
        expect(result.failure).toBe(code);
      }
      expect(escaped).toBe(0);
      const privacy = origin + '/privacy';
      expect((await run('privacy', { url: privacy, allowedUrls: [privacy] })).status).toBe(
        'PASS_REAL',
      );
      const privateContent = readFileSync(join(area, 'privacy/initial.json'), 'utf8');
      expect(privateContent).toContain('Visible public link');
      expect(privateContent).not.toContain('DO-NOT-CAPTURE-TOKEN');
      expect(privateContent).not.toContain('OUTSIDE-HIDDEN-SECRET');
      expect(privateContent).not.toContain('/url:');
      const escape = origin + '/scope-escape';
      const scopeResult = await run('scope-escape', {
        url: escape,
        allowedUrls: [escape],
        allowActions: true,
        steps: [
          {
            id: 'outside',
            state: 'selected',
            action: { type: 'click', selector: 'xpath=../button' },
            expect: { selector: '#status', visibility: 'visible' },
          },
        ],
      });
      expect(scopeResult.status).toBe('FAIL');
      expect(scopeResult.failure).toBe('ACTION_SCOPE_BOUNDARY');
      const expectResult = await run('expect-escape', {
        url: escape,
        allowedUrls: [escape],
        steps: [
          {
            id: 'outside',
            state: 'selected',
            expect: { selector: 'xpath=../button', visibility: 'visible' },
          },
        ],
      });
      expect(expectResult.status).toBe('FAIL');
      expect(expectResult.failure).toBe('EXPECTATION_SCOPE_BOUNDARY');
      const popup = origin + '/popup';
      const popupResult = await run('popup', {
        url: popup,
        allowedUrls: [popup, origin + '/target'],
        allowActions: true,
        steps: [
          {
            id: 'popup',
            state: 'expanded',
            action: { type: 'click', selector: 'button' },
            expect: { selector: 'button', visibility: 'visible' },
          },
        ],
      });
      expect(popupResult.status).toBe('FAIL');
      expect(popupResult.failure).toBe('POPUP_BLOCKED');
      const cancel = new AbortController();
      const pending = run(
        'cancel',
        { url: origin + '/timeout', allowedUrls: [origin + '/timeout'] },
        cancel.signal,
      );
      setTimeout(() => cancel.abort(), 500);
      expect((await pending).failure).toBe('CANCELLED');
      writeFileSync(join(area, 'pass/initial.json'), '{}');
      expect(() => readCapture(join(area, 'pass'))).toThrow('ARTIFACT_HASH_MISMATCH');
    } finally {
      writeFileSync(
        join(area, 'test-results.json'),
        JSON.stringify({ results, escaped }, null, 2),
        { flag: 'wx', mode: 0o600 },
      );
      for (const active of [server, other]) {
        active.closeAllConnections();
        await new Promise<void>((r) => active.close(() => r()));
      }
    }
  }, 60_000);
});
