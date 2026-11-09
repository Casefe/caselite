import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { captureUi, reserveOutput } from './capture-ui.mjs';
import { captureSpecification, compareCaptures } from './lib/ui-capture-spec.mjs';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const run = reserveOutput(process.argv[2], process.argv[3]);
const fixture = resolve('tests/fixtures/ui-capture');
const build = join(run, 'build');
mkdirSync(build, { mode: 0o700 });
const server = createServer((request, response) => {
  const routes = {
    '/reference': ['text/html; charset=utf-8', join(fixture, 'reference.html')],
    '/bundle.js': ['text/javascript', join(build, 'bundle.js')],
    '/theme.css': ['text/css', resolve('apps/desktop/src/renderer/styles/theme.css')],
    '/sample.css': ['text/css', join(fixture, 'sample.css')],
  };
  if (request.url === '/implementation') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CaseLite 合成规格实现</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/sample.css"><div id="root"></div><script src="/bundle.js"></script></html>',
    );
  } else if (routes[request.url]) {
    const [type, file] = routes[request.url];
    response.setHeader('Content-Type', type);
    response.end(readFileSync(file));
  } else {
    response.statusCode = 404;
    response.end();
  }
});

try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const makePlan = (path) => ({
    version: 1,
    authorized: true,
    url: origin + path,
    allowedUrls: [origin + path],
    scope: '#sample',
    redact: ['[data-private]'],
    viewport: { width: 960, height: 720 },
    theme: 'light',
    allowActions: true,
    steps: [
      {
        id: 'empty',
        state: 'empty',
        expect: { selector: '#status', visibility: 'visible', text: '暂无关联任务' },
      },
      {
        id: 'selected',
        state: 'selected',
        action: { type: 'click', selector: '#select' },
        expect: { selector: '[aria-selected=true]', visibility: 'visible' },
      },
      {
        id: 'loading',
        state: 'loading',
        action: { type: 'click', selector: '#load' },
        expect: { selector: '#status', visibility: 'visible', text: '正在加载合成任务…' },
      },
      {
        id: 'error',
        state: 'error',
        action: { type: 'click', selector: '#error' },
        expect: { selector: '[role=alert]', visibility: 'visible' },
      },
      {
        id: 'collapsed',
        state: 'expanded',
        action: { type: 'click', selector: 'summary' },
        expect: { selector: '#select', visibility: 'hidden' },
      },
      {
        id: 'expanded',
        state: 'expanded',
        action: { type: 'press', selector: 'summary', key: 'Enter' },
        expect: { selector: '#select', visibility: 'visible' },
      },
    ],
  });
  const capture = async (name, path) => {
    const plan = makePlan(path);
    writeFileSync(join(run, `${name}-plan.json`), JSON.stringify(plan, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    const receipt = await captureUi({ plan, privateRoot: run, output: join(run, name) });
    if (receipt.status !== 'PASS_REAL') throw new Error(`${name}: ${receipt.failure}`);
  };
  await capture('reference', '/reference');
  const spec = captureSpecification(join(run, 'reference'));
  writeFileSync(join(run, 'ui-spec.json'), JSON.stringify(spec, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  const compiler = webpack({
    mode: 'development',
    devtool: false,
    entry: join(fixture, 'UiCaptureSample.tsx'),
    output: { path: build, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: {
            loader: require.resolve('ts-loader'),
            options: {
              configFile: resolve('apps/desktop/tsconfig.renderer.json'),
              transpileOnly: true,
              compilerOptions: { noEmit: false },
            },
          },
        },
      ],
    },
  });
  try {
    await new Promise((ok, reject) =>
      compiler.run((error, stats) =>
        error || stats.hasErrors()
          ? reject(error || new Error(stats.toString({ all: false, errors: true })))
          : ok(),
      ),
    );
  } finally {
    await new Promise((r) => compiler.close(r));
  }
  await capture('implementation', '/implementation');
  const comparison = compareCaptures(join(run, 'reference'), join(run, 'implementation'));
  writeFileSync(join(run, 'comparison.json'), JSON.stringify(comparison, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.info(JSON.stringify(comparison));
  process.exitCode = comparison.status === 'PASS_REAL' ? 0 : 1;
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
