// Test-runner worker-count policy, extracted from vitest.config.ts (D-S02-003)
// so the CI-only throttle is unit-testable.
//
// The private-repo CI runner has only 2 vCPUs. Workers saturating both cores
// during a heavy synchronous burst starve vitest's main orchestrator, which then
// misses a worker RPC ack and fails the whole run with `[vitest-worker]: Timeout
// calling "onTaskUpdate"` even though every test passes. Measured on this runner:
// 4 workers -> two such errors, 2 workers -> one. Use 1 on CI so a full core
// stays free for the orchestrator; dev boxes (more cores) keep 4. This is a
// parallelism knob only — no test correctness gate depends on it.

const CI_MAX_WORKERS = 1;
const LOCAL_MAX_WORKERS = 4;

/**
 * Pick the vitest `maxWorkers` count: 1 on a CI runner (leave a core free for the
 * orchestrator), 4 locally. GitHub Actions and virtually every CI provider set
 * `CI` to a non-empty string; it is unset on a dev box. An empty `CI` (some
 * shells export `CI=""`) counts as local.
 */
export function vitestMaxWorkers(env: NodeJS.ProcessEnv): number {
  const flag = env.CI;
  const isCi = flag != null && flag !== '';
  return isCi ? CI_MAX_WORKERS : LOCAL_MAX_WORKERS;
}
