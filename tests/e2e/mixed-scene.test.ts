import './helpers/e2eDeterministicIds';

/**
 * E2E: mixed cut / engrave / score / text — operation ordering.
 */

import { makeMixedScene } from './fixtures/mixedScene';
import { compileSceneToGcode } from './helpers/compileToGcode';
import { prepareSceneForCompile } from './helpers/prepareSceneForCompile';
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

console.log('\n=== E2E: mixed-scene ===');

(async () => {
  try {
    let scene = makeMixedScene();
    scene = await prepareSceneForCompile(scene);
    const gcode = compileSceneToGcode(scene, { startMode: 'current' });
    assertSemanticGcode(gcode, assert, {
      expectedDistanceMode: 'relative',
      minBurnSegments: 20,
    });

    const engraveIdx = gcode.indexOf('; --- Engrave');
    const cutIdx = gcode.indexOf('; --- Cut');
    assert(engraveIdx >= 0 && cutIdx >= 0, 'Has Engrave and Cut operation blocks');
    assert(engraveIdx < cutIdx, 'Engrave section appears before Cut (layer processing order)');

    assert(gcode.includes('Score'), 'Includes score section');
    assert(gcode.includes('M4'), 'Includes M4');
    assert(
      /M5 S0\nG1 [^\n]*\nM4 S0\nG1 [^\n]*S\d+/m.test(gcode),
      'Raster gap travel uses hard laser-off before burn resumes',
    );

    expectMatchesSnapshot(gcode, 'mixed-scene.gcode');
    passed++;
    console.log(`  ✓ Snapshot verified (${gcode.length} chars)`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${(err as Error).message}`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
