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

const testEnv = {
  ...process.env,
  LASERFORGE_DETERMINISTIC_IDS: '1',
};

const files = [
  'deterministic-ids.test.ts',
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
  'job-compiler-curve-flatness.test.ts',
  'controller-stop-safety.test.ts',
  'autofocus.test.ts',
  'machine-service-pause-resume.test.ts',
  'wcs-mutation-consent.test.ts',
  'modal-confirm-with-checkbox.test.tsx',
  'falcon-serial-profile.test.ts',
  'falcon-autofocus-heal.test.ts',
  'material-preset-schema.test.ts',
  'streaming-health.test.ts',
  'grbl-system-line-tagging.test.ts',
  'plan-marker-emission.test.ts',
  'output-marker-encoding.test.ts',
  'grbl-marker-lifecycle.test.ts',
  'materials.test.ts',
  'response-curve.test.ts',
  'calibration-grid.test.ts',
  'calibrate-dialog.test.ts',
  'calibration-analyzer.test.ts',
  'raster-with-curve.test.ts',
  'image-processing.test.ts',
  'operation-ordering.test.ts',
  'test-grid-generator.test.ts',
  'velocity-profile.test.ts',
  'burn-moves-2d.test.ts',
  'scanning-offset.test.ts',
  'smart-overscan.test.ts',
  'gcode-templates.test.ts',
  'gcode-templates-safety.test.ts',
  'gcode-relative-mode.test.ts',
  'ui-start-job-preserves-markers.test.ts',
  'gcode-relative-return-template.test.ts',
  'origin-mode-wcs-zero.test.ts',
  'bed-height-resolver-parity.test.ts',
  'fonts.test.ts',

  // E2E snapshot tests
  'e2e/rectangle-cut.test.ts',
  'e2e/text-bundled-inter.test.ts',
  'e2e/text-hershey-sans.test.ts',
  'e2e/engrave-fill.test.ts',
  'e2e/score-line.test.ts',
  'e2e/mixed-scene.test.ts',
  'e2e/origin-absolute.test.ts',
  'e2e/origin-saved.test.ts',
  'e2e/circle-cut.test.ts',
  'e2e/multi-pass-cut.test.ts',
  'e2e/large-scene.test.ts',
];

for (const f of files) {
  // stderr so it appears even when stdout is fully buffered
  console.error(`\n▶ ${f}\n`);
  const r = spawnSync(process.execPath, [tsxCli, join(projectRoot, 'tests', f)], {
    cwd: projectRoot,
    env: testEnv,
    stdio: 'inherit',
    windowsHide: true,
  });
  const code = r.status === null ? 1 : r.status;
  if (code !== 0) {
    process.exit(code);
  }
}

process.exit(0);
