/**
 * T1-179 (external audit High #7): tab gaps inside a cut path must
 * traverse with G1 (linear feed at cut speed, laser off), NOT G0
 * (rapid).
 *
 * Pre-T1-179 evidence (PlanOptimizer.ts:517-522):
 *
 *   if (inTab) {
 *     if (laserIsOn) {
 *       moves.push({ type: 'laserOff' });
 *       laserIsOn = false;
 *     }
 *     moves.push({ type: 'rapid', to: { x: px, y: py } });  // <-- G0
 *   }
 *
 * The audit flagged this as High severity: rapid motion across a tab
 * gap while the head is mechanically engaged at cutting height can
 * jerk, lose steps, or produce inaccurate restart points. On a
 * step-loss event, the next burn point shifts and the cut becomes
 * inaccurate.
 *
 * Post-T1-179: the tab traversal emits `{ type: 'linear', power: 0,
 * speed }` — G1 at the cut feed with the laser off. Motion stays
 * kinematically consistent with the surrounding burn (same
 * acceleration envelope, same feed budget, no rapid-vs-cut jerk).
 *
 * Run: npx tsx tests/tab-gap-uses-feed-not-rapid.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import {
  createEmptyJob,
  flatPathFromPoints,
  type Operation,
  type ResolvedLaserSettings,
} from '../src/core/job/Job';

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

const here = dirname(fileURLToPath(import.meta.url));

function cutSettings(overrides: Partial<ResolvedLaserSettings> = {}): ResolvedLaserSettings {
  return {
    powerMin: 0,
    powerMax: 80,
    speed: 1200,
    passes: 1,
    zStepPerPass: 0,
    fillInterval: 0,
    fillAngle: 0,
    fillMode: 'line',
    fillBiDirectional: false,
    overscanning: 0,
    overcut: 0,
    leadIn: 0,
    tabCount: 2,    // <-- TABS ENABLED
    tabWidth: 2,
    insideFirst: false,
    airAssist: false,
    accelAwarePower: false,
    maxAccelMmPerS2: 500,
    minPowerRatioAccel: 0.2,
    scanningOffsets: [],
    ...overrides,
  };
}

function squareCutWithTabs(): Operation {
  // 40 mm × 40 mm closed square — well-sized for tab placement.
  const path = flatPathFromPoints(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 0 },
    ],
    true,
    'tab-square',
  );
  return {
    id: 'op-tabs',
    layerId: 'L-cut',
    layerName: 'Cut with tabs',
    layerColor: '#000000',
    order: 0,
    type: 'cut',
    settings: cutSettings(),
    geometry: { type: 'vector', paths: [path] },
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
  } as unknown as Operation;
}

console.log('\n=== T1-179 tab gaps use G1 feed (laser off), not G0 rapid (audit High #7) ===\n');

// -------- 1. Run optimizePlan with tabs and inspect moves --------
{
  const job = createEmptyJob('T1-179-tabs', 'test-project');
  job.operations = [squareCutWithTabs()];
  job.bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
  const plan = optimizePlan(job);
  assert(plan.operations.length === 1, 'one planned operation');

  const moves = plan.operations[0].moves;

  // Count operation-level move types AFTER the initial rapid-to-start
  // and AFTER the first laserOn. We want to inspect the "inside the
  // path traversal" portion specifically.
  const firstLaserOnIdx = moves.findIndex(m => m.type === 'laserOn');
  assert(firstLaserOnIdx >= 0, 'plan emits at least one laserOn (start of cut)');

  // Slice from the first laserOn to the end. Everything in this slice
  // is "inside the path traversal."
  const insidePath = moves.slice(firstLaserOnIdx);

  // Expectations:
  // - At LEAST one `laserOff` modal command (one per tab → 2 expected,
  //   the second on tab exit may or may not fire depending on path
  //   ordering — assert >= 1).
  // - laser-off + tab traversal pairs: each `laserOff` should be
  //   followed by a `linear` with power=0 at the cut speed.
  // - NO `rapid` moves inside the path traversal (rapids belong only
  //   to inter-operation transitions, not intra-path tabs).
  const insideRapids = insidePath.filter(m => m.type === 'rapid');
  assert(
    insideRapids.length === 0,
    `CRITICAL INVARIANT (audit High #7): no G0 rapids inside the cut path traversal (got ${insideRapids.length})`,
  );

  // Find the laser-off → S0-linear pairs.
  let laserOffCount = 0;
  let tabTraversalLinears = 0;
  for (let i = 0; i < insidePath.length; i++) {
    const m = insidePath[i];
    if (m.type === 'laserOff') {
      laserOffCount++;
      // The next motion move should be a `linear` with power=0.
      // Skip non-motion moves (markers, etc.) until we find a motion.
      for (let j = i + 1; j < insidePath.length; j++) {
        const next = insidePath[j];
        if (next.type === 'rapid') {
          assert(false, `laserOff at index ${i} followed by a rapid (G0) — should be linear S0`);
          break;
        }
        if (next.type === 'linear') {
          assert(
            next.power === 0,
            `laserOff → linear move has power=0 (got power=${next.power})`,
          );
          assert(
            next.speed === 1200,
            `laserOff → linear move uses the cut feed (1200 mm/min, got ${next.speed})`,
          );
          tabTraversalLinears++;
          break;
        }
      }
    }
  }
  assert(laserOffCount >= 1, `at least one laserOff inside the path traversal (got ${laserOffCount}) — tabs are active`);
  assert(
    tabTraversalLinears >= 1,
    `each tab traversal uses a linear S0 move (got ${tabTraversalLinears})`,
  );
}

// -------- 2. tabCount=0: no tab moves (regression bait) --------
{
  const job = createEmptyJob('T1-179-no-tabs', 'test-project');
  const op = squareCutWithTabs();
  op.settings = { ...op.settings, tabCount: 0, tabWidth: 0 };
  job.operations = [op];
  job.bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
  const plan = optimizePlan(job);
  const moves = plan.operations[0].moves;
  const firstLaserOnIdx = moves.findIndex(m => m.type === 'laserOn');
  const insidePath = moves.slice(firstLaserOnIdx);
  const laserOffsInside = insidePath.filter(m => m.type === 'laserOff');
  // Without tabs, the only `laserOff` is the trailing one at the end
  // of the path (after the final segment).
  assert(
    laserOffsInside.length === 1,
    `tabCount=0: exactly 1 laserOff (the trailing one) — got ${laserOffsInside.length}`,
  );
}

// -------- 3. Source pins on the implementation --------
{
  const src = readFileSync(resolve(here, '../src/core/plan/PlanOptimizer.ts'), 'utf-8');

  assert(/T1-179/.test(src), 'PlanOptimizer carries T1-179 marker');
  assert(
    /audit High #7/.test(src),
    'PlanOptimizer cross-references audit High #7',
  );

  // The pre-T1-179 line `moves.push({ type: 'rapid', to: { x: px, y: py } })`
  // inside the `inTab` branch must be gone. We anchor on the
  // distinctive variable names (`px`, `py`) from the tab loop to make
  // the regex specific to this branch (not the path-start rapid).
  const oldTabRapidPattern = /inTab\)[\s\S]{0,300}moves\.push\(\{\s*type:\s*['"]rapid['"][\s\S]{0,100}x:\s*px/;
  assert(
    !oldTabRapidPattern.test(src),
    'pre-T1-179 `moves.push({ type: rapid, to: { x: px, y: py } })` inside the inTab branch is GONE',
  );

  // The new `linear` with `power: 0, speed` must be present in the
  // `inTab` branch. Widen the range to 2000 chars because the T1-179
  // comment block sits between `if (inTab) {` and the moves.push line.
  const newTabLinearPattern = /if \(inTab\) \{[\s\S]{0,2000}moves\.push\(\{\s*type:\s*['"]linear['"][\s\S]{0,200}power:\s*0[\s\S]{0,50}speed/;
  assert(
    newTabLinearPattern.test(src),
    'new tab traversal emits `linear` with `power: 0, speed` (G1 S0 at cut feed)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
