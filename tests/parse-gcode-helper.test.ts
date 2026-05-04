/**
 * T2-18: pin contracts on the new `tests/helpers/parseGcode.ts` semantic
 * G-code parser. The parser walks a gcode string line-by-line, tracks
 * modal state (units, distance mode, motion mode, laser modal, feed,
 * spindle, position), classifies each line, and produces per-burn /
 * per-rapid / total bounds plus a set of safety-invariant checks.
 *
 * Future tests use this helper instead of `gcode.includes(...)` —
 * see the spec for the migration plan in T2-19 / T2-23.
 *
 * Run: npx tsx tests/parse-gcode-helper.test.ts
 */
import { parseGcode } from './helpers/parseGcode';

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

console.log('\n=== T2-18 parseGcode helper ===\n');

async function run(): Promise<void> {

// 1. Basic header is parsed and modal state captured
{
  const r = parseGcode('G21\nG90\nM5 S0\n');
  assert(r.finalState.units === 'mm', 'G21 sets units = mm');
  assert(r.finalState.distanceMode === 'absolute', 'G90 sets distanceMode = absolute');
  assert(r.finalState.laserMode === 'off', 'M5 sets laserMode = off');
  assert(r.asserts.unitsDeclared, 'unitsDeclared invariant true');
  assert(r.asserts.distanceModeDeclared, 'distanceModeDeclared invariant true');
}

// 2. G20 sets units = inch
{
  const r = parseGcode('G20\nG90\n');
  assert(r.finalState.units === 'inch', 'G20 sets units = inch');
}

// 3. G91 sets distance mode to relative; subsequent G1 deltas accumulate
{
  const r = parseGcode('G21\nG91\nG1 X10 Y0 F1000\nG1 X5 Y3\n');
  assert(r.finalState.distanceMode === 'relative', 'G91 → relative');
  assert(r.finalState.position.x === 15 && r.finalState.position.y === 3,
    `relative deltas accumulate (got x=${r.finalState.position.x}, y=${r.finalState.position.y})`);
}

// 4. G90 absolute positioning sets the literal target
{
  const r = parseGcode('G21\nG90\nG1 X10 Y20 F1000\nG1 X100 Y200\n');
  assert(r.finalState.position.x === 100 && r.finalState.position.y === 200,
    'absolute positioning lands at literal X/Y');
}

// 5. M3/M4 set laserMode; M5 clears
{
  const r = parseGcode('G21\nG90\nM3 S500\nG1 X10 Y10 F1000\nM5 S0\n');
  assert(r.finalState.laserMode === 'off', 'final state laser off after M5');
  assert(!r.asserts.startsLaserOff,
    'startsLaserOff = false when M3 fires before first motion (semantic: was laser off at first motion?)');
  assert(r.asserts.endsLaserOff, 'endsLaserOff true (M5 ran)');
}

// 5b. startsLaserOff = true when laser only fires AFTER the first move
{
  const r = parseGcode('G21\nG90\nG0 X10 Y0\nM4 S500\nG1 X20 Y0 F1000\nM5\n');
  assert(r.asserts.startsLaserOff,
    'startsLaserOff = true when initial rapid runs before any M3/M4 (laser was off at first motion)');
}

// 6. G0 with active laser modal + spindle > 0 → noBurnDuringRapid violated
{
  const r = parseGcode('G21\nG90\nM4 S500\nG0 X10 Y10\nM5 S0\n');
  assert(!r.asserts.noBurnDuringRapid,
    'G0 with M4+S500 active → noBurnDuringRapid invariant FAILS');
}

// 7. G0 with M3 but S=0 → noBurnDuringRapid still passes
{
  const r = parseGcode('G21\nG90\nM3 S0\nG0 X10 Y10\nM5 S0\n');
  assert(r.asserts.noBurnDuringRapid,
    'G0 with M3 but S=0 (laser-armed-but-off) does NOT violate noBurnDuringRapid');
}

// 8. spindleNeverExceedsMax predicate
{
  const r = parseGcode('G21\nG90\nM4 S800\nG1 X1 Y1 F1000\nM4 S1200\nG1 X2 Y2\nM5 S0\n');
  assert(r.asserts.spindleNeverExceedsMax(2000), 'all S values ≤ 2000');
  assert(!r.asserts.spindleNeverExceedsMax(1000), 'S=1200 exceeds 1000 ceiling');
  assert(r.asserts.spindleNeverExceedsMax(1200), 'S=1200 ≤ 1200 (boundary inclusive)');
}

// 9. Burn bounds — only G1 with M3/M4+S>0 counted; G0 + M5 segments excluded
{
  const r = parseGcode([
    'G21', 'G90',
    'G0 X0 Y0',          // rapid, not burn
    'M4 S500',
    'G1 X10 Y0 F1000',   // burn
    'G1 X10 Y10',        // burn
    'M5 S0',
    'G0 X100 Y100',      // rapid, not burn
  ].join('\n'));
  assert(r.burnBounds.minX === 10 && r.burnBounds.maxX === 10,
    `burnBounds X range only contains the M4-active moves (minX=${r.burnBounds.minX}, maxX=${r.burnBounds.maxX})`);
  assert(r.burnBounds.minY === 0 && r.burnBounds.maxY === 10,
    `burnBounds Y range covers the M4-active moves`);
  assert(r.totalBounds.maxX === 100 && r.totalBounds.maxY === 100,
    'totalBounds includes the post-M5 rapid');
  assert(r.rapidBounds.maxX === 100, 'rapidBounds covers the rapid moves');
}

// 10. Comments stripped from coord parsing
{
  const r = parseGcode('G21\nG90\nG1 X10 ; this is a comment with X99\nM5\n');
  assert(r.finalState.position.x === 10,
    `coord parsing ignores comments (got X=${r.finalState.position.x}, expected 10)`);
}

// 11. Parenthesized comments stripped
{
  const r = parseGcode('G21\nG90\nG1 X10 (comment X99) Y20\nM5\n');
  assert(r.finalState.position.x === 10 && r.finalState.position.y === 20,
    'parenthesized comments stripped from coord parsing');
}

// 12. Negative-feed feedAlwaysPositive invariant
{
  const r = parseGcode('G21\nG90\nG1 X10 Y10 F-100\n');
  assert(!r.asserts.feedAlwaysPositive,
    'F-100 violates feedAlwaysPositive invariant');
}

// 13. Move classification
{
  const r = parseGcode([
    'G21',           // modal
    'G90',           // modal
    'G0 X10 Y0',     // rapid
    'G1 X10 Y10 F1000', // cut
    'G2 X20 Y20 I5 J0', // arc
    '; comment',     // comment
    '',              // empty
    'M5',            // modal
  ].join('\n'));
  const types = r.moves.map(m => m.type);
  assert(types.includes('rapid'), 'classifies G0 as rapid');
  assert(types.includes('cut'), 'classifies G1 as cut');
  assert(types.includes('arc'), 'classifies G2 as arc');
  assert(types.includes('comment'), 'classifies blank/; lines as comment');
  assert(types.includes('modal'), 'classifies G21/G90/M5 as modal');
}

// 14. Initial state has units/distanceMode null until set
{
  const r = parseGcode('G1 X10 Y10 F1000\n');
  assert(r.finalState.units === null, 'units null without G20/G21');
  assert(r.finalState.distanceMode === null, 'distanceMode null without G90/G91');
  assert(!r.asserts.unitsDeclared, 'unitsDeclared = false');
  assert(!r.asserts.distanceModeDeclared, 'distanceModeDeclared = false');
}

// 15. Each ParsedMove carries modalBefore + modalAfter snapshots
{
  const r = parseGcode('G21\nG90\nM4 S500\nG1 X10 Y0 F1000\nM5\n');
  const cutMove = r.moves.find(m => m.type === 'cut')!;
  assert(cutMove.modalBefore.laserMode === 'M4',
    'cutMove.modalBefore captures M4 active before the move');
  assert(cutMove.modalBefore.spindle === 500,
    'cutMove.modalBefore captures S500');
  assert(cutMove.toXY != null && cutMove.toXY.x === 10,
    'cutMove.toXY.x reflects the absolute target');
  assert(cutMove.laserOn === true, 'cutMove.laserOn = true (M4 + S500)');
}

// 16. Final state reflects accumulated position
{
  const r = parseGcode([
    'G21', 'G90',
    'G1 X100 Y50 F1000',
    'G1 X120 Y50',
    'G1 X120 Y80',
  ].join('\n'));
  assert(r.finalState.position.x === 120 && r.finalState.position.y === 80,
    `finalState.position tracks last absolute coords (got ${r.finalState.position.x},${r.finalState.position.y})`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
