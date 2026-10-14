import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const webServer = base.webServer;
if (webServer === undefined || Array.isArray(webServer)) {
  throw new Error('The audit expects the repository to define one development server.');
}

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: ['interaction.e2e.ts'],
  timeout: 120_000,
  workers: 1,
  use: { ...base.use, trace: 'off' },
  webServer: { ...webServer, reuseExistingServer: false },
});
