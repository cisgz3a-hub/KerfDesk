/**
 * T2-111: periodic JobLog checkpointing during running jobs.
 * Pre-T2-111 saves only on idle; if the renderer crashed mid-job
 * the in-memory log was lost. Audit 5C Required Priority 7.
 *
 * Run: npx tsx tests/job-checkpoint.test.ts
 */
import {
  JobLogCheckpointer,
  findOrphanedJobLogs,
  buildOrphanFinalization,
  DEFAULT_CHECKPOINTER_OPTIONS,
  type JobLogLike,
  type CheckpointStorage,
  type CheckpointSchedulerLike,
} from '../src/app/JobLogCheckpoint';
import { VirtualScheduler } from './helpers/VirtualScheduler';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-111 JobLog checkpointing ===\n');

class InMemoryCheckpointStorage implements CheckpointStorage {
  saves: JobLogLike[] = [];
  store: Map<string, JobLogLike> = new Map();
  save(log: JobLogLike): void {
    this.saves.push({ ...log });
    this.store.set(log.id, { ...log });
  }
  list(): JobLogLike[] {
    return [...this.store.values()];
  }
}

void (async () => {

// 1. DEFAULT_CHECKPOINTER_OPTIONS: interval=10000, skipIfNoGrowth=true
{
  assert(DEFAULT_CHECKPOINTER_OPTIONS.intervalMs === 10_000,
    `default interval = 10s (audit recommendation)`);
  assert(DEFAULT_CHECKPOINTER_OPTIONS.skipIfNoGrowth === true,
    `default skipIfNoGrowth=true`);
}

// 2. start: schedules first checkpoint at intervalMs
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100, now: () => sched.now });
  let log: JobLogLike = { id: 'job-1', status: 'running', entries: [] };
  cp.start(() => log);
  assert(cp.isRunning, `isRunning=true after start`);
  // Add an entry so growth is non-zero
  log = { ...log, entries: ['e1'] };
  sched.advanceBy(99);
  assert(storage.saves.length === 0, `before 100ms: 0 saves`);
  sched.advanceBy(1);
  assert(storage.saves.length === 1, `at 100ms: 1 save`);
  cp.stop();
}

// 3. stop: clears the timer
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100 });
  let log: JobLogLike = { id: 'job-1', status: 'running', entries: ['e1'] };
  cp.start(() => log);
  cp.stop();
  log = { ...log, entries: ['e1', 'e2'] };
  sched.advanceBy(500);
  assert(storage.saves.length === 0, `after stop: 0 saves`);
  assert(!cp.isRunning, `isRunning=false`);
}

// 4. start is idempotent
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100 });
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  // Only ONE timer should be running
  let log: JobLogLike = { id: 'job-1', status: 'running', entries: ['e1', 'e2'] };
  // Update so growth fires
  cp.start(() => log);
  sched.advanceBy(100);
  assert(storage.saves.length === 1, `idempotent start: 1 save (got ${storage.saves.length})`);
  cp.stop();
}

// 5. skipIfNoGrowth: subsequent fire is skipped when entries unchanged
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, {
    intervalMs: 100, skipIfNoGrowth: true, now: () => sched.now,
  });
  const log: JobLogLike = { id: 'job-1', status: 'running', entries: ['e1'] };
  cp.start(() => log);
  sched.advanceBy(100);
  assert(storage.saves.length === 1, `first fire: 1 save`);
  sched.advanceBy(100);
  assert(storage.saves.length === 1, `second fire (no growth): SKIPPED`);
  cp.stop();
}

// 6. skipIfNoGrowth=false always saves
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, {
    intervalMs: 100, skipIfNoGrowth: false, now: () => sched.now,
  });
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  sched.advanceBy(300);
  assert(storage.saves.length === 3, `skipIfNoGrowth=false: 3 saves in 300ms`);
  cp.stop();
}

// 7. Status not 'running' → no save
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100 });
  const log: JobLogLike = { id: 'job-1', status: 'completed', entries: ['e1'] };
  cp.start(() => log);
  sched.advanceBy(500);
  assert(storage.saves.length === 0, `status='completed': no checkpoints`);
  cp.stop();
}

// 8. log getter returning null → no save
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100 });
  cp.start(() => null);
  sched.advanceBy(500);
  assert(storage.saves.length === 0, `null log: no checkpoints`);
  cp.stop();
}

// 9. Save stamps lastCheckpointAt
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, {
    intervalMs: 100, now: () => sched.now,
  });
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  sched.advanceBy(100);
  assert(storage.saves[0].lastCheckpointAt === 100,
    `lastCheckpointAt stamped (got ${storage.saves[0].lastCheckpointAt})`);
  cp.stop();
}

// 10. Storage error doesn't break the timer
{
  const sched = new VirtualScheduler();
  const storage: CheckpointStorage = {
    save: () => { throw new Error('storage broken'); },
    list: () => [],
  };
  const cp = new JobLogCheckpointer(sched, storage, {
    intervalMs: 100, skipIfNoGrowth: false,
  });
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  let threw = false;
  try { sched.advanceBy(300); } catch { threw = true; }
  assert(!threw, `storage error swallowed; timer keeps firing`);
  cp.stop();
}

// 11. Promise rejection from save() doesn't crash
{
  const sched = new VirtualScheduler();
  const storage: CheckpointStorage = {
    save: () => Promise.reject(new Error('async fail')),
    list: () => [],
  };
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100, skipIfNoGrowth: false });
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  let threw = false;
  try { sched.advanceBy(300); } catch { threw = true; }
  assert(!threw, `async-rejected save swallowed`);
  cp.stop();
}

// 12. Growth-based: new entries trigger save
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, { intervalMs: 100 });
  let log: JobLogLike = { id: 'job-1', status: 'running', entries: [] };
  cp.start(() => log);
  // No growth: no save
  sched.advanceBy(100);
  assert(storage.saves.length === 0, `empty entries: no save`);
  // Add entry
  log = { ...log, entries: ['e1'] };
  sched.advanceBy(100);
  assert(storage.saves.length === 1, `after growth: 1 save`);
  // Add more
  log = { ...log, entries: ['e1', 'e2', 'e3'] };
  sched.advanceBy(100);
  assert(storage.saves.length === 2, `after more growth: 2 saves`);
  cp.stop();
}

// 13. checkpointStamp introspection
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, {
    intervalMs: 100, now: () => sched.now,
  });
  cp.start(() => ({ id: 'job-1', status: 'running', entries: ['e1'] }));
  sched.advanceBy(100);
  assert(cp.checkpointStamp === 100, `checkpointStamp=100`);
  cp.stop();
}

// 14. findOrphanedJobLogs: filters running-only
{
  const logs: JobLogLike[] = [
    { id: 'a', status: 'completed', entries: [] },
    { id: 'b', status: 'running', entries: ['e1'] },
    { id: 'c', status: 'failed', entries: [] },
    { id: 'd', status: 'running', entries: ['e2'] },
  ];
  const orphans = findOrphanedJobLogs(logs);
  assert(orphans.length === 2, `2 running orphans (got ${orphans.length})`);
  assert(orphans.every((l) => l.status === 'running'),
    `every orphan has status='running'`);
}

// 15. findOrphanedJobLogs: empty list → []
{
  assert(findOrphanedJobLogs([]).length === 0, `empty list → []`);
}

// 16. buildOrphanFinalization: with line counts
{
  const log: JobLogLike = {
    id: 'job-1', status: 'running', entries: ['e1', 'e2'],
    lastCheckpointAt: 1000,
  };
  const f = buildOrphanFinalization({
    log, now: 5000, reachedLineCount: 247, totalLineCount: 1850,
  });
  assert(f.reason === 'unknown_interruption', `reason=unknown_interruption`);
  assert(f.message.includes('line 247 of 1850'),
    `message includes "line 247 of 1850"`);
  assert(f.message.includes('4s ago'),
    `message includes checkpoint age "4s ago"`);
  assert(f.finalizedAt === 5000, `finalizedAt stamped`);
}

// 17. buildOrphanFinalization: without total line count
{
  const log: JobLogLike = { id: 'job-1', status: 'running', entries: [], lastCheckpointAt: 1000 };
  const f = buildOrphanFinalization({ log, now: 2000, reachedLineCount: 50 });
  assert(f.message.includes('line 50') && !f.message.includes('of'),
    `with reached but no total: "line 50" without "of"`);
}

// 18. buildOrphanFinalization: no checkpoint info
{
  const log: JobLogLike = { id: 'job-1', status: 'running', entries: [] };
  const f = buildOrphanFinalization({ log, now: 1000 });
  assert(!f.message.includes('ago'),
    `no lastCheckpointAt: no "ago" in message`);
}

// 19. End-to-end: job runs for 5 ticks, app dies, boot finds the orphan
{
  const sched = new VirtualScheduler();
  const storage = new InMemoryCheckpointStorage();
  const cp = new JobLogCheckpointer(sched, storage, {
    intervalMs: 100, now: () => sched.now,
  });
  let log: JobLogLike = { id: 'job-1', status: 'running', entries: [] };
  cp.start(() => log);
  for (let i = 1; i <= 5; i++) {
    log = { ...log, entries: [...log.entries, `e${i}`] };
    sched.advanceBy(100);
  }
  // App "crashes" — checkpointer never gets a stop() call. The
  // last write is on disk.
  assert(storage.saves.length === 5, `5 checkpoints written`);
  assert(storage.store.get('job-1')?.entries.length === 5,
    `last checkpoint has 5 entries`);
  // App reboots
  const orphans = findOrphanedJobLogs(storage.list());
  assert(orphans.length === 1, `1 orphan found at boot`);
  // Finalize
  const f = buildOrphanFinalization({
    log: orphans[0], now: 10_000,
    reachedLineCount: orphans[0].entries.length,
  });
  assert(f.reason === 'unknown_interruption', `finalized as unknown_interruption`);
  assert(f.message.includes('line 5'),
    `message reflects entries.length`);
  cp.stop();
}

// 20. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/JobLogCheckpoint.ts'), 'utf-8');
  assert(/T2-111/.test(src), 'T2-111 marker in JobLogCheckpoint.ts');
  for (const id of [
    'JobLogLike', 'CheckpointStorage', 'CheckpointSchedulerLike',
    'JobLogCheckpointerOptions', 'DEFAULT_CHECKPOINTER_OPTIONS',
    'JobLogCheckpointer', 'findOrphanedJobLogs',
    'buildOrphanFinalization', 'OrphanFinalization',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  // Doesn't import from tests/
  assert(!src.includes('tests/helpers'),
    `src module does not depend on tests/helpers`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
