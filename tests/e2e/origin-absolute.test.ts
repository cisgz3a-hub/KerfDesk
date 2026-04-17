/**
 * E2E: rectangle with startMode absolute — scene coords vs work offset.
 */

import { makeOriginAbsoluteScene } from './fixtures/originAbsolute';
import { compileSceneToGcode } from './helpers/compileToGcode';
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

  assert(gcode.includes('G21'), 'Includes G21');
  assert(gcode.includes('G90'), 'Includes G90');
  assert(gcode.includes('M4'), 'Includes M4');

  expectMatchesSnapshot(gcode, 'origin-absolute.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
