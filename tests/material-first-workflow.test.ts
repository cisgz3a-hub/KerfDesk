/**
 * T2-59: material-first settings workflow confidence contracts.
 *
 * Run: npx tsx tests/material-first-workflow.test.ts
 */
import {
  applyMaterialPresetToLayer,
  getPresetById,
  resetMaterialLibraryForTest,
  saveLayerSettingsAsUserPreset,
} from '../src/core/materials/MaterialLibrary';
import {
  markLayerSettingsManualUnverified,
} from '../src/core/materials/MaterialSettingConfidence';
import { createLayer } from '../src/core/scene/Layer';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
    console.error(`      expected: ${String(expected)}`);
    console.error(`      actual:   ${String(actual)}`);
  }
}

function reset(): void {
  resetMaterialLibraryForTest();
  setStorageForTest(new InMemoryStorageAdapter());
}

function run(): void {
  console.log('\n=== T2-59 material-first workflow ===\n');

  {
    reset();
    const preset = getPresetById('preset-birch-3mm');
    const layer = createLayer(0, 'cut', 'Cut');
    const applied = preset ? applyMaterialPresetToLayer(layer, preset) : null;

    assert(applied !== null, 'built-in preset applies to matching layer mode');
    assertEq(applied?.settings.power.max, preset?.operations.cut?.power, 'preset power applied');
    assertEq(applied?.settings.speed, preset?.operations.cut?.speed, 'preset speed applied');
    assertEq(applied?.settings.passes, preset?.operations.cut?.passes, 'preset passes applied');
    assertEq(applied?.settings.settingsConfidence?.source, 'built-in-tested', 'built-in preset marks confidence as built-in-tested');
    assertEq(applied?.settings.settingsConfidence?.tested?.material, 'Plywood', 'confidence records material');
    assertEq(applied?.settings.settingsConfidence?.tested?.operation, 'cut', 'confidence records operation');
  }

  {
    reset();
    const preset = getPresetById('preset-birch-3mm');
    const applied = preset ? applyMaterialPresetToLayer(createLayer(0, 'cut'), preset) : null;
    if (!applied) throw new Error('fixture failed');
    const manuallyEdited = {
      ...applied,
      settings: {
        ...applied.settings,
        power: { ...applied.settings.power, max: applied.settings.power.max - 5 },
      },
    };
    const marked = markLayerSettingsManualUnverified(manuallyEdited);

    assertEq(marked.settings.settingsConfidence?.source, 'manual-unverified', 'manual edit marks confidence as manual-unverified');
    assert(marked.settings.settingsConfidence?.tested === null, 'manual confidence does not claim tested data');
    assert(marked.settings.settingsConfidence?.warning?.includes('Manual') === true, 'manual confidence carries operator warning');
  }

  {
    reset();
    const layer = createLayer(0, 'engrave', 'Photo engrave');
    const edited = markLayerSettingsManualUnverified({
      ...layer,
      settings: {
        ...layer.settings,
        power: { ...layer.settings.power, max: 42 },
        speed: 1234,
        passes: 3,
      },
    });
    const result = saveLayerSettingsAsUserPreset(edited, {
      id: 'preset-user-test-1',
      name: 'My Plywood Engrave',
      material: 'Plywood',
      thickness: '3mm',
      laserWattage: '10W',
    });
    const saved = getPresetById('preset-user-test-1');

    assert(saved !== undefined, 'saving edited layer creates a user preset');
    assertEq(saved?.operations.engrave?.power, 42, 'saved preset carries edited power');
    assertEq(saved?.operations.engrave?.speed, 1234, 'saved preset carries edited speed');
    assertEq(saved?.operations.engrave?.passes, 3, 'saved preset carries edited passes');
    assertEq(result.layer.settings.materialPresetId, 'preset-user-test-1', 'returned layer points at the new preset');
    assertEq(result.layer.settings.settingsConfidence?.source, 'user-saved', 'returned layer marks confidence as user-saved');
  }

  {
    const source = readFileSync('src/ui/components/LayerPanel.tsx', 'utf8');
    assert(source.includes('markSettingsManualUnverified'), 'LayerPanel manual power/speed/pass edits mark confidence unverified');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
