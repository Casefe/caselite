import { fileURLToPath } from 'node:url';
import WebpackPlugin from '@electron-forge/plugin-webpack';
import FusesPlugin from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const localPath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

export default {
  packagerConfig: {
    asar: true,
    executableName: 'CaseLite',
  },
  makers: [],
  plugins: [
    new WebpackPlugin({
      mainConfig: localPath('./webpack.main.config.mjs'),
      devContentSecurityPolicy:
        "default-src 'none'; script-src 'self'; style-src 'none'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      devServer: {
        host: 'localhost',
        hot: false,
        liveReload: false,
        client: false,
      },
      renderer: {
        config: localPath('./webpack.renderer.config.mjs'),
        nodeIntegration: false,
        entryPoints: [
          {
            name: 'main_window',
            html: localPath('./src/renderer/index.html'),
            js: localPath('./src/renderer/main.tsx'),
            preload: {
              js: localPath('./src/preload/index.ts'),
            },
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
