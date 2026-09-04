import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Tests import the workspace packages by name but resolve to source, so a run
 * never silently tests a stale `dist`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@diagram-plus/core/browser': path.resolve(__dirname, 'packages/core/src/browser.ts'),
      '@diagram-plus/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@diagram-plus/mcp/bin': path.resolve(__dirname, 'packages/mcp/src/bin.ts'),
      '@diagram-plus/server': path.resolve(__dirname, 'packages/server/src/index.ts'),
      '@diagram-plus/mcp': path.resolve(__dirname, 'packages/mcp/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
