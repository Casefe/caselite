import { fileURLToPath } from 'node:url';

const localPath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

export default {
  // Avoid eval-based development bundles so the CSP needs no unsafe-eval.
  devtool: 'source-map',
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
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
        include: localPath('./src/preload/'),
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
