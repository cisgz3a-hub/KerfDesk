/**
 * T1-68 regression test.
 *
 * Bug: the autosave timer in App.tsx called the fire-and-forget
 * `writeAutosave(json)` and then synchronously cleared `sceneIsDirtyRef` and
 * advanced `lastSavedSceneRef`. If the underlying storage write rejected
 * (quota exceeded, fs error, IPC failure), the project was marked clean
 * even though the data never landed — silent data loss.
 *
 * Fix: App.tsx now awaits `writeAutosaveAsync(json)` and only clears the
 * dirty flag / advances `lastSavedSceneRef` on the resolved branch. The
 * rejected branch logs and leaves both refs untouched so the next tick
 * retries.
 *
 * This test mirrors the post-fix timer body and a reasonable approximation
 * of `MutableRefObject<T>` so we can verify ref state after the awaited
 * write resolves or rejects, without standing up React.
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
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
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
 * Mirrors the post-fix App.tsx autosave timer body. Kept structurally close
 * to the source so a future divergence shows up here.
 */
async function runAutosaveTickOnce(
  json: string,
  sceneIsDirtyRef: RefObj<boolean>,
  lastSavedSceneRef: RefObj<string>,
): Promise<void> {
  if (!sceneIsDirtyRef.current) return;

  if (json === lastSavedSceneRef.current) {
    sceneIsDirtyRef.current = false;
    return;
  }

  await writeAutosaveAsync(json).then(
    () => {
      lastSavedSceneRef.current = json;
      sceneIsDirtyRef.current = false;
    },
    (err: unknown) => {
      // Match production behavior: log, leave both refs untouched.
      console.warn('[test] simulated autosave failure (expected):',
        err instanceof Error ? err.message : err);
    },
  );
}

async function run(): Promise<void> {
  console.log('\n=== autosave dirty flag on failure (T1-68) ===\n');

  // ── Contract: writeAutosaveAsync rejects on adapter set failure ────────
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

  // ── Failed write: dirty stays dirty, lastSaved is NOT advanced ─────────
  {
    setStorageForTest(new FailingStorageAdapter());
    resetAutosaveForTest();
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '{"prev":true}' };
    const newJson = '{"new":true}';

    await runAutosaveTickOnce(newJson, sceneIsDirtyRef, lastSavedSceneRef);

    assert(
      sceneIsDirtyRef.current === true,
      'failed autosave leaves sceneIsDirtyRef === true (project stays dirty)',
    );
    assert(
      lastSavedSceneRef.current === '{"prev":true}',
      'failed autosave does NOT advance lastSavedSceneRef to un-persisted JSON',
    );
  }

  // ── Successful write: dirty cleared, lastSaved advanced ────────────────
  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetAutosaveForTest();
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '{"prev":true}' };
    const newJson = '{"new":true}';

    await runAutosaveTickOnce(newJson, sceneIsDirtyRef, lastSavedSceneRef);

    assert(
      sceneIsDirtyRef.current === false,
      'successful autosave clears sceneIsDirtyRef',
    );
    assert(
      lastSavedSceneRef.current === newJson,
      'successful autosave advances lastSavedSceneRef to the persisted JSON',
    );
    assert(
      (await adapter.get('laserforge_autosave')) === newJson,
      'persisted JSON is in storage',
    );
  }

  // ── Retry-after-failure: a follow-up tick with a working adapter saves ─
  {
    const failing = new FailingStorageAdapter();
    setStorageForTest(failing);
    resetAutosaveForTest();
    const sceneIsDirtyRef: RefObj<boolean> = { current: true };
    const lastSavedSceneRef: RefObj<string> = { current: '' };
    const json = '{"retryable":true}';

    await runAutosaveTickOnce(json, sceneIsDirtyRef, lastSavedSceneRef);
    assert(sceneIsDirtyRef.current === true, 'still dirty after first (failed) tick');

    const working = new InMemoryStorageAdapter();
    setStorageForTest(working);
    resetAutosaveForTest();
    await runAutosaveTickOnce(json, sceneIsDirtyRef, lastSavedSceneRef);

    assert(
      sceneIsDirtyRef.current === false,
      'second tick (working adapter) clears dirty flag',
    );
    assert(
      lastSavedSceneRef.current === json,
      'second tick advances lastSavedSceneRef',
    );
    assert(
      (await working.get('laserforge_autosave')) === json,
      'second tick actually persists the JSON',
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
