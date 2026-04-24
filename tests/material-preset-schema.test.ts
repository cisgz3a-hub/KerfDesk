/**
 * Unified MaterialPreset schema + D.13 curve migration.
 * Covers:
 *   1. Legacy MaterialPreset loads without the new optional fields (backward compat).
 *   2. A preset with kerf + leadIn + responseCurve round-trips through save/load.
 *   3. applyMaterialPresetToLayer:
 *      - operation-level: dpi / threshold / airAssist / dithering applied to layer
 *      - preset-level:    leadIn written to cut settings, tabs copied
 *      - materialPresetId stamped on the returned layer
 *   4. applyMaterialPresetToLayer does NOT copy kerf / zOffset / responseCurve
 *      to the layer (these stay on the preset for compile-time lookup).
 *   5. migrateDeviceProfileResponseCurves moves matching curves onto presets
 *      (case-insensitive on `preset.material === curveKey`) and clears the
 *      migrated entries from the device profile.
 *   6. Migration is idempotent — running twice leaves the store unchanged.
 *   7. Curves with no matching preset (or whose preset already has a curve)
 *      remain on the device profile as a fallback.
 *
 * Run: npx tsx tests/material-preset-schema.test.ts
 */

import {
  applyMaterialPresetToLayer,
  getPresetById,
  getPresets,
  migrateDeviceProfileResponseCurves,
  savePreset,
} from '../src/core/materials/MaterialLibrary';
import type { MaterialPreset } from '../src/core/materials/MaterialPreset';
import {
  createBlankProfile,
  getDeviceProfiles,
  saveDeviceProfile,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';
import { createLayer, type Layer } from '../src/core/scene/Layer';
import type { ResponseCurve } from '../src/core/materials/ResponseCurve';
import {
  initializeMaterialLibrary,
  resetMaterialLibraryForTest,
} from '../src/core/materials/MaterialLibrary';
import { initializeDeviceProfiles, resetDeviceProfilesForTest } from '../src/core/devices/DeviceProfile';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`      expected: ${String(expected)}`);
    console.error(`      actual:   ${String(actual)}`);
  }
}

// ─── Mock localStorage ──────────────────────────────────────────────

const memoryStore: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(memoryStore).length;
    },
    clear(): void {
      for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    },
    key(index: number): string | null {
      return Object.keys(memoryStore)[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

function resetStorage(): void {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
}

installMockLocalStorage();

// ─── Fixtures ───────────────────────────────────────────────────────

function makeCurve(materialName: string): ResponseCurve {
  return {
    id: `resp_${materialName.toLowerCase().replace(/\s+/g, '_')}`,
    materialName,
    calibrationSpeed: 1000,
    points: [
      { commandedPower: 0, observedDarkness: 0 },
      { commandedPower: 50, observedDarkness: 0.5 },
      { commandedPower: 100, observedDarkness: 1 },
    ],
    calibratedAt: '2026-01-01T00:00:00.000Z',
  };
}

// Writes raw JSON (no schema check) into the user-preset bucket so we can
// simulate a pre-refactor stored blob.
const USER_PRESETS_KEY = 'laserforge-material-presets';

async function bootstrapPresetsTest(opts?: { legacyRows?: unknown[] }): Promise<void> {
  resetStorage();
  resetMaterialLibraryForTest();
  resetDeviceProfilesForTest();
  setStorageForTest(new InMemoryStorageAdapter());
  if (opts?.legacyRows) {
    memoryStore[USER_PRESETS_KEY] = JSON.stringify(opts.legacyRows);
  }
  await initializeDeviceProfiles();
  await initializeMaterialLibrary();
}

// ─── Tests ──────────────────────────────────────────────────────────

async function runAll(): Promise<void> {

console.log('[material-preset-schema] Test 1: legacy preset loads without new fields');
{
  const legacy = {
    id: 'preset-legacy-1',
    name: 'Legacy 3mm Plywood',
    material: 'Plywood',
    thickness: '3mm',
    laserWattage: '10W',
    operations: {
      cut: { power: 80, speed: 200, passes: 2 },
    },
    // no kerf, leadIn, zOffset, tabs, responseCurve
  };
  await bootstrapPresetsTest({ legacyRows: [legacy] });

  const loaded = getPresetById('preset-legacy-1');
  assert(loaded !== undefined, 'legacy preset survives load');
  assertEq(loaded?.name, 'Legacy 3mm Plywood', 'legacy preset name preserved');
  assertEq(loaded?.kerf, undefined, 'kerf undefined on legacy preset');
  assertEq(loaded?.responseCurve, undefined, 'responseCurve undefined on legacy preset');
  assertEq(loaded?.tabs, undefined, 'tabs undefined on legacy preset');
}

console.log('\n[material-preset-schema] Test 2: new fields round-trip through save/load');
{
  await bootstrapPresetsTest();
  const curve = makeCurve('Walnut');
  const rich: MaterialPreset = {
    id: 'preset-rich-1',
    name: 'Rich Walnut Preset',
    material: 'Walnut',
    thickness: '3mm',
    laserWattage: '20W',
    operations: {
      cut: { power: 85, speed: 180, passes: 2, dpi: 508, threshold: 140, airAssist: true },
      engrave: { power: 30, speed: 1200, passes: 1, dithering: 'floyd-steinberg' },
    },
    kerf: 0.12,
    leadIn: 1.5,
    zOffset: -0.5,
    tabs: { enabled: true, count: 3, width: 2.0, height: 0.5 },
    responseCurve: curve,
  };
  savePreset(rich);

  const loaded = getPresetById('preset-rich-1');
  assert(loaded !== undefined, 'rich preset loaded');
  assertEq(loaded?.kerf, 0.12, 'kerf round-tripped');
  assertEq(loaded?.leadIn, 1.5, 'leadIn round-tripped');
  assertEq(loaded?.zOffset, -0.5, 'zOffset round-tripped');
  assertEq(loaded?.tabs?.count, 3, 'tabs.count round-tripped');
  assertEq(loaded?.responseCurve?.id, curve.id, 'responseCurve.id round-tripped');
  assertEq(loaded?.responseCurve?.points.length, 3, 'responseCurve.points round-tripped');
  assertEq(loaded?.operations.cut?.threshold, 140, 'operation.threshold round-tripped');
  assertEq(loaded?.operations.cut?.airAssist, true, 'operation.airAssist round-tripped');
  assertEq(loaded?.operations.cut?.dpi, 508, 'operation.dpi round-tripped');
}

console.log('\n[material-preset-schema] Test 3: applyMaterialPresetToLayer applies new fields');
{
  await bootstrapPresetsTest();
  const preset: MaterialPreset = {
    id: 'preset-apply-1',
    name: 'Apply Test',
    material: 'Plywood',
    thickness: '3mm',
    laserWattage: '10W',
    operations: {
      cut: {
        power: 90,
        speed: 200,
        passes: 2,
        dpi: 600,
        threshold: 200,
        airAssist: true,
        dithering: 'atkinson',
      },
    },
    leadIn: 2.5,
    tabs: { enabled: true, count: 4, width: 3, height: 1 },
    // Compile-time-only fields (should NOT appear on layer)
    kerf: 0.08,
    zOffset: -0.2,
    responseCurve: makeCurve('Plywood'),
  };

  const layer: Layer = createLayer(0, 'cut', 'L1');
  const applied = applyMaterialPresetToLayer(layer, preset);
  assert(applied !== null, 'apply returned a layer');
  if (!applied) {
    console.error('    aborting Test 3 assertions: applied was null');
    process.exit(1);
  }

  assertEq(applied.settings.materialPresetId, 'preset-apply-1', 'materialPresetId stamped on layer');
  assertEq(applied.settings.speed, 200, 'speed applied');
  assertEq(applied.settings.power.max, 90, 'power.max applied');
  assertEq(applied.settings.passes, 2, 'passes applied');
  assertEq(applied.settings.image.resolution, 600, 'op.dpi → image.resolution');
  assertEq(applied.settings.image.imageThreshold, 200, 'op.threshold → image.imageThreshold');
  assertEq(applied.settings.image.dithering, 'atkinson', 'op.dithering → image.dithering');
  assertEq(applied.settings.airAssist, true, 'op.airAssist → layer.airAssist');
  assertEq(applied.settings.cut.leadIn, 2.5, 'preset.leadIn → cut.leadIn');
  assertEq(applied.settings.tabs?.count, 4, 'preset.tabs → layer.tabs');
  assertEq(applied.settings.tabs?.enabled, true, 'preset.tabs.enabled copied');

  // Compile-time fields intentionally not present on LaserSettings.
  const s = applied.settings as unknown as Record<string, unknown>;
  assertEq(s.kerf, undefined, 'kerf NOT copied to layer');
  assertEq(s.zOffset, undefined, 'zOffset NOT copied to layer');
  assertEq(s.responseCurve, undefined, 'responseCurve NOT copied to layer');
}

console.log('\n[material-preset-schema] Test 4: applyMaterialPresetToLayer returns null for missing op');
{
  await bootstrapPresetsTest();
  const preset: MaterialPreset = {
    id: 'preset-null-op',
    name: 'Null Op',
    material: 'Plywood',
    thickness: '3mm',
    laserWattage: '10W',
    operations: {}, // no cut/engrave/score
  };
  const layer: Layer = createLayer(0, 'cut');
  const applied = applyMaterialPresetToLayer(layer, preset);
  assertEq(applied, null, 'returns null when no op matches layer mode');
}

console.log('\n[material-preset-schema] Test 5: migrateDeviceProfileResponseCurves moves matching curves');
{
  await bootstrapPresetsTest();

  // Preset: material = 'Plywood', no curve yet.
  const preset: MaterialPreset = {
    id: 'preset-migrate-1',
    name: 'Plywood 3mm',
    material: 'Plywood',
    thickness: '3mm',
    laserWattage: '10W',
    operations: { cut: { power: 80, speed: 200, passes: 2 } },
  };
  savePreset(preset);

  // Device profile: curve keyed 'plywood' (case mismatch — should still match).
  const curve = makeCurve('plywood');
  const profile: DeviceProfile = {
    ...createBlankProfile('Test Machine'),
    responseCurves: { plywood: curve },
  };
  saveDeviceProfile(profile);

  migrateDeviceProfileResponseCurves();

  const migratedPreset = getPresetById('preset-migrate-1');
  assert(migratedPreset?.responseCurve !== undefined, 'preset now holds the curve');
  assertEq(migratedPreset?.responseCurve?.id, curve.id, 'curve id matches after migration');

  const migratedProfile = getDeviceProfiles().find(p => p.id === profile.id);
  assert(migratedProfile !== undefined, 'device profile still exists after migration');
  assert(
    !migratedProfile?.responseCurves || migratedProfile.responseCurves.plywood === undefined,
    'migrated curve removed from device profile',
  );
}

console.log('\n[material-preset-schema] Test 6: migration is idempotent');
{
  await bootstrapPresetsTest();
  const preset: MaterialPreset = {
    id: 'preset-idem-1',
    name: 'Idempotent Mat',
    material: 'Acrylic',
    thickness: '3mm',
    laserWattage: '10W',
    operations: { cut: { power: 70, speed: 100, passes: 3 } },
  };
  savePreset(preset);

  const curve = makeCurve('Acrylic');
  const profile: DeviceProfile = {
    ...createBlankProfile('Idem Machine'),
    responseCurves: { Acrylic: curve },
  };
  saveDeviceProfile(profile);

  migrateDeviceProfileResponseCurves();
  const snapshot1 = {
    presets: JSON.stringify(getPresets()),
    profiles: JSON.stringify(getDeviceProfiles()),
  };

  migrateDeviceProfileResponseCurves();
  const snapshot2 = {
    presets: JSON.stringify(getPresets()),
    profiles: JSON.stringify(getDeviceProfiles()),
  };

  assertEq(snapshot1.presets, snapshot2.presets, 'presets unchanged on second migration run');
  assertEq(snapshot1.profiles, snapshot2.profiles, 'profiles unchanged on second migration run');
}

console.log('\n[material-preset-schema] Test 7: unmatched curves stay on device profile');
{
  await bootstrapPresetsTest();
  // No preset with material matching "NonexistentMat".
  const curve = makeCurve('NonexistentMat');
  const profile: DeviceProfile = {
    ...createBlankProfile('Lonely Machine'),
    responseCurves: { NonexistentMat: curve },
  };
  saveDeviceProfile(profile);

  migrateDeviceProfileResponseCurves();

  const after = getDeviceProfiles().find(p => p.id === profile.id);
  assertEq(after?.responseCurves?.NonexistentMat?.id, curve.id, 'unmatched curve preserved on device profile');
}

console.log('\n[material-preset-schema] Test 8: unmatched-because-already-calibrated stays on profile');
{
  await bootstrapPresetsTest();
  // Preset exists AND already has a calibrated curve → migration should skip
  // (prevents clobbering newer data with older data from the device profile).
  const existingCurve = makeCurve('Leather-existing');
  const preset: MaterialPreset = {
    id: 'preset-already-1',
    name: 'Leather 2mm',
    material: 'Leather',
    thickness: '2mm',
    laserWattage: '10W',
    operations: { cut: { power: 80, speed: 200, passes: 2 } },
    responseCurve: existingCurve,
  };
  savePreset(preset);

  const profileCurve = makeCurve('Leather-from-profile');
  const profile: DeviceProfile = {
    ...createBlankProfile('Already Machine'),
    responseCurves: { Leather: profileCurve },
  };
  saveDeviceProfile(profile);

  migrateDeviceProfileResponseCurves();

  const afterPreset = getPresetById('preset-already-1');
  assertEq(afterPreset?.responseCurve?.id, existingCurve.id, 'existing preset curve not overwritten');
  const afterProfile = getDeviceProfiles().find(p => p.id === profile.id);
  assertEq(afterProfile?.responseCurves?.Leather?.id, profileCurve.id, 'profile curve preserved when preset is already calibrated');
}

// ─── Summary ────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────\n`);
}

void runAll()
  .then(() => {
    setStorageForTest(null);
    resetMaterialLibraryForTest();
    resetDeviceProfilesForTest();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err: unknown) => {
    setStorageForTest(null);
    resetMaterialLibraryForTest();
    resetDeviceProfilesForTest();
    console.error(err);
    process.exit(1);
  });
