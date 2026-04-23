/**
 * subPathToPoints tolerance: 0.5mm for paths vs 0.05mm for text in geometryToPoints.
 * Run: npx tsx tests/job-compiler-curve-flatness.test.ts
 */

import { subPathToPoints } from '../src/core/job/JobCompiler';
import type { PathSegment } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

/**
 * p0 = (0,0) implicit, p3 = (20,0). Control height tuned so 0.5mm is “flat
 * enough” (few output points) while 0.05mm still needs many segments.
 */
const CUBIC_TUNED: PathSegment[] = [
  { type: 'cubic', cp1: { x: 5, y: 1.6 }, cp2: { x: 15, y: 1.6 }, to: { x: 20, y: 0 } },
];

function main(): void {
  console.log('\n=== Job compiler curve flatness (subPathToPoints) ===');

  const tight = subPathToPoints(CUBIC_TUNED, 0.05);
  const loose = subPathToPoints(CUBIC_TUNED, 0.5);

  assert(
    tight.length > 15,
    `cubic with tolerance=0.05: many points (got ${tight.length}, want > 15)`,
  );
  assert(
    loose.length < 5,
    `cubic with tolerance=0.5: few points (got ${loose.length}, want < 5)`,
  );

  console.log(`\nJob compiler curve flatness: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
