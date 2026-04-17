/**
 * Run each test file in its own Node process. Prevents leaked timers/intervals
 * (e.g. GRBL status polling) from keeping `npm test` running indefinitely.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(root, '..');
const tsxCli = join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const files = [
  'pipeline.test.ts',
  'plan-optimizer-large-raster.test.ts',
  'controller.test.ts',
  'simulation.test.ts',
  'viewport.test.ts',
  'svg-import.test.ts',
  'svg-import-placement.test.ts',
  'placement.test.ts',
  'history.test.ts',
  'scene-io.test.ts',
  'ui-integration.test.ts',
  'autosave-serialization.test.ts',
  'text-outline-cache.test.ts',
  'source-text-migration.test.ts',
  'preflight-bounds.test.ts',
  'preflight.test.ts',
  'controller-stop-safety.test.ts',
  'materials.test.ts',
  'image-processing.test.ts',
  'operation-ordering.test.ts',
  'test-grid-generator.test.ts',
  'velocity-profile.test.ts',
  'scanning-offset.test.ts',
  'smart-overscan.test.ts',
  'gcode-templates.test.ts',
  'e2e/rectangle-cut.test.ts',
];

for (const f of files) {
  // stderr so it appears even when stdout is fully buffered
  console.error(`\n▶ ${f}\n`);
  const r = spawnSync(process.execPath, [tsxCli, join(projectRoot, 'tests', f)], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  const code = r.status === null ? 1 : r.status;
  if (code !== 0) {
    process.exit(code);
  }
}

process.exit(0);
