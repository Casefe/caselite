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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: false,
  },
});
