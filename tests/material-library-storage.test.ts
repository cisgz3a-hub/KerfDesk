/**
 * MaterialLibrary storage adapter + cache tests.
 * Run: npx tsx tests/material-library-storage.test.ts
 */
import type { MaterialPreset } from '../src/core/materials/MaterialPreset';
import {
  deletePreset,
  getPresets,
  initializeMaterialLibrary,
  resetMaterialLibraryForTest,
  savePreset,
} from '../src/core/materials/MaterialLibrary';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { getStorage, setStorageForTest } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge-material-presets';

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

async function run(): Promise<void> {
  console.log('\n=== material library storage ===\n');
  installMockLocalStorage();

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetMaterialLibraryForTest();

    const legacy: MaterialPreset[] = [{
      id: 'preset-legacy-lib',
      name: 'Legacy',
      material: 'M',
      thickness: '1mm',
      laserWattage: '10W',
      operations: { cut: { power: 50, speed: 100, passes: 1 } },
    }];
    memoryStore[STORAGE_KEY] = JSON.stringify(legacy);

    await initializeMaterialLibrary();
    assert(memoryStore[STORAGE_KEY] == null, 'migration clears legacy localStorage key');
    const raw = await adapter.get(STORAGE_KEY);
    assert(raw !== null && raw.includes('preset-legacy-lib'), 'adapter holds migrated presets');

    const merged = getPresets().filter(p => p.id === 'preset-legacy-lib');
    assert(merged.length === 1, 'getPresets sees migrated user preset');
  }

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetMaterialLibraryForTest();
    await initializeMaterialLibrary();

    const userPreset: MaterialPreset = {
      id: 'preset-user-lib-1',
      name: 'Lib Test',
      material: 'Mat',
      thickness: '2mm',
      laserWattage: '10W',
      operations: { cut: { power: 12, speed: 300, passes: 1 } },
    };
    savePreset(userPreset);
    await Promise.resolve();
    const stored = await adapter.get(STORAGE_KEY);
    assert(stored != null && stored.includes('preset-user-lib-1'), 'savePreset write-through persists');

    const list = getPresets();
    assert(list.some(p => p.id === 'preset-user-lib-1'), 'getPresets includes saved preset');

    deletePreset('preset-user-lib-1');
    await Promise.resolve();
    const afterDel = await adapter.get(STORAGE_KEY);
    assert(afterDel === '[]' || (afterDel != null && !afterDel.includes('preset-user-lib-1')), 'deletePreset persists removal');
  }

  setStorageForTest(null);
  resetMaterialLibraryForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetMaterialLibraryForTest();
  console.error(err);
  process.exit(1);
});
