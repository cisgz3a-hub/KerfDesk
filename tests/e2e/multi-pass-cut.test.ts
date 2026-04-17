/**
 * E2E: multi-pass cut — same path repeated with pass markers.
 */

import { makeMultiPassCutScene } from './fixtures/multiPassCut';
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

console.log('\n=== E2E: multi-pass-cut ===');

try {
  const scene = makeMultiPassCutScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });

  assert(gcode.includes('pass 3/3'), 'Shows third pass marker in comments');
  assert((gcode.match(/\bM4\b/g) ?? []).length >= 3, 'At least three laser-on cycles for three passes');

  expectMatchesSnapshot(gcode, 'multi-pass-cut.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
