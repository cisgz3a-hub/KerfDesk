/**
 * Box library preset sanity tests.
 * Run: npx tsx tests/box-library.test.ts
 */
import {
  BOX_LIBRARY_PRESETS,
  BOX_PRESET_CATEGORIES,
  filterBoxPresets,
  getBoxPresetById,
} from '../src/core/box/boxLibrary';
import { generateBoxFaces } from '../src/core/box/boxGeometry';
import type { BoxPresetCategory } from '../src/core/box/boxLibraryTypes';

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
let previousSort = 0;
const validCategories = new Set<BoxPresetCategory>(
  BOX_PRESET_CATEGORIES.filter(c => c.id !== 'all').map(c => c.id as BoxPresetCategory),
);
for (const preset of BOX_LIBRARY_PRESETS) {
  assert(!ids.has(preset.id), `unique id: ${preset.id}`);
  ids.add(preset.id);
  assert(validCategories.has(preset.category), `${preset.id}: valid category`);
  assert(preset.sortOrder > previousSort, `${preset.id}: sort order is increasing`);
  previousSort = preset.sortOrder;
  assert(preset.name.length > 0 && preset.description.length > 0, `${preset.id}: has copy`);
  assert(preset.tags.length > 0 && preset.featureBadges.length > 0, `${preset.id}: has tags and badges`);
  assert(preset.width > 0 && preset.height > 0 && preset.depth > 0, `${preset.id}: positive dimensions`);
  assert(preset.thickness > 0, `${preset.id}: positive material thickness`);
  assert(preset.fingerWidth >= 3, `${preset.id}: usable finger width`);
  assert(preset.kerf >= 0, `${preset.id}: non-negative kerf`);
  assert(preset.fitAllowance >= 0, `${preset.id}: non-negative fit allowance`);

  const faces = generateBoxFaces({
    width: preset.width,
    height: preset.height,
    depth: preset.depth,
    thickness: preset.thickness,
    fingerWidth: preset.fingerWidth,
    openTop: preset.openTop,
    kerf: preset.kerf,
    fitAllowance: preset.fitAllowance,
  });
  assert(faces.length === (preset.openTop ? 5 : 6), `${preset.id}: generates expected face count`);
}

assert(BOX_LIBRARY_PRESETS.length === 21, 'starter library contains 21 professional presets');
assert(getBoxPresetById('small-keepsake-box')?.name === 'Small Keepsake Box', 'lookup returns starter preset');
assert(getBoxPresetById('missing') === undefined, 'lookup returns undefined for missing preset');
assert(filterBoxPresets(BOX_LIBRARY_PRESETS, 'gift box', 'all').length >= 2, 'multi-word search matches gift box presets');
assert(filterBoxPresets(BOX_LIBRARY_PRESETS, '', 'electronics').every(p => p.category === 'electronics'), 'category filter narrows to electronics');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
