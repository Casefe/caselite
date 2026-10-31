import { fileURLToPath } from 'node:url';
import WebpackPlugin from '@electron-forge/plugin-webpack';
import AutoUnpackNativesPlugin from '@electron-forge/plugin-auto-unpack-natives';
import FusesPlugin from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const localPath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

// Keep verification when the matching Electron ZIP is already in the local cache.
// Without this, @electron/get downloads SHASUMS256.txt on every package run.
// Update this value from electron/checksums.json whenever Electron is upgraded.
const electronArtifactChecksums = {
  'electron-v45.1.0-darwin-arm64.zip':
    '002b71efcf90e247317d3da486f2d4e51860e9c2889d49f33e229ab2268b0f3b',
};

export default {
  packagerConfig: {
    asar: true,
    download: {
      checksums: electronArtifactChecksums,
    },
    executableName: 'CaseLite',
    extraResource: [localPath('../../packages/local-db/migrations')],
  },
  makers: [],
  plugins: [
    new AutoUnpackNativesPlugin({}),
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
