import './helpers/e2eDeterministicIds';

/**
 * E2E: ellipse cut — tessellated closed path.
 */

import { makeCircleCutScene } from './fixtures/circleCut';
import { compileSceneToGcode } from './helpers/compileToGcode';
import { assertSemanticGcode } from './helpers/semanticGcodeAssertions';
import { expectMatchesSnapshot } from './helpers/snapshot';

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

console.log('\n=== E2E: circle-cut ===');

try {
  const scene = makeCircleCutScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });
  const g1Count = (gcode.match(/^G1 /gm) ?? []).length;

  assertSemanticGcode(gcode, assert, {
    expectedDistanceMode: 'relative',
    expectedBurnWidth: 80,
    expectedBurnHeight: 60,
    minBurnSegments: 24,
    tolerance: 0.5,
  });
  assert(g1Count >= 24, `Ellipse tessellation yields many G1 segments (got ${g1Count})`);

  expectMatchesSnapshot(gcode, 'circle-cut.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
