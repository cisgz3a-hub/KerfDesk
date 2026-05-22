/**
 * External-repo lesson: K40 Whisperer / LibLaserCut style drivers treat travel
 * between independent contours as explicit laser-off motion. LaserForge must
 * never turn an SVG "move" between disconnected subpaths into a burn segment.
 *
 * Run: npx tsx tests/disconnected-subpath-travel-safety.test.ts
 */
import './e2e/helpers/e2eDeterministicIds';

import { createScene } from '../src/core/scene/Scene';
import { createPath, type SubPath } from '../src/core/scene/SceneObject';
import { compileJob } from '../src/core/job/JobCompiler';
import { compileSceneToGcode } from './e2e/helpers/compileToGcode';
import { parseGcode } from './helpers/parseGcode';
import { analyzeBurnBounds } from './helpers/analyzeBurnBounds';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function openSubPath(from: { x: number; y: number }, to: { x: number; y: number }): SubPath {
  return {
    closed: false,
    segments: [
      { type: 'move', to: from },
      { type: 'line', to },
    ],
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

console.log('\n=== disconnected subpath travel safety ===\n');

const scene = createScene(200, 150, 'disconnected subpaths');
const cut = scene.layers[0];
scene.objects.push(createPath(cut.id, [
  openSubPath({ x: 10, y: 10 }, { x: 30, y: 10 }),
  openSubPath({ x: 90, y: 40 }, { x: 120, y: 40 }),
], 'two disconnected strokes'));

const job = compileJob(scene);
const op = job.operations[0];
if (op?.geometry.type !== 'vector') {
  throw new Error('fixture did not compile to a vector operation');
}

assert(op.geometry.paths.length === 2, `compiler preserves two disconnected subpaths as two FlatPaths (got ${op.geometry.paths.length})`);

const gcode = compileSceneToGcode(scene, { startMode: 'current' });
const parsed = parseGcode(gcode);
const analysis = analyzeBurnBounds(parsed);

assert(parsed.asserts.noBurnDuringRapid, 'emitted G-code never burns during rapid travel');
assert(parsed.asserts.finalLaserOff, 'emitted G-code ends with laser off');
assert(analysis.burnSegments.length === 2, `exactly two powered burn segments, one per subpath (got ${analysis.burnSegments.length})`);
assert(analysis.midJobLaserOff.length >= 1, 'laser-off boundary is emitted before the second disconnected subpath burns');

const burnLengths = analysis.burnSegments.map(seg => distance(seg.fromXY, seg.toXY));
const longestBurn = Math.max(...burnLengths);
assert(longestBurn <= 30.1, `longest powered segment is one designed stroke, not the inter-subpath gap (got ${longestBurn.toFixed(3)}mm)`);

const expectedGapMm = distance({ x: 30, y: 10 }, { x: 90, y: 40 });
assert(
  analysis.burnSegments.every(seg => distance(seg.fromXY, seg.toXY) < expectedGapMm - 1),
  'no burn segment crosses the long move between disconnected subpaths',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
