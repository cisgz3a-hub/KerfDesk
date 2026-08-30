import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = process.env['PLAYWRIGHT_PRODUCTION_PORT'] ?? '4173';
const baseURL = `http://127.0.0.1:${port}`;
const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));

// Observability-only production-bundle smoke. This configuration deliberately
// stays in the independent Browser smoke workflow and is never a deploy guard.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/production-bundle.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: workspaceRoot,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
