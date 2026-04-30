/**
 * T1-98: Frame idle timeout — dynamic estimator math equivalence.
 *
 * Run: npx tsx tests/frame-idle-timeout-dynamic.test.ts
 */
import { estimateFrameIdleTimeoutMs, FRAME_IDLE_TIMEOUT_MS } from '../src/app/grblIdlePoll';

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

console.log('\n=== T1-98 frame idle timeout dynamic estimator ===\n');

// 1. Empty / single-point edge cases.
{
  assert(
    estimateFrameIdleTimeoutMs([]) === 30_000 &&
      estimateFrameIdleTimeoutMs([{ x: 0, y: 0 }]) === 30_000,
    'empty and single-corner paths → 30_000 floor',
  );
}

// 2. Tiny path below floor.
{
  const tiny = [
    { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 },
  ];
  assert(estimateFrameIdleTimeoutMs(tiny) === 30_000, '5x5 mm closed frame → 30_000 floor');
}

// 3. 100x80 design closed rectangular frame (~360mm travel).
{
  const corners = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }, { x: 0, y: 0 },
  ];
  const t = estimateFrameIdleTimeoutMs(corners);
  assert(t === 30_000, `100x80 frame → 30_000 floor wins (got ${t})`);
}

// 4. 200x240 design — the 6-box reproduction case.
{
  const corners = [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 240 }, { x: 0, y: 240 }, { x: 0, y: 0 },
  ];
  const t = estimateFrameIdleTimeoutMs(corners);
  assert(t > 35_000 && t < 50_000, `200x240 frame → above floor, ~40s window (got ${t})`);
}

// 5. The old 15s constant would have been too small for the 200x240 case.
{
  const corners = [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 240 }, { x: 0, y: 240 }, { x: 0, y: 0 },
  ];
  const t = estimateFrameIdleTimeoutMs(corners);
  assert(t > 15_000,
    `dynamic estimate for 200x240 (${t}ms) is greater than the old 15s constant`);
}

// 6. Default constant is now 60_000.
{
  assert(FRAME_IDLE_TIMEOUT_MS === 60_000,
    `FRAME_IDLE_TIMEOUT_MS = 60_000 (was 15_000 pre-T1-98)`);
}

// 7. Monotonicity: bigger frame → bigger estimate above floor.
{
  const small = [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 240 }, { x: 0, y: 240 }, { x: 0, y: 0 },
  ];
  const big = [
    { x: 0, y: 0 }, { x: 358, y: 0 }, { x: 358, y: 268 }, { x: 0, y: 268 }, { x: 0, y: 0 },
  ];
  const tSmall = estimateFrameIdleTimeoutMs(small);
  const tBig = estimateFrameIdleTimeoutMs(big);
  assert(tBig > tSmall, `Falcon A1 Pro full-bed (${tBig}ms) > 200x240 (${tSmall}ms)`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
