/**
 * JobReplay storage adapter migration tests.
 * Run: npx tsx tests/jobreplay-storage-migration.test.ts
 */
import {
  _saveReplayForTest,
  loadReplays,
  resetReplaysForTest,
  saveReplay,
  type JobReplay,
} from '../src/core/replay/JobReplay';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

const REPLAY_KEY_PREFIX = 'laserforge_replay_';

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

function makeReplay(id: string, startedAt: string): JobReplay {
  return {
    id,
    startedAt,
    completedAt: null,
    status: 'running',
    jobName: `job-${id}`,
    totalLines: 10,
    linesCompleted: 0,
    settings: {
      layers: [],
      material: null,
      machineType: null,
    },
    entries: [],
    errors: [],
    warnings: [],
    durationMs: 0,
    estimatedMs: null,
  };
}

async function run(): Promise<void> {
  console.log('\n=== jobreplay storage migration ===\n');

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetReplaysForTest();

    const saveReturn: void = saveReplay(makeReplay('sync-signature', '2026-01-01T00:00:00.000Z'));
    assert(saveReturn === undefined, 'saveReplay stays synchronous (returns void)');

    // Allow fire-and-forget write-through to settle.
    await Promise.resolve();
    const persisted = await adapter.get(`${REPLAY_KEY_PREFIX}sync-signature`);
    assert(persisted !== null, 'saveReplay performs fire-and-forget write-through internally');
  }

  {
    const adapter = new InMemoryStorageAdapter();
    setStorageForTest(adapter);
    resetReplaysForTest();

    for (let i = 0; i < 21; i++) {
      const id = `retention-${i.toString().padStart(2, '0')}`;
      const startedAt = `2026-02-${(i + 1).toString().padStart(2, '0')}T00:00:00.000Z`;
      await _saveReplayForTest(makeReplay(id, startedAt));
    }

    const loaded = await loadReplays();
    assert(loaded.length === 16, 'retention prunes oldest 5 once count exceeds 20');

    const ids = new Set(loaded.map(r => r.id));
    assert(!ids.has('retention-00'), 'pruned oldest replay #1');
    assert(!ids.has('retention-01'), 'pruned oldest replay #2');
    assert(!ids.has('retention-02'), 'pruned oldest replay #3');
    assert(!ids.has('retention-03'), 'pruned oldest replay #4');
    assert(!ids.has('retention-04'), 'pruned oldest replay #5');
    assert(ids.has('retention-20'), 'newest replay is retained');
  }

  {
    const maybePromise = loadReplays();
    assert(maybePromise instanceof Promise, 'loadReplays is async (returns Promise)');
    await maybePromise;
  }

  setStorageForTest(null);
  resetReplaysForTest();
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  setStorageForTest(null);
  resetReplaysForTest();
  console.error(err);
  process.exit(1);
});
