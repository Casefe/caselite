import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const localPath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const reactPdfRoot = dirname(require.resolve('react-pdf/package.json'));
const pdfjsVersion = require('pdfjs-dist/package.json').version;

// Emit into webpack's output filesystem so both the development server and
// packaged file:// renderer use the same local assets without a CDN.
class PdfSpikeAssetsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('PdfSpikeAssetsPlugin', (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: 'PdfSpikeAssetsPlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        async () => {
          const files = [
            [join(reactPdfRoot, 'dist/Page/TextLayer.css'), 'pdf-resources/TextLayer.css'],
            [localPath('./src/renderer/pdf-spike.css'), 'pdf-resources/spike.css'],
          ];
          for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
            for (const name of await readdir(join(pdfjsRoot, directory))) {
              files.push([join(pdfjsRoot, directory, name), `pdf-resources/${directory}/${name}`]);
            }
          }
          for (const [source, target] of files) {
            compilation.emitAsset(
              target,
              new compiler.webpack.sources.RawSource(await readFile(source)),
            );
          }
          // Keep a test-only Worker with a different internal version. PDF.js
          // itself must reject it during getDocument; the production Worker is
          // emitted separately and is never rewritten.
          const workerSource = await readFile(join(pdfjsRoot, 'build/pdf.worker.mjs'), 'utf8');
          const expected = `const workerVersion = "${pdfjsVersion}";`;
          if (workerSource.split(expected).length !== 2) {
            throw new Error('PDF.js Worker version marker changed; update the mismatch probe');
          }
          compilation.emitAsset(
            'pdf-resources/mismatch-worker.mjs',
            new compiler.webpack.sources.RawSource(
              workerSource.replace(expected, 'const workerVersion = "0.0.0-caselite-test";'),
            ),
          );
        },
      );
    });
  }
}

export default {
  // Avoid eval-based development bundles so the CSP needs no unsafe-eval.
  devtool: 'source-map',
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  plugins: [new PdfSpikeAssetsPlugin()],
  module: {
    rules: [
      {
        test: /\.pdf$/,
        type: 'asset/inline',
      },
      {
        test: /\.tsx?$/,
        include: localPath('./src/renderer/'),
        use: {
          loader: 'ts-loader',
          options: {
            instance: 'renderer',
            configFile: localPath('./tsconfig.renderer.json'),
            transpileOnly: false,
          },
        },
      },
      {
        test: /\.ts$/,
        include: [localPath('./src/preload/'), localPath('../../packages/contracts/src/')],
        use: {
          loader: 'ts-loader',
          options: {
            instance: 'preload',
            configFile: localPath('./tsconfig.preload.json'),
            transpileOnly: false,
          },
        },
      },
    ],
  },
};
