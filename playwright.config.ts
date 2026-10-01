import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = process.env.PLAYWRIGHT_PORT ?? '5173';
const baseURL = `http://127.0.0.1:${port}`;
const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));
const coldDependencyCache = process.env['PLAYWRIGHT_COLD_CACHE'] === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/*.e2e.ts', '**/*.spec.ts'],
  testIgnore: ['**/production-bundle.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // This suite exercises the complete desktop renderer's tools without native
    // packaging. Use desktop mode so real browser behavior (including recovery
    // BroadcastChannels) stays enabled; test mode suppresses Node unit-test channels.
    // The shipped browser edition is tested from dist/web separately.
    command: `pnpm exec vite . --mode desktop --host 127.0.0.1 --port ${port} --strictPort${coldDependencyCache ? ' --force' : ''}`,
    cwd: workspaceRoot,
    url: baseURL,
    reuseExistingServer: coldDependencyCache ? false : !process.env.CI,
    timeout: 120_000,
  },
});
