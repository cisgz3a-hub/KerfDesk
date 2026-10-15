import { defineConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

// Keep the app's transform/setup environment, but replace (not concatenate)
// its normal test includes so this audit cannot launch the complete suite.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['scripts/performance-audit/worker-scheduling.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
