import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const localPath = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@caselite/application': localPath('./packages/application/src/index.ts'),
      '@caselite/contracts': localPath('./packages/contracts/src/index.ts'),
    },
  },
  test: {
    // CI 为文件扫描和 Chrome 初始化留出资源，保留每条测试的原始预算。
    maxWorkers: process.env.CI === 'true' ? 2 : undefined,
    coverage: {
      provider: 'v8',
      include: ['apps/desktop/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/*.{test,spec}.{ts,tsx}'],
      reporter: ['text', 'json-summary'],
    },
    include: [
      'tests/**/*.{test,spec}.{ts,tsx}',
      'apps/**/src/**/*.{test,spec}.{ts,tsx}',
      'packages/**/src/**/*.{test,spec}.{ts,tsx}',
    ],
    passWithNoTests: false,
  },
});
