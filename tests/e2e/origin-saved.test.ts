/**
 * E2E: rectangle with savedOrigin start mode.
 */

import { makeOriginSavedScene } from './fixtures/originSaved';
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

console.log('\n=== E2E: origin-saved ===');

try {
  const scene = makeOriginSavedScene();
  const gcode = compileSceneToGcode(scene, {
    startMode: 'savedOrigin',
    savedOrigin: { x: 100, y: 75 },
  });

  assert(gcode.includes('G21'), 'Includes G21');
  assert(gcode.includes('M4'), 'Includes M4');

  expectMatchesSnapshot(gcode, 'origin-saved.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
