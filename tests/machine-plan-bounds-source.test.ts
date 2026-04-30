/**
 * T1-100: machinePlanBounds source resolution.
 *
 * Run: npx tsx tests/machine-plan-bounds-source.test.ts
 */
export {};

interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Pure version of the resolution rule used in App.tsx machinePlanBounds prop. */
function resolveMachinePlanBounds(args: {
  activeJobTransform: { plan: { bounds: AABB } } | null;
  gcodeStale: boolean;
  currentGcode: string | null;
  lastResult: { machinePlanBounds: AABB } | null;
}): AABB | null {
  const { activeJobTransform, gcodeStale, currentGcode, lastResult } = args;
  return (
    activeJobTransform?.plan.bounds
    ?? (!gcodeStale && currentGcode && lastResult ? lastResult.machinePlanBounds : null)
  );
}

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== T1-100 machinePlanBounds source resolution ===\n');

const aabbCompile: AABB = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
const aabbActive: AABB = { minX: 5, minY: 5, maxX: 105, maxY: 85 };

// 1. Pre-Start phase, no compile yet -> null.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: null,
    gcodeStale: false,
    currentGcode: null,
    lastResult: null,
  });
  assert(r === null, 'no compile yet -> null');
}

// 2. Pre-Start phase, fresh compile -> use lastResult.machinePlanBounds.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: null,
    gcodeStale: false,
    currentGcode: 'G21\nG90\n...',
    lastResult: { machinePlanBounds: aabbCompile },
  });
  assert(r === aabbCompile, 'pre-Start + fresh compile -> lastResult.machinePlanBounds');
}

// 3. Pre-Start phase, stale compile -> null.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: null,
    gcodeStale: true,
    currentGcode: 'G21\nG90\n...',
    lastResult: { machinePlanBounds: aabbCompile },
  });
  assert(r === null, 'pre-Start + stale compile -> null');
}

// 4. Pre-Start phase, no current gcode but lastResult lingering -> null.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: null,
    gcodeStale: false,
    currentGcode: null,
    lastResult: { machinePlanBounds: aabbCompile },
  });
  assert(r === null, 'pre-Start + no current gcode -> null');
}

// 5. Job running -> activeJobTransform wins.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: { plan: { bounds: aabbActive } },
    gcodeStale: false,
    currentGcode: 'G21\nG90\n...',
    lastResult: { machinePlanBounds: aabbCompile },
  });
  assert(r === aabbActive, 'job running -> activeJobTransform.plan.bounds wins');
}

// 6. Job running, no fresh compile context -> still uses activeJobTransform.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: { plan: { bounds: aabbActive } },
    gcodeStale: true,
    currentGcode: null,
    lastResult: null,
  });
  assert(r === aabbActive, 'job running + no compile context -> activeJobTransform still wins');
}

// 7. Job running, stale flag set -> activeJobTransform still wins.
{
  const r = resolveMachinePlanBounds({
    activeJobTransform: { plan: { bounds: aabbActive } },
    gcodeStale: true,
    currentGcode: 'G21\nG90\n...',
    lastResult: { machinePlanBounds: aabbCompile },
  });
  assert(r === aabbActive, 'job running + stale flag set -> activeJobTransform still wins');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
