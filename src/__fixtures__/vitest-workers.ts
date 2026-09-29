// Test-runner worker-count policy, extracted from vitest.config.ts (D-S02-003)
// so the CI-only throttle is unit-testable.
//
// On a 2-vCPU CI runner, workers saturating both cores during a heavy
// synchronous burst starve vitest's main orchestrator, which then misses a
// worker RPC ack and fails the whole run with `[vitest-worker]: Timeout calling
// "onTaskUpdate"` even though every test passes. Measured on the private-repo
// runner: 4 workers -> two such errors, 2 workers -> one. So CI uses half the
// runner's cores: 1 worker on a 2-vCPU runner, which keeps a full core free for
// the orchestrator, and 2 on the 4-vCPU runners GitHub gives public
// repositories, which keeps two free for the orchestrator and V8's background
// threads, so timing-sensitive tests see about the load they see alone. Dev
// boxes (more cores) keep 4. This is a parallelism knob only — no test
// correctness gate depends on it.

import { availableParallelism } from 'node:os';

const LOCAL_MAX_WORKERS = 4;

/**
 * Pick the vitest `maxWorkers` count: half the cores on a CI runner (at least
 * 1), 4 locally. GitHub Actions and virtually every CI provider set `CI` to a
 * non-empty string; it is unset on a dev box. An empty `CI` (some shells export
 * `CI=""`) counts as local.
 */
export function vitestMaxWorkers(
  env: NodeJS.ProcessEnv,
  cores: number = availableParallelism(),
): number {
  const flag = env.CI;
  const isCi = flag != null && flag !== '';
  return isCi ? Math.max(1, Math.floor(cores / 2)) : LOCAL_MAX_WORKERS;
}
