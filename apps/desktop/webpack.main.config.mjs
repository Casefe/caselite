import { fileURLToPath } from 'node:url';

const localPath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

export default {
  entry: localPath('./src/main/index.ts'),
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        include: localPath('./src/main/'),
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
