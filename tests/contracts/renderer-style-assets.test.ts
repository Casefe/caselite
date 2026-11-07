import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import config from '../../apps/desktop/webpack.renderer.config.mjs';

it('emits every local stylesheet imported by the UI entry for packaged file URLs', async () => {
  const assets = new Map<string, Buffer>();
  let emit: (() => Promise<void>) | undefined;
  const compilation = {
    emitAsset(name: string, asset: { content: Buffer }) {
      assets.set(name, asset.content);
    },
    hooks: {
      processAssets: {
        tapPromise(_: unknown, action: () => Promise<void>) {
          emit = action;
        },
      },
    },
  };
  const compiler = {
    hooks: {
      thisCompilation: {
        tap(_: unknown, action: (value: typeof compilation) => void) {
          action(compilation);
        },
      },
    },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: 1 },
      sources: {
        RawSource: class {
          constructor(public content: Buffer) {}
        },
      },
    },
  };
  config.plugins[0].apply(compiler);
  await emit!();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    expect(assets.has(name), `Missing packaged CSS: ${name}`).toBe(true);
    const content = assets.get(name)!.toString();
    expect(content).toBe(readFileSync(resolve('apps/desktop/src/renderer', name), 'utf8'));
    for (const match of content.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      visit(resolve('/', dirname(name), match[1]).slice(1));
    }
  };
  visit('ui-design.css');
  expect(seen.size).toBeGreaterThan(1);
});
