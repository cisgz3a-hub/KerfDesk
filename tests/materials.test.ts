/**
 * Material preset library: defaults, persistence, import/export.
 * Run: npx tsx tests/materials.test.ts
 */

import { getDefaultMaterialPresets, isDefaultMaterialPresetId } from '../src/core/materials/defaultPresets';
import {
  deletePreset,
  exportPresets,
  getPresets,
  importPresets,
  savePreset,
} from '../src/core/materials/MaterialLibrary';
import type { MaterialPreset } from '../src/core/materials/MaterialPreset';

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
      const keys = Object.keys(memoryStore);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete memoryStore[key];
    },
    setItem(key: string, value: string): void {
      memoryStore[key] = value;
    },
  } as Storage;
}

installMockLocalStorage();

console.log('\n=== Material presets: defaults ===');

const defaults = getDefaultMaterialPresets();
assert(defaults.length === 10, 'defaultPresets returns 10 presets');

for (const p of defaults) {
  const ops = p.operations;
  const has =
    ops.cut != null || ops.engrave != null || ops.score != null;
  assert(has, `preset "${p.id}" has at least one operation`);
}

console.log('\n=== Material presets: savePreset / getPresets ===');

memoryStore['laserforge-material-presets'] = '[]';
const beforeUser = getPresets().filter(p => !isDefaultMaterialPresetId(p.id));
assert(beforeUser.length === 0, 'clean storage has no user presets');

const userPreset: MaterialPreset = {
  id: 'preset-user-test-one',
  name: 'Test Preset',
  material: 'TestMat',
  thickness: '1mm',
  laserWattage: '10W',
  operations: { cut: { power: 12, speed: 300, passes: 1 } },
};

savePreset(userPreset);
const merged = getPresets();
assert(merged.length === 11, 'getPresets merges user preset with defaults');
const round = merged.find(p => p.id === 'preset-user-test-one');
assert(round?.operations.cut?.power === 12, 'savePreset/getPresets round-trips power');
assert(round?.operations.cut?.speed === 300, 'savePreset/getPresets round-trips speed');

console.log('\n=== Material presets: exportPresets / importPresets ===');

const exported = exportPresets();
const parsed = JSON.parse(exported) as unknown;
assert(Array.isArray(parsed) && parsed.length === 1, 'exportPresets returns JSON array of user presets');

memoryStore['laserforge-material-presets'] = '[]';
const imported = importPresets(exported);
assert(imported.length === 1, 'importPresets returns imported presets');
const afterImport = getPresets().find(p => p.id === 'preset-user-test-one');
assert(afterImport != null, 'importPresets persists user preset');

console.log('\n=== Material presets: deletePreset ===');

deletePreset('preset-user-test-one');
assert(getPresets().every(p => p.id !== 'preset-user-test-one'), 'deletePreset removes user preset');

const defaultCount = getDefaultMaterialPresets().length;
deletePreset('preset-birch-3mm');
assert(getPresets().length === defaultCount, 'deletePreset does not remove defaults');

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) throw new Error(`materials.test.ts: ${failed} assertion(s) failed`);
