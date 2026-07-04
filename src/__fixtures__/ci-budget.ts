// Test-only wall-clock budget helper. The shared CI runner is ~2-4x slower than
// a dev box (measured: a centerline trace that runs ~4s locally takes ~9s on CI;
// a calibration that runs ~15s locally blew a 60s timeout under CI load). Perf
// budgets and per-test timeouts calibrated to a fast local machine therefore
// flake on CI — runner speed, not a real regression, fails the build and blocks
// the CI-gated auto-deploy.
//
// This returns the generous `ciMs` on a CI runner and the tight `localMs`
// otherwise, so a genuine regression (which is MULTIPLES slower, not ~2x) still
// trips the CI ceiling while ordinary runner slowness does not.
//
// It lives under src/__fixtures__/ (not src/core/) deliberately: core test files
// cannot reference `process` — eslint's no-restricted-globals bans it for
// src/core/** (eslint.config.mjs) — so the CI probe is centralised here and the
// core camera tests import a plain number. GitHub Actions (ci.yml) and virtually
// every CI provider set CI to a non-empty string; it is unset on a dev box.

function isCi(): boolean {
  // Read per call rather than caching at import, so the result cannot depend on
  // module load order and stays unit-testable by toggling process.env.CI.
  const flag = process.env.CI;
  return flag != null && flag !== '';
}

/**
 * Pick a wall-clock budget in milliseconds: the tight `localMs` on a dev box, the
 * generous `ciMs` on a CI runner. Use for vitest per-test `{ timeout }` options
 * and perf-regression budgets that must not flake on slow shared CI runners.
 */
export function ciBudgetMs(localMs: number, ciMs: number): number {
  return isCi() ? ciMs : localMs;
}
