import './helpers/e2eDeterministicIds';

/**
 * E2E: Hershey Sans text → stable G-code (single-line stroke path).
 */

import { makeTextHersheySansScene } from './fixtures/textHersheySans';
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

console.log('\n=== E2E: text-hershey-sans ===');

(async () => {
  try {
    let scene = makeTextHersheySansScene();
    scene = await prepareSceneForCompile(scene);

    const g1Count = (s: string) => (s.match(/^G1 /gm) ?? []).length;
    const gcode = compileSceneToGcode(scene, { startMode: 'current' });

    assertSemanticGcode(gcode, assert, {
      expectedDistanceMode: 'relative',
      minBurnSegments: 8,
    });
    assert(g1Count(gcode) >= 8, `Hershey stroke produces multiple G1 moves (got ${g1Count(gcode)})`);

    expectMatchesSnapshot(gcode, 'text-hershey-sans.gcode');
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
