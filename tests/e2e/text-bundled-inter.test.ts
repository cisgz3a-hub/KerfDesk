import './helpers/e2eDeterministicIds';

/**
 * E2E: bundled Inter text → stable G-code (opentype outline path).
 */

import { makeTextBundledInterScene } from './fixtures/textBundledInter';
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

console.log('\n=== E2E: text-bundled-inter ===');

(async () => {
  try {
    let scene = makeTextBundledInterScene();
    scene = await prepareSceneForCompile(scene);

    const g1Count = (s: string) => (s.match(/^G1 /gm) ?? []).length;
    const gcode = compileSceneToGcode(scene, { startMode: 'current' });

    assertSemanticGcode(gcode, assert, {
      expectedDistanceMode: 'relative',
      minBurnSegments: 40,
    });
    assert(g1Count(gcode) >= 40, `Many G1 segments from glyph outlines (got ${g1Count(gcode)})`);

    expectMatchesSnapshot(gcode, 'text-bundled-inter.gcode');
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
