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
  'controller-fresh-status-recheck.test.ts',
  'controller-bounds-recheck.test.ts',
  'simulation.test.ts',
  'viewport.test.ts',
  'wake-lock.test.ts',
  'svg-import.test.ts',
  'svg-import-placement.test.ts',
  'placement.test.ts',
  'history.test.ts',
  'job-log-quota.test.ts',
  'joblog-storage-migration.test.ts',
  'jobreplay-storage-migration.test.ts',
  'scene-io.test.ts',
  'ui-integration.test.ts',
  'autosave-serialization.test.ts',
  'autosave-storage.test.ts',
  'autosave-preserves-images.test.ts',
  'text-outline-cache.test.ts',
  'source-text-migration.test.ts',
  'preflight-bounds.test.ts',
  'preflight-negative-coords.test.ts',
  'gcode-template-validator.test.ts',
  'preflight-template-validation.test.ts',
  'storage-adapter-contract.test.ts',
  'storage-filesystem-unit.test.ts',
  'storage-singleton.test.ts',
  'entitlement-storage-migration.test.ts',
  'execution-coordinator.test.ts',
  'execution-coordinator-unlock-home-frame.test.ts',
  'execution-coordinator-testfire-setorigin.test.ts',
  'execution-coordinator-autofocus.test.ts',
  'execution-coordinator-disconnect.test.ts',
  'device-profile-storage-migration.test.ts',
  'device-profile-basic-api.test.ts',
  'validated-job-ticket-phase1.test.ts',
  'validated-job-ticket-mismatch.test.ts',
  'jobcompiler-strips-pro-settings-without-license.test.ts',
  'jobcompiler-keeps-pro-settings-with-license.test.ts',
  'nesting-throws-without-license.test.ts',
  'boolean-ops-throws-without-license.test.ts',
  'service-layer-pro-gate-coverage.test.ts',
  'preflight.test.ts',
  'raster-m4-no-software-splitting.test.ts',
  'job-compiler-curve-flatness.test.ts',
  'controller-stop-safety.test.ts',
  'stop-on-error-override.test.ts',
  'machine-settings-stop-on-error-toggle.test.ts',
  'autofocus.test.ts',
  'machine-service-pause-resume.test.ts',
  'machine-service-start-validated-job.test.ts',
  'machine-service-job-lifecycle-safety.test.ts',
  'start-validated-job-passes-context.test.ts',
  'active-job-canvas-context-pinned.test.ts',
  'active-job-canvas-context-cleared.test.ts',
  'try-finalize-respects-observed-running.test.ts',
  'try-finalize-after-observed-running.test.ts',
  'start-validated-job-then-immediately-tryfinalize.test.ts',
  'wcs-mutation-consent.test.ts',
  'modal-confirm-with-checkbox.test.tsx',
  'ui-start-job-uses-ticket.test.tsx',
  'numberinput-no-loop-on-rapid-prop-change.test.tsx',
  'numberinput-tolerance-still-works.test.tsx',
  'numberinput-focused-not-overridden.test.tsx',
  'falcon-serial-profile.test.ts',
  'falcon-autofocus-heal.test.ts',
  'material-preset-schema.test.ts',
  'material-library-storage.test.ts',
  'material-presets-storage.test.ts',
  'material-feedback-storage.test.ts',
  'streaming-health.test.ts',
  'grbl-system-line-tagging.test.ts',
  'command-classifier.test.ts',
  'machine-service-user-sendcommand.test.ts',
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
  'plan-accel-sanity.test.ts',
  'scene-canvas-machine-coord-check.test.ts',
  'no-localstorage-in-core.test.ts',
  'no-gcode-in-ui.test.ts',
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
  'frame-gcode-pure.test.ts',

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
