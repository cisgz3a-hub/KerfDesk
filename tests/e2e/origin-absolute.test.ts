import './helpers/e2eDeterministicIds';

/**
 * E2E: rectangle with startMode absolute — scene coords vs work offset.
 */

import { makeOriginAbsoluteScene } from './fixtures/originAbsolute';
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

console.log('\n=== E2E: origin-absolute ===');

try {
  const scene = makeOriginAbsoluteScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'absolute' });

  assertSemanticGcode(gcode, assert, {
    expectedDistanceMode: 'absolute',
    initialMotionMustBeLaserOff: true,
    expectedBurnWidth: 40,
    expectedBurnHeight: 20,
    minBurnSegments: 4,
  });

  expectMatchesSnapshot(gcode, 'origin-absolute.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
