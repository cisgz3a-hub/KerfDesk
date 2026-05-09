import './helpers/e2eDeterministicIds';

/**
 * E2E: score line — open path, score feed defaults.
 */

import { makeScoreLineScene } from './fixtures/scoreLine';
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

console.log('\n=== E2E: score-line ===');

try {
  const scene = makeScoreLineScene();
  const gcode = compileSceneToGcode(scene, { startMode: 'current' });
  const { analysis } = assertSemanticGcode(gcode, assert, {
    expectedDistanceMode: 'relative',
    expectedBurnWidth: 160,
    expectedBurnHeight: 0,
    minBurnSegments: 1,
  });

  assert(gcode.includes('Score'), 'Comment references Score layer');
  assert(
    analysis.burnSegments.some(segment => segment.feed != null && Math.abs(segment.feed - 2200) <= 1),
    'Uses score-class feed (~2200 mm/min)',
  );

  expectMatchesSnapshot(gcode, 'score-line.gcode');
  passed++;
  console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
} catch (err) {
  failed++;
  console.error(`  ✗ ${(err as Error).message}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
