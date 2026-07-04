import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Vitest config — extends vite.config so the test runner uses the same
// transform pipeline as the app. jsdom env lets us test DOMPurify and
// SVG parsing against the real DOM API.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
      exclude: ['node_modules/**', 'dist/**', 'release/**'],
      // Camera calibration and perceptual perf tests are CPU-heavy; keep enough
      // headroom that wall-clock assertions measure regressions, not worker contention.
      // The private-repo CI runner has only 2 vCPUs, so 4 workers oversubscribe it and
      // starve vitest's main orchestrator process -- it then misses a worker's RPC ack
      // and fails the whole run with `[vitest-worker]: Timeout calling "onTaskUpdate"`
      // even though every test passed. Cap to 2 on CI to leave the orchestrator CPU;
      // dev boxes (more cores) keep 4. Matches the CI-only budget approach in ci-budget.ts.
      maxWorkers: process.env.CI ? 2 : 4,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/__fixtures__/**'],
      },
    },
  }),
);
