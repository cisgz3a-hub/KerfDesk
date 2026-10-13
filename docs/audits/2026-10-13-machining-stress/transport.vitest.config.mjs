import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../../vitest.config';

const manifest = JSON.parse(readFileSync(new URL('./transport-manifest.json', import.meta.url)));
const config = mergeConfig(baseConfig, {
  test: {
    setupFiles: ['docs/audits/2026-10-13-machining-stress/transport-seed-setup.mjs'],
  },
});
// Replace rather than concatenate include patterns, keeping this cohort bounded.
config.test.include = manifest.files;
export default defineConfig(config);
