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
      // The private-repo CI runner has only 2 vCPUs. Workers saturating both cores during
      // a heavy synchronous burst starve vitest's main orchestrator, which then misses a
      // worker RPC ack and fails the whole run with `[vitest-worker]: Timeout calling
      // "onTaskUpdate"` even though every test passes. Measured on this runner: 4 workers
      // -> two such errors, 2 workers -> one. Use 1 on CI so a full core stays free for the
      // orchestrator; dev boxes (more cores) keep 4. Matches the CI-only budget approach
      // in ci-budget.ts. (No test correctness gate is affected -- this is a parallelism knob.)
      maxWorkers: process.env.CI ? 1 : 4,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/__fixtures__/**'],
      },
    },
  }),
);
