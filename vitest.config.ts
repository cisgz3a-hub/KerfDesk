import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { vitestMaxWorkers } from './src/__fixtures__/vitest-workers';

// Vitest config — extends vite.config so the test runner uses the same
// transform pipeline as the app. jsdom env lets us test DOMPurify and
// SVG parsing against the real DOM API.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      // Benign jsdom canvas 2D/WebGL context stub so real draw + 3D fallback
      // paths run without "Not implemented: getContext" noise (D-S08-002).
      setupFiles: ['src/__fixtures__/jsdom-canvas-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
      exclude: ['node_modules/**', 'dist/**', 'release/**'],
      // CI-only worker throttle (1 on CI, 4 locally). The rationale and the
      // CI-detection contract live in src/__fixtures__/vitest-workers.ts with a
      // co-located policy test (D-S02-003).
      maxWorkers: vitestMaxWorkers(process.env),
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'json'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/__fixtures__/**'],
      },
    },
  }),
);
