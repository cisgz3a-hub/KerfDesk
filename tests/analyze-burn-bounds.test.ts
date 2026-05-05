/**
 * T2-19: pin contracts on the burn-bounds analyzer test helper.
 * Built on top of T2-18's parser; tests use these derivations to
 * verify "the job burns within rectangle X×Y", "frame and burn
 * cover the same area", "no surprise overscan outside the declared
 * region", and similar contracts impossible to express via string
 * matching.
 *
 * Run: npx tsx tests/analyze-burn-bounds.test.ts
 */
import { parseGcode } from './helpers/parseGcode';
import { analyzeBurnBounds } from './helpers/analyzeBurnBounds';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-19 analyzeBurnBounds helper ===\n');

void (async () => {

// 1. Simple burn: G0 to start, M4 S500, G1 to (10, 0), M5
{
  const gcode = [
    'G21', 'G90',
    'G0 X0 Y0',
    'M4 S500',
    'G1 X10 Y0 F1000',
    'M5 S0',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.burnSegments.length === 1, `simple burn: 1 burn segment (got ${a.burnSegments.length})`);
  assert(a.burnSegments[0].power === 500, `simple burn: power=500 (got ${a.burnSegments[0].power})`);
  assert(a.burnSegments[0].feed === 1000, `simple burn: feed=1000 (got ${a.burnSegments[0].feed})`);
  assert(a.burnBounds.minX === 0 && a.burnBounds.maxX === 10,
    `simple burn: burnBounds X = [0,10] (got [${a.burnBounds.minX},${a.burnBounds.maxX}])`);
  assert(a.totalDistanceBurn === 10, `simple burn: totalDistanceBurn = 10 (got ${a.totalDistanceBurn})`);
  assert(a.totalDistanceRapid === 0, `simple burn: totalDistanceRapid = 0 (got ${a.totalDistanceRapid})`);
  assert(Math.abs(a.laserOnTime - (10 / 1000) * 60) < 1e-6,
    `simple burn: laserOnTime = (10mm / 1000 mm/min) * 60s = 0.6s (got ${a.laserOnTime})`);
  assert(a.midJobLaserOff.length === 0,
    `simple burn: no mid-job laser-off events (got ${a.midJobLaserOff.length})`);
}

// 2. Burn + rapid: separate bounds
{
  const gcode = [
    'G21', 'G90',
    'G0 X0 Y0',
    'M4 S500',
    'G1 X10 Y0 F1000',
    'M5',
    'G0 X100 Y100',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.burnBounds.maxX === 10 && a.burnBounds.maxY === 0,
    `burn vs rapid: burnBounds maxes at the burn segment only`);
  assert(a.rapidBounds.maxX === 100 && a.rapidBounds.maxY === 100,
    `burn vs rapid: rapidBounds includes the post-burn rapid`);
  assert(a.totalBounds.maxX === 100 && a.totalBounds.maxY === 100,
    `burn vs rapid: totalBounds covers everything`);
}

// 3. Multi-segment burn — distance and time accumulate
{
  const gcode = [
    'G21', 'G90',
    'G0 X0 Y0',
    'M4 S400',
    'G1 X10 Y0 F1200',
    'G1 X10 Y10',
    'G1 X0 Y10',
    'G1 X0 Y0',
    'M5',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.burnSegments.length === 4,
    `square burn: 4 burn segments (got ${a.burnSegments.length})`);
  assert(a.totalDistanceBurn === 40,
    `square burn: distance = 4 × 10mm = 40mm (got ${a.totalDistanceBurn})`);
  assert(a.burnBounds.minX === 0 && a.burnBounds.maxX === 10 && a.burnBounds.minY === 0 && a.burnBounds.maxY === 10,
    `square burn: burnBounds = [0..10, 0..10]`);
}

// 4. Modal-M4 raster strategy (T1-31): M4 at start, M5 at end, gap-bridges
//    in between with S=0. Verify gap-bridges land in overscanRegions, not
//    in burnSegments.
{
  const gcode = [
    'G21', 'G90',
    'G0 X0 Y0',
    'M4 S0',                   // modal M4 start, S=0 means laser is off
    'G1 X5 Y0 F1000 S500',     // burn segment 1: power 500, S>0 so laserOn=true
    'G1 X10 Y0 S0',            // gap-bridge: S=0, laser off
    'G1 X15 Y0 S500',          // burn segment 2
    'M5',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.burnSegments.length === 2,
    `modal-M4: 2 burn segments (got ${a.burnSegments.length})`);
  assert(a.overscanRegions.length === 1,
    `modal-M4: 1 overscan region for the S=0 gap-bridge (got ${a.overscanRegions.length})`);
  assert(a.overscanRegions[0].distance === 5,
    `modal-M4: overscan distance = 5mm (got ${a.overscanRegions[0].distance})`);
  assert(a.overscanRegions[0].bounds.minX === 5 && a.overscanRegions[0].bounds.maxX === 10,
    `modal-M4: overscan bounds [5..10] (got [${a.overscanRegions[0].bounds.minX}..${a.overscanRegions[0].bounds.maxX}])`);
}

// 5. Mid-job laser-off event surfaces unexpected M5 between burn moves
{
  const gcode = [
    'G21', 'G90',
    'G0 X0 Y0',
    'M4 S500',
    'G1 X10 Y0 F1000',
    'M5',                      // ← mid-job M5
    'G0 X20 Y0',
    'M4 S500',
    'G1 X30 Y0 F1000',
    'M5',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.midJobLaserOff.length === 1,
    `mid-job M5: 1 event surfaced (got ${a.midJobLaserOff.length})`);
  assert(a.midJobLaserOff[0].position.x === 10,
    `mid-job M5: at X=10 (the position when the first M5 fired; got ${a.midJobLaserOff[0].position.x})`);
}

// 6. Pure rapid (no burn) → empty burnBounds, populated rapidBounds
{
  const gcode = [
    'G21', 'G90',
    'G0 X10 Y10',
    'G0 X20 Y20',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.burnSegments.length === 0,
    `pure rapid: no burn segments (got ${a.burnSegments.length})`);
  assert(a.burnBounds.minX === Infinity,
    `pure rapid: burnBounds is empty AABB (minX = Infinity, got ${a.burnBounds.minX})`);
  assert(a.rapidSegments.length === 2,
    `pure rapid: 2 rapid segments (got ${a.rapidSegments.length})`);
  assert(a.rapidBounds.maxX === 20 && a.rapidBounds.maxY === 20,
    `pure rapid: rapidBounds maxes at (20,20)`);
}

// 7. Empty gcode → all-empty analysis
{
  const a = analyzeBurnBounds(parseGcode(''));
  assert(a.burnSegments.length === 0 && a.rapidSegments.length === 0,
    `empty gcode: no segments`);
  assert(a.totalDistanceBurn === 0 && a.totalDistanceRapid === 0,
    `empty gcode: zero distances`);
  assert(a.laserOnTime === 0, `empty gcode: zero burn time`);
}

// 8. laserOnTime returns 0 if any burn segment has no declared feed
//    (defensive: tests should not rely on a partial estimate)
{
  const gcode = [
    'G21', 'G90',
    'M4 S500',
    'G1 X10 Y0',                // no feed declared, no prior F either
    'M5',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.burnSegments.length === 1,
    `no-feed burn: still produces 1 burn segment (got ${a.burnSegments.length})`);
  assert(a.laserOnTime === 0,
    `no-feed burn: laserOnTime = 0 (defensively zero when feed missing; got ${a.laserOnTime})`);
}

// 9. Frame-vs-burn comparison pattern: same scene compiled into a frame
//    pass and a burn pass should produce equivalent burnBounds /
//    totalBounds. Build two synthetic gcode strings tracing the same
//    rectangle and verify analyzers agree on bounds.
{
  const square = (m4: string, s: string) => [
    'G21', 'G90',
    'G0 X10 Y10',
    `${m4} ${s}`,
    'G1 X30 Y10 F1000',
    'G1 X30 Y30',
    'G1 X10 Y30',
    'G1 X10 Y10',
    'M5',
  ].join('\n');
  const a1 = analyzeBurnBounds(parseGcode(square('M4', 'S500'))); // burn
  const a2 = analyzeBurnBounds(parseGcode(square('M4', 'S100'))); // frame (low power)
  assert(a1.burnBounds.minX === a2.burnBounds.minX &&
    a1.burnBounds.maxX === a2.burnBounds.maxX &&
    a1.burnBounds.minY === a2.burnBounds.minY &&
    a1.burnBounds.maxY === a2.burnBounds.maxY,
    `frame-vs-burn: bounds match across power levels`);
}

// 10. RTL motion (negative X delta) still accumulates positive distance
{
  const gcode = [
    'G21', 'G90',
    'G0 X10 Y0',
    'M4 S500',
    'G1 X0 Y0 F1000',           // RTL burn
    'M5',
  ].join('\n');
  const a = analyzeBurnBounds(parseGcode(gcode));
  assert(a.totalDistanceBurn === 10,
    `RTL burn: distance is 10 (positive, not -10; got ${a.totalDistanceBurn})`);
  assert(a.burnBounds.minX === 0 && a.burnBounds.maxX === 10,
    `RTL burn: burnBounds spans [0..10] (got [${a.burnBounds.minX}..${a.burnBounds.maxX}])`);
}

// 11. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, 'helpers/analyzeBurnBounds.ts'), 'utf-8');
  assert(/T2-19/.test(src), 'T2-19 marker in helper source');
  assert(/export function analyzeBurnBounds/.test(src),
    'analyzeBurnBounds exported');
  assert(/overscanRegions/.test(src) && /midJobLaserOff/.test(src) && /laserOnTime/.test(src),
    'BurnAnalysis includes overscanRegions, midJobLaserOff, laserOnTime');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
