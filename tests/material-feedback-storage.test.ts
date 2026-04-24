/**
 * MaterialFeedback storage tests.
 * Run: npx tsx tests/material-feedback-storage.test.ts
 */
import {
  getMaterialHistory,
  getSuggestion,
  recordMaterialOutcome,
  resetMaterialFeedbackForTest,
  type MaterialRecord,
} from '../src/core/materials/MaterialFeedback';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_material_feedback';

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
  console.log('\n=== material feedback storage ===\n');
  installMockLocalStorage();

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetMaterialFeedbackForTest();

    const legacy: MaterialRecord[] = [{
      material: 'Ply',
      machineType: 'diode',
      mode: 'cut',
      power: 80,
      speed: 200,
      passes: 1,
      outcome: 'perfect',
      timestamp: '2026-01-01T00:00:00.000Z',
    }];
    memoryStore[STORAGE_KEY] = JSON.stringify(legacy);

    const s = await getSuggestion('Ply', 'diode', 'cut');
    assert(s !== null && s.power === 80, 'getSuggestion async reads migrated data');
    assert(memoryStore[STORAGE_KEY] == null, 'migration clears legacy localStorage');
  }

  {
    for (const k of Object.keys(memoryStore)) delete memoryStore[k];
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetMaterialFeedbackForTest();

    const syncRet: void = recordMaterialOutcome({
      material: 'Oak',
      machineType: 'diode',
      mode: 'engrave',
      power: 40,
      speed: 1000,
      passes: 1,
      outcome: 'perfect',
      timestamp: '2026-02-01T00:00:00.000Z',
    });
    assert(syncRet === undefined, 'recordMaterialOutcome stays sync externally');
    await new Promise<void>(r => {
      setTimeout(r, 0);
    });
    const raw = await adapter.get(STORAGE_KEY);
    assert(raw != null && raw.includes('Oak'), 'fire-and-forget persist writes storage');

    const empty = await getSuggestion('None', 'diode', 'cut');
    assert(empty === null, 'getSuggestion returns null when no records');

    const hist = await getMaterialHistory('Oak', 'diode');
    assert(hist.length === 1 && hist[0]!.material === 'Oak', 'getMaterialHistory filters async');
  }

  setStorageForTest(null);
  resetMaterialFeedbackForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetMaterialFeedbackForTest();
  console.error(err);
  process.exit(1);
});
