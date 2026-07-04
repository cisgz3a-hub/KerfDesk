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
      maxWorkers: 4,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/__fixtures__/**'],
      },
    },
  }),
);
