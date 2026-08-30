import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PRODUCTION_PORT = process.env['PLAYWRIGHT_PRODUCTION_PORT'] ?? '4173';
const PRODUCTION_BASE_URL = `http://127.0.0.1:${PRODUCTION_PORT}`;
const WORKSPACE_ROOT = fileURLToPath(new URL('.', import.meta.url));

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
    baseURL: PRODUCTION_BASE_URL,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${PRODUCTION_PORT} --strictPort`,
    cwd: WORKSPACE_ROOT,
    url: PRODUCTION_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
