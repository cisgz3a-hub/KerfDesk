/**
 * Box library preset sanity tests.
 * Run: npx tsx tests/box-library.test.ts
 */
import { BOX_LIBRARY_PRESETS, getBoxLibraryPreset } from '../src/core/box/boxLibrary';
import { generateBoxFaces, interiorToExterior } from '../src/core/box/boxGeometry';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== box library presets ===\n');

const ids = new Set<string>();
for (const preset of BOX_LIBRARY_PRESETS) {
  assert(!ids.has(preset.id), `unique id: ${preset.id}`);
  ids.add(preset.id);
  assert(preset.width > 0 && preset.height > 0 && preset.depth > 0, `${preset.id}: positive dimensions`);
  assert(preset.thickness > 0, `${preset.id}: positive material thickness`);
  assert(preset.fingerWidth >= 3, `${preset.id}: usable finger width`);
  assert(preset.kerf >= 0, `${preset.id}: non-negative kerf`);
  assert(preset.fitAllowance >= 0, `${preset.id}: non-negative fit allowance`);

  const dims = preset.dimensionMode === 'inside'
    ? interiorToExterior(preset.width, preset.height, preset.depth, preset.thickness, preset.openTop)
    : { width: preset.width, height: preset.height, depth: preset.depth };
  const faces = generateBoxFaces({
    ...dims,
    thickness: preset.thickness,
    fingerWidth: preset.fingerWidth,
    openTop: preset.openTop,
    kerf: preset.kerf,
    fitAllowance: preset.fitAllowance,
  });
  assert(faces.length === (preset.openTop ? 5 : 6), `${preset.id}: generates expected face count`);
}

assert(getBoxLibraryPreset('starter-small-closed')?.title === 'Small closed keepsake box', 'lookup returns starter preset');
assert(getBoxLibraryPreset('missing') === undefined, 'lookup returns undefined for missing preset');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
