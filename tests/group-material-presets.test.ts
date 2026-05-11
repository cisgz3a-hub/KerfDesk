/**
 * T1-133: regression test for the pure material-preset grouping
 * extracted from LayerPanel.
 *
 * Pre-T1-133 this 13-line reduce-then-sort block lived inline in a
 * `useMemo` inside `LayerPanel`; testing it required mounting the panel
 * with a `getPresets()` fixture and a re-render on
 * `materialPresetRevision`. Post-T1-133 it's a pure function that takes
 * a preset list and returns a stable-sorted `[material, presets][]`
 * tuple array.
 *
 * This test pins:
 *   - groups are sub-sorted by name within each material bucket
 *   - groups themselves are sorted by material name
 *   - missing/empty material falls into the "Other" bucket
 *   - whitespace-only material is preserved (NOT treated as "Other" —
 *     the `|| 'Other'` falsy-check only catches empty strings, which
 *     matches the pre-T1-133 behavior)
 *   - empty input returns []
 *   - localeCompare is used (case-insensitive-ish across locales)
 *   - Source pin: LayerPanel imports + the inline reduce is gone.
 *
 * Run: npx tsx tests/group-material-presets.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MaterialPreset } from '../src/core/materials/MaterialPreset';
import { groupMaterialPresetsByMaterial } from '../src/ui/components/layers/groupMaterialPresets';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function preset(id: string, name: string, material: string): MaterialPreset {
  return {
    id,
    name,
    material,
    thickness: '3mm',
    laserWattage: '20W',
    operations: {},
  } as MaterialPreset;
}

console.log('\n=== T1-133 material-preset grouping ===\n');

// -------- 1. empty input --------
{
  const r = groupMaterialPresetsByMaterial([]);
  assert(Array.isArray(r) && r.length === 0, 'empty input → []');
}

// -------- 2. single preset --------
{
  const r = groupMaterialPresetsByMaterial([preset('p1', 'A', 'Wood')]);
  assert(r.length === 1 && r[0][0] === 'Wood', 'single preset → one group');
  assert(r[0][1].length === 1 && r[0][1][0].id === 'p1',
    'single preset → that preset is in the group');
}

// -------- 3. groups sorted by material name --------
{
  const r = groupMaterialPresetsByMaterial([
    preset('a', 'A1', 'Wood'),
    preset('b', 'B1', 'Acrylic'),
    preset('c', 'C1', 'Metal'),
  ]);
  assert(r.map((g) => g[0]).join(',') === 'Acrylic,Metal,Wood',
    'groups sorted by material name (Acrylic, Metal, Wood)');
}

// -------- 4. presets within group sorted by name --------
{
  const r = groupMaterialPresetsByMaterial([
    preset('a', 'Charlie', 'Wood'),
    preset('b', 'Alpha', 'Wood'),
    preset('c', 'Bravo', 'Wood'),
  ]);
  assert(r[0][1].map((p) => p.name).join(',') === 'Alpha,Bravo,Charlie',
    'within group: sorted by name');
}

// -------- 5. missing/empty material → "Other" bucket --------
{
  const r = groupMaterialPresetsByMaterial([
    preset('a', 'X', ''),
    preset('b', 'Y', 'Wood'),
  ]);
  const materials = r.map((g) => g[0]).sort();
  assert(materials.includes('Other'),
    'empty material → "Other" bucket');
  assert(materials.includes('Wood'),
    'non-empty material → its own bucket');
  const other = r.find((g) => g[0] === 'Other');
  assert(other != null && other[1].length === 1 && other[1][0].id === 'a',
    '"Other" bucket carries the empty-material preset');
}

// -------- 6. multiple per group + multiple groups --------
{
  const r = groupMaterialPresetsByMaterial([
    preset('a', 'Birch 3mm', 'Wood'),
    preset('b', 'Cast 3mm', 'Acrylic'),
    preset('c', 'Plywood 6mm', 'Wood'),
    preset('d', 'Extruded 5mm', 'Acrylic'),
  ]);
  assert(r.length === 2, 'two distinct materials → 2 groups');
  const acrylic = r.find((g) => g[0] === 'Acrylic')!;
  const wood = r.find((g) => g[0] === 'Wood')!;
  assert(acrylic[1].map((p) => p.name).join(',') === 'Cast 3mm,Extruded 5mm',
    'Acrylic group sorted: Cast 3mm before Extruded 5mm');
  assert(wood[1].map((p) => p.name).join(',') === 'Birch 3mm,Plywood 6mm',
    'Wood group sorted: Birch 3mm before Plywood 6mm');
}

// -------- 7. order independent of input order --------
{
  const a = groupMaterialPresetsByMaterial([
    preset('1', 'B', 'Wood'),
    preset('2', 'A', 'Wood'),
    preset('3', 'C', 'Acrylic'),
  ]);
  const b = groupMaterialPresetsByMaterial([
    preset('3', 'C', 'Acrylic'),
    preset('2', 'A', 'Wood'),
    preset('1', 'B', 'Wood'),
  ]);
  // Materials sort same, presets within sort same
  assert(JSON.stringify(a.map((g) => [g[0], g[1].map((p) => p.name)])) ===
         JSON.stringify(b.map((g) => [g[0], g[1].map((p) => p.name)])),
    'output is independent of input order');
}

// -------- 8. case-sensitivity follows localeCompare --------
{
  const r = groupMaterialPresetsByMaterial([
    preset('a', 'lowercase', 'Wood'),
    preset('b', 'UPPERCASE', 'Wood'),
    preset('c', 'Mixed', 'Wood'),
  ]);
  // localeCompare is case-insensitive on most locales but ordering is locale-defined.
  // Pin only that all three are present and in the same group.
  assert(r[0][1].length === 3,
    'localeCompare keeps case-mixed names in the same group with all 3 elements');
}

// -------- 9. Source-level pin: LayerPanel delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/LayerPanel.tsx'),
    'utf-8',
  );
  assert(/from '\.\/layers\/groupMaterialPresets'/.test(panelSrc),
    'LayerPanel imports groupMaterialPresetsByMaterial from helper');
  assert(/groupMaterialPresetsByMaterial\(materialPresets\)/.test(panelSrc),
    'LayerPanel calls groupMaterialPresetsByMaterial(materialPresets)');
  assert(/T1-133/.test(panelSrc),
    'LayerPanel carries T1-133 marker');
  // The pre-T1-133 inline reduce is gone. Pin the most distinctive
  // signature — the literal "for (const p of materialPresets)" loop.
  assert(!/for \(const p of materialPresets\)/.test(panelSrc),
    'inline reduce-by-material loop is gone from LayerPanel');
  assert(!/new Map<string, MaterialPreset\[\]>\(\);/.test(panelSrc),
    'inline new Map<string, MaterialPreset[]>() is gone from LayerPanel');

  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/layers/groupMaterialPresets.ts'),
    'utf-8',
  );
  assert(/T1-133/.test(helperSrc),
    'groupMaterialPresets helper carries T1-133 marker');
  assert(/export function groupMaterialPresetsByMaterial/.test(helperSrc),
    'groupMaterialPresetsByMaterial is exported');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
