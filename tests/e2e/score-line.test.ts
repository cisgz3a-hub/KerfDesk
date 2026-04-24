import './helpers/e2eDeterministicIds';

/**
 * E2E: score line — open path, score feed defaults.
 */

import { makeScoreLineScene } from './fixtures/scoreLine';
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

console.log('\n=== E2E: score-line ===');

try {
  const scene = makeScoreLineScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });

  assert(gcode.includes('G21'), 'Includes G21');
  assert(gcode.includes('Score'), 'Comment references Score layer');
  assert(gcode.includes('F2200') || gcode.includes('F2199') || gcode.includes('F2201'), 'Uses score-class feed (~2200 mm/min)');

  expectMatchesSnapshot(gcode, 'score-line.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
