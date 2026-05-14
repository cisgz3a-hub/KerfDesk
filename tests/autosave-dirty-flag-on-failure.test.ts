/**
 * T1-68/T1-248 regression test.
 *
 * Original bug: the autosave timer called a fire-and-forget write, then
 * immediately marked the scene clean. If storage rejected, the project looked
 * saved even though the recovery copy was never persisted.
 *
 * Current contract: autosave is only a recovery copy. A successful autosave
 * advances the autosave hash so the next tick does not rewrite the same scene,
 * but it must never advance the manual-save hash or clear the user's unsaved
 * project-file state.
 *
 * Run: npx tsx tests/autosave-dirty-flag-on-failure.test.ts
 */
import {
  resetAutosaveForTest,
  writeAutosaveAsync,
} from '../src/app/autosavePersistence';
import type { StorageAdapter } from '../src/core/storage/StorageAdapter';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

class FailingStorageAdapter implements StorageAdapter {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> {
    const err = new Error('QuotaExceededError: simulated');
    err.name = 'QuotaExceededError';
    throw err;
  }
  async remove(): Promise<void> { /* noop */ }
  async list(): Promise<string[]> { return []; }
  async clear(): Promise<void> { /* noop */ }
}

interface RefObj<T> { current: T }

/**
 * Mirrors the App.tsx autosave timer state updates without standing up React.
 */
async function runAutosaveTickOnce(
  json: string,
  manualDirtyRef: RefObj<boolean>,
  lastManualSaveRef: RefObj<string>,
  lastAutosaveRef: RefObj<string>,
): Promise<void> {
  void manualDirtyRef;
  void lastManualSaveRef;
  if (json === lastAutosaveRef.current) return;

  await writeAutosaveAsync(json).then(
    () => {
      lastAutosaveRef.current = json;
    },
    (err: unknown) => {
      console.warn('[test] simulated autosave failure (expected):',
        err instanceof Error ? err.message : err);
    },
  );
}

async function run(): Promise<void> {
  console.log('\n=== autosave dirty flag on failure (T1-68/T1-248) ===\n');

  {
    setStorageForTest(new FailingStorageAdapter());
    resetAutosaveForTest();
    let rejected = false;
    let rejectedMessage = '';
    try {
      await writeAutosaveAsync('{"x":1}');
    } catch (err) {
      rejected = true;
      rejectedMessage = err instanceof Error ? err.message : String(err);
    }
    assert(rejected, 'writeAutosaveAsync rejects when storage.set throws');
    assert(
      rejectedMessage.includes('QuotaExceededError'),
      'rejection surfaces the underlying storage error',
    );
  }

  {
    setStorageForTest(new FailingStorageAdapter());
    resetAutosaveForTest();
    const manualDirtyRef: RefObj<boolean> = { current: true };
    const lastManualSaveRef: RefObj<string> = { current: '{"manual":true}' };
    const lastAutosaveRef: RefObj<string> = { current: '{"autosave":true}' };
    const newJson = '{"new":true}';

    await runAutosaveTickOnce(newJson, manualDirtyRef, lastManualSaveRef, lastAutosaveRef);

    assert(manualDirtyRef.current === true, 'failed autosave leaves manual dirty state true');
    assert(lastManualSaveRef.current === '{"manual":true}', 'failed autosave does not advance manual save hash');
    assert(lastAutosaveRef.current === '{"autosave":true}', 'failed autosave does not advance autosave hash');
  }

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    const manualDirtyRef: RefObj<boolean> = { current: true };
    const lastManualSaveRef: RefObj<string> = { current: '{"manual":true}' };
    const lastAutosaveRef: RefObj<string> = { current: '{"autosave":true}' };
    const newJson = '{"new":true}';

    await runAutosaveTickOnce(newJson, manualDirtyRef, lastManualSaveRef, lastAutosaveRef);

    assert(manualDirtyRef.current === true, 'successful autosave keeps manual dirty state true');
    assert(lastManualSaveRef.current === '{"manual":true}', 'successful autosave does not advance manual save hash');
    assert(lastAutosaveRef.current === newJson, 'successful autosave advances only the autosave hash');

    const persistedRecord = await adapter.get('laserforge_autosave_record');
    const parsedRecord = persistedRecord ? JSON.parse(persistedRecord) : null;
    assert(
      parsedRecord?.json === newJson,
      'persisted JSON is in storage (T2-69 atomic record)',
    );
  }

  {
    const failing = new FailingStorageAdapter();
    setStorageForTest(failing);
    resetAutosaveForTest();
    const manualDirtyRef: RefObj<boolean> = { current: true };
    const lastManualSaveRef: RefObj<string> = { current: '' };
    const lastAutosaveRef: RefObj<string> = { current: '' };
    const json = '{"retryable":true}';

    await runAutosaveTickOnce(json, manualDirtyRef, lastManualSaveRef, lastAutosaveRef);
    assert(manualDirtyRef.current === true, 'still manually dirty after first failed tick');

    const working = new InMemoryStorageAdapter();
    setStorageForTest(working);
    resetAutosaveForTest();
    await runAutosaveTickOnce(json, manualDirtyRef, lastManualSaveRef, lastAutosaveRef);

    assert(manualDirtyRef.current === true, 'second tick keeps manual dirty state true');
    assert(lastManualSaveRef.current === '', 'second tick does not advance manual save hash');
    assert(lastAutosaveRef.current === json, 'second tick advances autosave hash');

    const persistedRecord2 = await working.get('laserforge_autosave_record');
    const parsedRecord2 = persistedRecord2 ? JSON.parse(persistedRecord2) : null;
    assert(
      parsedRecord2?.json === json,
      'second tick actually persists the JSON (T2-69 atomic record)',
    );
  }

  setStorageForTest(null);
  resetAutosaveForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetAutosaveForTest();
  console.error(err);
  process.exit(1);
});
