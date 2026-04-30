/**
 * Box library search/category filtering contracts.
 * Run: npx tsx tests/box-library-filtering.test.tsx
 */
import { BOX_LIBRARY_PRESETS, filterBoxPresets } from '../src/core/box/boxLibrary';

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

console.log('\n=== box library filtering ===\n');

{
  const results = filterBoxPresets(BOX_LIBRARY_PRESETS, 'tray', 'all');
  const ids = results.map(p => p.id);
  assert(
    ids.includes('open-parts-tray') &&
      ids.includes('desk-organizer-tray') &&
      ids.includes('drawer-insert-tray'),
    'searching tray returns tray presets',
  );
}

{
  const results = filterBoxPresets(BOX_LIBRARY_PRESETS, 'electronics', 'all');
  assert(results.some(p => p.id === 'arduino-enclosure') && results.every(p => p.category === 'electronics' || p.tags.includes('electronics')),
    'searching electronics returns enclosure presets');
}

{
  const results = filterBoxPresets(BOX_LIBRARY_PRESETS, '', 'gift');
  assert(results.length === 3 && results.every(p => p.category === 'gift'), 'gift category filter narrows correctly');
}

{
  const results = filterBoxPresets(BOX_LIBRARY_PRESETS, 'vent project', 'electronics');
  assert(results.length === 1 && results[0]!.id === 'ventilated-project-box', 'multi-word query requires every word');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
