/**
 * Kerf preset list + findPresetIdForKerf lookup.
 * Run: npx tsx tests/kerf-presets.test.ts
 */
import { KERF_PRESETS, findPresetIdForKerf } from '../src/core/box/kerfPresets';

let passed = 0;
let failed = 0;

function assert(c: boolean, msg: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

console.log('\n=== kerf presets — list shape ===\n');
{
  assert(KERF_PRESETS.length >= 3, 'at least three presets');
  assert(KERF_PRESETS.length === 5, 'exactly five presets (custom + four materials)');
  assert(
    KERF_PRESETS[0]!.id === 'custom' && KERF_PRESETS[0]!.kerf === 0,
    "first preset is 'custom' with kerf 0",
  );
  const ids = KERF_PRESETS.map(p => p.id);
  assert(new Set(ids).size === ids.length, 'no duplicate preset ids');
  assert(
    KERF_PRESETS.filter(p => p.id !== 'custom').every(p => p.kerf > 0),
    'every non-custom preset has positive kerf',
  );
  assert(KERF_PRESETS.every(p => p.label.length > 0), 'every preset has a non-empty label');
  assert(ids.includes('diode-wood') && ids.includes('co2-wood'), 'expected laser presets present');
}

console.log('\n=== kerf presets — round-trip kerf → id ===\n');
{
  for (const p of KERF_PRESETS) {
    if (p.id === 'custom') continue;
    assert(findPresetIdForKerf(p.kerf) === p.id, `kerf ${p.kerf} maps to ${p.id}`);
  }
}

console.log('\n=== kerf presets — zero → custom ===\n');
{
  assert(findPresetIdForKerf(0) === 'custom', 'exactly zero maps to custom');
}

console.log('\n=== kerf presets — unmatched values → custom ===\n');
{
  assert(findPresetIdForKerf(0.13) === 'custom', 'between-preset value maps to custom');
  assert(findPresetIdForKerf(2) === 'custom', 'large value maps to custom');
  assert(findPresetIdForKerf(-0.01) === 'custom', 'negative maps to custom');
}

console.log('\n=== kerf presets — float tolerance ===\n');
{
  assert(findPresetIdForKerf(0.1 + 1e-7) === 'diode-wood', 'noise near 0.1 still matches diode-wood');
  assert(findPresetIdForKerf(0.16 - 5e-7) === 'co2-wood', 'noise near 0.16 still matches co2-wood');
  assert(findPresetIdForKerf(0.2 + 3e-7) === 'co2-acrylic', 'noise near 0.2 still matches co2-acrylic');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
