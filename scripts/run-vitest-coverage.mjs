import { spawn } from 'node:child_process';

const args = [
  'node_modules/vitest/vitest.mjs',
  'run',
  '--coverage',
  '--testTimeout=300000',
  '--coverage.reporter=text',
  '--coverage.reporter=json-summary',
  '--coverage.reporter=html',
  // Wall-clock/perceptual suites remain in the ordinary release test lane.
  // Instrumenting them changes the performance question they assert and can
  // starve Vitest's worker heartbeat; omitting them here does not exclude their
  // production source from coverage accounting.
  '--exclude=node_modules/**',
  '--exclude=dist/**',
  '--exclude=release/**',
  '--exclude=src/__fixtures__/perceptual/**',
  '--exclude=src/__fixtures__/performance/**',
  '--exclude=src/core/camera/calibrate-sweep.test.ts',
  '--exclude=src/core/camera/detect-checkerboard.test.ts',
  // This analytic depth reference passes in the ordinary suite, but its single
  // 120 s compute task starves Vitest's coverage-worker task-update RPC after
  // the assertion completes. Other CNC tests still instrument the same source.
  '--exclude=src/core/cnc/vcarve-floor-depth.test.ts',
  '--exclude=src/core/cnc/vcarve-thin-perceptual.test.ts',
  // Windows invokes this Bash syntax probe through WSL. Its cold start is
  // already covered by the ordinary suite and can exceed its process timeout
  // while the instrumented worker pool is saturated.
  '--exclude=src/platform/electron/release-desktop-preview-shell.test.ts',
  '--exclude=src/ui/laser/start-frame-raster-budget.test.tsx',
];

const child = spawn(process.execPath, args, {
  env: { ...process.env, KERFDESK_COVERAGE: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

child.once('error', (error) => {
  console.error(`[coverage] could not launch Vitest: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`[coverage] Vitest ended from signal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
