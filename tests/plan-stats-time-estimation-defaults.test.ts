/**
 * T1-166 (audit F-030): named-constant defaults for the
 * `calculatePlanStats` time-estimation parameters.
 *
 * Pre-T1-166:
 *  - `Plan.ts:175-176`: `maxAcceleration: number = 500`,
 *    `maxRapidSpeed: number = 6000` — inline magic numbers.
 *  - `PlanOptimizer.ts:141-142`: `config?.maxAcceleration ?? 500`,
 *    `config?.maxRapidSpeed ?? 6000` — same inline magic numbers,
 *    no link back to the Plan.ts defaults.
 *  - The 500 disagrees with `DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 = 1000`
 *    (jobCompilerHelpers.ts) which is the planner's typical-small-
 *    laser default for raster velocity-curve math. The audit
 *    (docs/AUDIT-2026-05-11.md F-030) noted that without a named
 *    constant + rationale, future edits would drift one of the two
 *    values without realizing they serve different purposes.
 *
 * Post-T1-166:
 *  1. `Plan.ts` exports `DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2 = 500`
 *     and `DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN = 6000`.
 *  2. `calculatePlanStats` uses the named constants as parameter
 *     defaults.
 *  3. `PlanOptimizer.optimizePlan` uses the named constants as fallback
 *     when `config.maxAcceleration` / `config.maxRapidSpeed` is missing.
 *  4. The constants carry a doc comment explaining why 500 differs from
 *     DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 (1000): time estimation favors
 *     a conservative-low acceleration so the prediction overestimates
 *     burn time slightly rather than under-promising.
 *
 * Behavior is unchanged — only the named-constant indirection is new.
 *
 * Run: npx tsx tests/plan-stats-time-estimation-defaults.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculatePlanStats,
  createEmptyPlan,
  DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2,
  DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN,
  type Plan,
} from '../src/core/plan/Plan';
import { DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 } from '../src/core/job/jobCompilerHelpers';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

console.log('\n=== T1-166 PlanOptimizer time-estimation named-constant defaults ===\n');

// -------- 1. Named constants are exported with the documented values --------
{
  assert(
    DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2 === 500,
    `DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2 === 500 (got ${DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2})`,
  );
  assert(
    DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN === 6000,
    `DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN === 6000 (got ${DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN})`,
  );
}

// -------- 2. The constants are intentionally distinct from DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 --------
{
  // This is the cross-file regression bait. If a future edit ever
  // makes them equal, the rationale (different purpose) needs to be
  // re-evaluated rather than silently following along.
  //
  // Both constants are typed as literal values (`as 500` / `as 1000`),
  // so a direct `!==` is statically true-narrowed and TS warns about
  // a "useless comparison". Widen to `number` at the read site so the
  // assertion remains a real runtime check (a future change of either
  // literal value would surface here).
  const planAccel: number = DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2;
  const rasterAccel: number = DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2;
  assert(
    planAccel !== rasterAccel,
    `time-estimation default (${planAccel}) is intentionally distinct from raster velocity-curve default (${rasterAccel})`,
  );
  assert(
    planAccel < rasterAccel,
    `time-estimation default is conservatively LOWER than raster velocity-curve default (overestimates burn time, the user-friendly direction)`,
  );
}

// -------- 3. calculatePlanStats uses the named constant as the default --------
{
  const plan: Plan = createEmptyPlan('T1-166-stats');
  plan.operations.push({
    operationId: 'op-1',
    layerName: 'L1',
    layerColor: '#aa00ff',
    passIndex: 0,
    moves: [
      { type: 'rapid', to: { x: 100, y: 0 } },
      { type: 'laserOn', power: 50 },
      { type: 'linear', to: { x: 200, y: 0 }, power: 50, speed: 1200 },
      { type: 'laserOff' },
    ],
  });

  const statsDefault = calculatePlanStats(plan);
  const statsExplicit = calculatePlanStats(plan, DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2, DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN);

  assert(
    Math.abs(statsDefault.estimatedTimeSeconds - statsExplicit.estimatedTimeSeconds) < 1e-9,
    'calculatePlanStats(plan) == calculatePlanStats(plan, DEFAULT_*, DEFAULT_*) — defaults wire to the named constants',
  );
  // Also assert against a known-different value to prove the constants
  // are actually doing the work (sanity).
  const statsWithFasterAccel = calculatePlanStats(plan, 5000, DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN);
  assert(
    statsWithFasterAccel.estimatedTimeSeconds < statsDefault.estimatedTimeSeconds,
    'higher acceleration → shorter estimated time (proves the parameter is wired through)',
  );
}

// -------- 4. Source pins on the named-constant refactor --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const planSrc = readFileSync(resolve(here, '../src/core/plan/Plan.ts'), 'utf-8');
  const optSrc = readFileSync(resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');

  assert(/T1-166/.test(planSrc), 'Plan.ts carries T1-166 marker');
  assert(/audit F-030/.test(planSrc), 'Plan.ts cross-references audit F-030');
  assert(/T1-166/.test(optSrc), 'PlanOptimizer.ts carries T1-166 marker');
  assert(/audit F-030/.test(optSrc), 'PlanOptimizer.ts cross-references audit F-030');

  // The named constants are exported.
  assert(
    /export const DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2\s*=\s*500/.test(planSrc),
    'Plan.ts exports DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2',
  );
  assert(
    /export const DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN\s*=\s*6000/.test(planSrc),
    'Plan.ts exports DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN',
  );

  // calculatePlanStats uses the named constants as parameter defaults.
  assert(
    /maxAcceleration: number = DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2/.test(planSrc),
    'calculatePlanStats uses DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2 as default',
  );
  assert(
    /maxRapidSpeed: number = DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN/.test(planSrc),
    'calculatePlanStats uses DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN as default',
  );

  // PlanOptimizer imports + uses the named constants.
  assert(
    /import\s*\{[\s\S]*?DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2[\s\S]*?DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN[\s\S]*?\}\s+from\s+['"]\.\/Plan['"]/.test(optSrc),
    'PlanOptimizer imports both named constants from Plan',
  );
  assert(
    /config\?\.maxAcceleration\s*\?\?\s*DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2/.test(optSrc),
    'PlanOptimizer.optimizePlan uses DEFAULT_PLAN_MAX_ACCELERATION_MM_PER_S2 as fallback',
  );
  assert(
    /config\?\.maxRapidSpeed\s*\?\?\s*DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN/.test(optSrc),
    'PlanOptimizer.optimizePlan uses DEFAULT_PLAN_MAX_RAPID_SPEED_MM_PER_MIN as fallback',
  );

  // The inline `?? 500` / `?? 6000` magic numbers must be gone from
  // PlanOptimizer.ts (the source the audit cited).
  assert(
    !/config\?\.maxAcceleration\s*\?\?\s*500\b/.test(optSrc),
    'PlanOptimizer.optimizePlan no longer uses inline `?? 500`',
  );
  assert(
    !/config\?\.maxRapidSpeed\s*\?\?\s*6000\b/.test(optSrc),
    'PlanOptimizer.optimizePlan no longer uses inline `?? 6000`',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
