import { chromium } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstatSync, realpathSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, parse } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (code) => {
  throw new Error(code);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const states = ['empty', 'loading', 'error', 'selected', 'expanded'];

export function validatePlan(plan) {
  if (!plan || plan.version !== 1 || plan.authorized !== true) fail('AUTHORIZATION_REQUIRED');
  const source = new URL(plan.url);
  if (
    !['http:', 'https:'].includes(source.protocol) ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  )
    fail('UNSAFE_URL');
  if (
    !Array.isArray(plan.allowedUrls) ||
    !plan.allowedUrls.includes(source.href) ||
    plan.allowedUrls.length > 10
  )
    fail('URL_BOUNDARY_REQUIRED');
  for (const url of plan.allowedUrls) {
    const target = new URL(url);
    if (
      target.origin !== source.origin ||
      target.search ||
      target.hash ||
      target.username ||
      target.password
    )
      fail('CROSS_ORIGIN_PLAN');
  }
  if (!plan.scope || typeof plan.scope !== 'string' || plan.scope.length > 256)
    fail('SCOPE_REQUIRED');
  if (
    !Array.isArray(plan.redact) ||
    plan.redact.length > 30 ||
    plan.redact.some((s) => typeof s !== 'string' || s.length > 256)
  )
    fail('REDACTION_PLAN_REQUIRED');
  if (
    !plan.viewport ||
    ![plan.viewport.width, plan.viewport.height].every(
      (n) => Number.isInteger(n) && n >= 320 && n <= 2560,
    )
  )
    fail('VIEWPORT_LIMIT');
  if (!['light', 'dark'].includes(plan.theme)) fail('THEME_REQUIRED');
  if (!Array.isArray(plan.steps) || plan.steps.length > 12) fail('STEP_LIMIT');
  for (const step of plan.steps) {
    if (
      !/^[a-z][a-z0-9-]{0,39}$/.test(step.id) ||
      ['initial', 'manifest'].includes(step.id) ||
      !states.includes(step.state)
    )
      fail('INVALID_STEP');
    if (step.action) {
      if (
        plan.allowActions !== true ||
        !['click', 'press'].includes(step.action.type) ||
        typeof step.action.selector !== 'string' ||
        step.action.selector.length > 256
      )
        fail('ACTION_NOT_AUTHORIZED');
      if (
        step.action.type === 'press' &&
        !['Tab', 'Enter', 'Space', 'ArrowDown', 'ArrowUp', 'Escape'].includes(step.action.key)
      )
        fail('KEY_NOT_ALLOWED');
    }
    if (
      !step.expect ||
      typeof step.expect.selector !== 'string' ||
      step.expect.selector.length > 256 ||
      !['visible', 'hidden'].includes(step.expect.visibility)
    )
      fail('VISIBLE_EXPECTATION_REQUIRED');
    if (
      step.expect.text !== undefined &&
      (typeof step.expect.text !== 'string' || step.expect.text.length > 200)
    )
      fail('EXPECTATION_TEXT_LIMIT');
  }
  if (new Set(plan.steps.map((s) => s.id)).size !== plan.steps.length) fail('DUPLICATE_STEP');
  return { ...plan, origin: source.origin };
}

// 只接受现有私有根下的新目录；逐层拒绝链接，历史目录即使为空也不复用。
export function reserveOutput(root, output, repository = process.cwd()) {
  if (!isAbsolute(root) || !isAbsolute(output)) fail('ABSOLUTE_OUTPUT_REQUIRED');
  for (const candidate of [root, dirname(output)]) {
    let current = parse(candidate).root;
    for (const part of candidate.slice(current.length).split('/').filter(Boolean)) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) fail('SYMLINK_OUTPUT');
    }
  }
  const canonicalRoot = realpathSync(root);
  const repo = realpathSync(repository);
  if (
    canonicalRoot === repo ||
    canonicalRoot.startsWith(repo + '/') ||
    lstatSync(root).mode & 0o077
  )
    fail('PRIVATE_EXTERNAL_ROOT_REQUIRED');
  if (
    resolve(output) !== join(canonicalRoot, output.split('/').at(-1)) ||
    realpathSync(dirname(output)) !== canonicalRoot
  )
    fail('OUTPUT_ESCAPE');
  mkdirSync(output, { mode: 0o700 });
  return output;
}

export async function captureUi({ plan: input, privateRoot, output, signal }) {
  const plan = validatePlan(input);
  const destination = reserveOutput(privateRoot, output);
  let browser;
  let context;
  let timer;
  let stopped;
  let boundary;
  let totalBytes = 0;
  const receipt = {
    version: 1,
    status: 'FAIL',
    startedAt: new Date().toISOString(),
    source: plan.url,
    planSha256: hash(JSON.stringify(input)),
    collectorSha256: hash(readFileSync(new URL(import.meta.url))),
    viewport: plan.viewport,
    theme: plan.theme,
    deviceScaleFactor: 1,
    browserZoom: 1,
    isolation: 'new browser, nonpersistent context; no imported profile or credentials',
    observations: [],
    inferences: [],
    states: Object.fromEntries(states.map((s) => [s, 'NOT_RUN'])),
    artifacts: [],
    limitations: [
      'Visible UI only; backend, permissions and legal/business rules NOT_RUN.',
      'No OS network sandbox; same-origin GET/HEAD resources allowed.',
      'Operator must choose a safe scope and redact sensitive visible text before capture.',
    ],
  };
  const write = (name, data) => {
    const bytes = typeof data === 'string' ? data : data;
    const size = Buffer.byteLength(bytes);
    totalBytes += size;
    if (size > 2_000_000 || totalBytes > 12_000_000) fail('OUTPUT_SIZE_LIMIT');
    writeFileSync(join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
    receipt.artifacts.push({ file: name, bytes: size, sha256: hash(bytes) });
  };
  const stop = (code) => {
    stopped = code;
    void browser?.close();
  };
  const abort = () => stop('CANCELLED');
  const check = () => {
    if (stopped || boundary) fail(stopped || boundary);
  };
  try {
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) fail('CANCELLED');
    timer = setTimeout(() => stop('CAPTURE_TIMEOUT'), 30_000);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    check();
    receipt.browser = browser.version();
    context = await browser.newContext({
      viewport: plan.viewport,
      deviceScaleFactor: 1,
      colorScheme: plan.theme,
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
    });
    let page;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const navigation = request.isNavigationRequest();
      let owner;
      try {
        owner = request.frame().page();
      } catch {
        /* 新窗口首个导航尚无frame，也必须拒绝。 */
      }
      if (owner !== page) {
        boundary = 'POPUP_BLOCKED';
        return route.abort('blockedbyclient');
      }
      if (
        url.origin !== plan.origin ||
        !['GET', 'HEAD'].includes(request.method()) ||
        (navigation && !plan.allowedUrls.includes(url.href))
      ) {
        boundary = 'REQUEST_BOUNDARY';
        return route.abort('blockedbyclient');
      }
      // route.continue会让浏览器自行跟随重定向，后续跳转可能不再经过路由；因此逐请求禁止自动跳转。
      try {
        const response = await route.fetch({ maxRedirects: 0, timeout: 9000 });
        if (response.status() >= 300 && response.status() < 400) {
          boundary = 'REDIRECT_BLOCKED';
          await route.abort('blockedbyclient');
        } else await route.fulfill({ response });
      } catch {
        if (!stopped && !receipt.failure) boundary ??= 'RESOURCE_UNAVAILABLE';
        await route.abort('failed').catch(() => {});
      }
    });
    await context.routeWebSocket('**/*', (ws) => {
      boundary = 'WEBSOCKET_BLOCKED';
      ws.close();
    });
    page = await context.newPage();
    context.on('page', (popup) => {
      boundary = 'POPUP_BLOCKED';
      void popup.close();
    });
    page.on('dialog', (dialog) => {
      boundary = 'DIALOG_BLOCKED';
      void dialog.dismiss();
    });
    page.on('download', (download) => {
      boundary = 'DOWNLOAD_BLOCKED';
      void download.cancel();
    });
    page.setDefaultTimeout(4000);
    let response;
    try {
      response = await page.goto(plan.url, { waitUntil: 'domcontentloaded', timeout: 8000 });
    } catch (error) {
      check();
      fail(error.name === 'TimeoutError' ? 'PAGE_TIMEOUT' : 'PAGE_UNREACHABLE');
    }
    check();
    if (!response?.ok()) fail('PAGE_UNREACHABLE');
    const scope = page.locator(plan.scope);
    if ((await scope.count()) > 1) fail('SCOPE_NOT_UNIQUE');
    try {
      await scope.waitFor({ state: 'visible' });
    } catch {
      check();
      fail('SCOPE_UNAVAILABLE_OR_LOGIN_REQUIRED');
    }
    async function snapshot(id) {
      check();
      if ((await scope.locator('*').count()) > 300) fail('DOM_SIZE_LIMIT');
      // 普通DOM脱敏无法覆盖开放/关闭的ShadowRoot；只检查结构并明确拒绝，不落盘CDP返回内容。
      const marker = `data-capture-${randomUUID()}`;
      const cdp = await context.newCDPSession(page);
      try {
        await scope.evaluate((element, name) => element.setAttribute(name, ''), marker);
        const document = await cdp.send('DOM.getDocument', { depth: 0 });
        const match = await cdp.send('DOM.querySelector', {
          nodeId: document.root.nodeId,
          selector: `[${marker}]`,
        });
        if (!match.nodeId) fail('SHADOW_DOM_UNSUPPORTED');
        const described = await cdp.send('DOM.describeNode', {
          nodeId: match.nodeId,
          depth: -1,
          pierce: false,
        });
        const visit = (node) => {
          if (node.shadowRoots?.some((root) => root.shadowRootType !== 'user-agent'))
            fail('SHADOW_DOM_UNSUPPORTED');
          for (const child of node.children ?? []) visit(child);
        };
        visit(described.node);
      } finally {
        await scope
          .evaluate((element, name) => element.removeAttribute(name), marker)
          .catch(() => {});
        await cdp.detach().catch(() => {});
      }
      if (
        await scope.evaluate((root) =>
          [root, ...root.querySelectorAll('*')].some((node) =>
            [...(node.labels ?? [])].some(
              (label) => !root.contains(label) || !label.checkVisibility(),
            ),
          ),
        )
      )
        fail('EXTERNAL_LABEL_UNSUPPORTED');
      if (!plan.allowedUrls.includes(page.url())) fail('NAVIGATION_BOUNDARY');
      const bounds = await scope.boundingBox();
      if (
        !bounds ||
        bounds.width > plan.viewport.width ||
        bounds.height > plan.viewport.height ||
        bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.x + bounds.width > plan.viewport.width ||
        bounds.y + bounds.height > plan.viewport.height
      )
        fail('SCOPE_SIZE_LIMIT');
      if ((await scope.locator('*').count()) > 300) fail('DOM_SIZE_LIMIT');
      const sensitive = page.locator(
        [
          ...plan.redact,
          'input',
          'textarea',
          '[contenteditable]',
          'iframe',
          'canvas',
          'video',
        ].join(','),
      );
      // 同时从AX、DOM摘要和截图排除；不保存HTML、输入值、href或任意属性。
      const handles = await sensitive.elementHandles();
      const previous = [];
      try {
        for (const handle of handles)
          previous.push(
            await handle.evaluate((el) => {
              const nodes = [el, ...el.querySelectorAll('*')];
              return nodes.map((node) => {
                const attributes = [
                  'style',
                  'aria-label',
                  'title',
                  'alt',
                  'aria-description',
                  'placeholder',
                  'value',
                ].map((name) => [name, node.getAttribute(name)]);
                const texts = [...node.childNodes]
                  .filter((n) => n.nodeType === 3)
                  .map((n) => n.textContent);
                for (const child of node.childNodes)
                  if (child.nodeType === 3) child.textContent = '[REDACTED]';
                for (const [name] of attributes)
                  if (name !== 'style' && node.hasAttribute(name))
                    node.setAttribute(name, '[REDACTED]');
                node.style.setProperty('visibility', 'hidden', 'important');
                return { attributes, texts };
              });
            }),
          );
        // AX会输出链接URL，并可能沿ARIA引用带出区域外隐藏文本；采样时去掉这些来源，随后恢复。
        const semantics = await scope.evaluateHandle((root) =>
          [root, ...root.querySelectorAll('*')].map((node) => {
            const names = [
              'href',
              'role',
              'aria-labelledby',
              'aria-describedby',
              'aria-details',
              'aria-owns',
              'aria-activedescendant',
            ];
            const attributes = names.map((name) => [name, node.getAttribute(name)]);
            if (node.hasAttribute('href')) {
              node.removeAttribute('href');
              node.setAttribute('role', 'link');
            }
            for (const name of names.slice(2)) {
              const ids = node.getAttribute(name)?.split(/\s+/).filter(Boolean) ?? [];
              if (
                name === 'aria-owns' ||
                ids.some((id) => {
                  const target = root.ownerDocument.getElementById(id);
                  return !target || !root.contains(target) || !target.checkVisibility();
                })
              )
                node.removeAttribute(name);
            }
            return { node, attributes };
          }),
        );
        let aria;
        try {
          aria = await scope.ariaSnapshot({ timeout: 4000 });
        } finally {
          await semantics.evaluate((original) =>
            original.forEach(({ node, attributes }) => {
              for (const [name, value] of attributes) {
                if (value === null) node.removeAttribute(name);
                else node.setAttribute(name, value);
              }
            }),
          );
          await semantics.dispose();
        }
        if (!aria.trim()) fail('AX_UNAVAILABLE');
        if (aria.length > 32_000) fail('AX_SIZE_LIMIT');
        const dom = await scope.evaluate((root) => {
          const view = root.ownerDocument.defaultView;
          const properties = [
            'display',
            'color',
            'backgroundColor',
            'fontFamily',
            'fontSize',
            'fontWeight',
            'lineHeight',
            'padding',
            'gap',
            'borderRadius',
            'outlineStyle',
            'outlineWidth',
            'gridTemplateColumns',
          ];
          return [root, ...root.querySelectorAll('*')]
            .filter((el) => {
              const style = view.getComputedStyle(el);
              const box = el.getBoundingClientRect();
              return (
                el.checkVisibility() &&
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                box.width > 0 &&
                box.height > 0
              );
            })
            .map((el) => {
              const style = view.getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute('role'),
                text: [...el.childNodes]
                  .filter((n) => n.nodeType === 3)
                  .map((n) => n.textContent)
                  .join('')
                  .trim()
                  .slice(0, 200),
                geometry: { x: r.x, y: r.y, width: r.width, height: r.height },
                style: Object.fromEntries(properties.map((p) => [p, style[p]])),
                selected: el.getAttribute('aria-selected'),
                expanded: el.getAttribute('aria-expanded'),
                open: el.tagName === 'DETAILS' ? el.open : null,
                focused: el === root.ownerDocument.activeElement,
              };
            });
        });
        const image = await scope.screenshot({ animations: 'disabled', timeout: 4000 });
        check();
        write(`${id}.png`, image);
        write(
          `${id}.json`,
          JSON.stringify({ aria, dom, bounds, capturedAt: new Date().toISOString() }, null, 2),
        );
      } finally {
        for (let i = handles.length - 1; i >= 0; i--) {
          if (i < previous.length)
            await handles[i]
              .evaluate((el, old) => {
                [el, ...el.querySelectorAll('*')].forEach((node, index) => {
                  if (!old[index]) return;
                  for (const [name, value] of old[index].attributes) {
                    if (value === null) node.removeAttribute(name);
                    else node.setAttribute(name, value);
                  }
                  [...node.childNodes]
                    .filter((n) => n.nodeType === 3)
                    .forEach((n, j) => {
                      n.textContent = old[index].texts[j];
                    });
                });
              }, previous[i])
              .catch(() => {});
          await handles[i].dispose();
        }
      }
    }
    await snapshot('initial');
    for (const step of plan.steps) {
      check();
      if (step.action) {
        const target = scope.locator(step.action.selector);
        const handle = await target.elementHandle();
        const root = await scope.elementHandle();
        try {
          if (
            !handle ||
            !root ||
            !(await handle.evaluate((element, parent) => parent.contains(element), root))
          )
            fail('ACTION_SCOPE_BOUNDARY');
          if (step.action.type === 'click') await handle.click();
          else await handle.press(step.action.key);
        } finally {
          await handle?.dispose();
          await root?.dispose();
        }
      }
      const expected =
        step.expect.text === undefined
          ? scope.locator(step.expect.selector)
          : scope.locator(step.expect.selector).filter({ hasText: step.expect.text });
      await expected.waitFor({ state: step.expect.visibility });
      if (await expected.count()) {
        const root = await scope.elementHandle();
        try {
          if (
            !root ||
            !(await expected.evaluate((element, parent) => parent.contains(element), root))
          )
            fail('EXPECTATION_SCOPE_BOUNDARY');
        } finally {
          await root?.dispose();
        }
      }
      check();
      await snapshot(step.id);
      receipt.states[step.state] = 'PASS_REAL';
      receipt.observations.push({
        id: step.id,
        action: step.action ?? null,
        visibleResult: step.expect,
        stateLabel: step.state,
      });
    }
    receipt.status = 'PASS_REAL';
  } catch (error) {
    receipt.failure =
      stopped || boundary || (/^[A-Z_]+$/.test(error.message) ? error.message : 'CAPTURE_FAILED');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (stopped || boundary) {
      receipt.status = 'FAIL';
      receipt.failure = stopped || boundary;
    }
    receipt.cleanedUp = !browser?.isConnected();
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(join(destination, 'manifest.json'), JSON.stringify(receipt, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new globalThis.AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    if (process.argv.length !== 5)
      fail('USAGE: node scripts/capture-ui.mjs PLAN.json PRIVATE_ROOT NEW_OUTPUT');
    const result = await captureUi({
      plan: JSON.parse(readFileSync(process.argv[2], 'utf8')),
      privateRoot: process.argv[3],
      output: process.argv[4],
      signal: controller.signal,
    });
    console.info(
      JSON.stringify({
        status: result.status,
        failure: result.failure,
        cleanedUp: result.cleanedUp,
      }),
    );
    process.exitCode = result.status === 'PASS_REAL' ? 0 : 1;
  } catch (error) {
    console.error(/^[A-Z_: .a-z/-]+$/.test(error.message) ? error.message : 'CAPTURE_SETUP_FAILED');
    process.exitCode = 1;
  }
}
