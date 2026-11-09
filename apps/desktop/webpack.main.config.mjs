import { fileURLToPath } from 'node:url';

const localPath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

export default {
  entry: {
    main: { import: localPath('./src/main/index.ts'), filename: 'index.cjs' },
    docxWorker: {
      import: localPath('./src/main/adapters/docx-worker.ts'),
      filename: 'docx-worker.cjs',
    },
    wordExportWorker: {
      import: localPath('./src/main/adapters/word-export-worker.ts'),
      filename: 'word-export-worker.cjs',
    },
  },
  devtool: 'source-map',
  node: {
    __dirname: false,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // This package command targets macOS Apple Silicon. Use the package's
    // explicit prebuilt entry so Webpack can include its native binary.
    alias: {
      'better-sqlite3$': 'better-sqlite3/darwin-arm64',
    },
  },
  module: {
    rules: [
      {
        test: /native_modules\/.+\.node$/,
        use: 'node-loader',
      },
      {
        test: /\.(m?js|node)$/,
        parser: { amd: false },
        use: {
          loader: '@vercel/webpack-asset-relocator-loader',
          options: { outputAssetBase: 'native_modules' },
        },
      },
      {
        test: /\.ts$/,
        include: [
          localPath('./src/main/'),
          localPath('../../packages/application/src/'),
          localPath('../../packages/contracts/src/'),
          localPath('../../packages/local-db/src/'),
        ],
        use: {
          loader: 'ts-loader',
          options: {
            configFile: localPath('./tsconfig.main.json'),
            transpileOnly: false,
          },
        },
      },
    ],
  },
};
