import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    globalSetup: ['tests/global-setup.ts'],
    env: {
      DATABASE_URL: 'file:' + path.resolve(__dirname, 'db/test.db'),
      PORT: '3000',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
