import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
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
  // 文件提供商目录可能重建 FinderInfo；可选择本地构建目录，严格签名校验保持开启。
  outDir: process.env.CASELITE_FORGE_OUT_DIR || undefined,
  packagerConfig: {
    appBundleId: 'com.caselite.desktop',
    asar: true,
    download: {
      checksums: electronArtifactChecksums,
    },
    executableName: 'CaseLite',
    icon: localPath('./assets/branding/caselite.icns'),
    extraResource: [
      localPath('./assets/THIRD-PARTY-DOCX-NOTICES.txt'),
      localPath('./.webpack/arm64/main/docx-worker.cjs'),
      localPath('../../packages/local-db/migrations'),
      localPath('./assets/THIRD-PARTY-AI-NOTICES.txt'),
      localPath('./assets/THIRD-PARTY-GRAPH-NOTICES.txt'),
      localPath('../../artifacts/native/caselite-vision'),
    ],
  },
  hooks: {
    generateAssets: async () => {
      const output = localPath('../../artifacts/native');
      execFileSync('/bin/mkdir', ['-p', output]);
      execFileSync('/usr/bin/xcrun', [
        'swiftc',
        '-O',
        localPath('./native/VisionOCR.swift'),
        '-o',
        join(output, 'caselite-vision'),
      ]);
    },
    postPackage: async (_config, result) => {
      // 内部安装构建须绑定实际Bundle身份/资源，避免原Electron签名令Keychain加密失败。
      // 这只是本机adhoc签名；公开分发仍须独立Developer ID签名与公证验收。
      if (result.platform === 'darwin')
        for (const output of result.outputPaths) {
          const bundle = join(output, 'CaseLite.app');
          // 只清理刚生成的应用包元数据，不触及源码、用户资料或签名校验。
          execFileSync('/usr/bin/xattr', ['-cr', bundle]);
          execFileSync('/usr/bin/codesign', [
            '--force',
            '--deep',
            '--sign',
            '-',
            '--identifier',
            'com.caselite.desktop',
            bundle,
          ]);
          execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
        }
    },
  },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig: localPath('./webpack.main.config.mjs'),
      devContentSecurityPolicy:
        "default-src 'none'; script-src 'self'; worker-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
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
            name: 'pdf_worker',
            html: localPath('./src/renderer/pdf-worker.html'),
            js: localPath('./src/renderer/pdf-worker.ts'),
          },
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
