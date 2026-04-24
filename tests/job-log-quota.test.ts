/**
 * JobLog localStorage: quota handling, compaction, trim count.
 * Run: npx tsx tests/job-log-quota.test.ts
 */
import {
  saveJobLog,
  getJobLogs,
  clearJobLogs,
  compactJobLogForStorage,
  type JobLog,
  type JobLogEntry,
} from '../src/core/job/JobLog';

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

const mem: Record<string, string> = {};

function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return Object.keys(mem).length;
    },
    clear(): void {
      for (const k of Object.keys(mem)) delete mem[k];
    },
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
    },
    key(index: number): string | null {
      const keys = Object.keys(mem);
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      delete mem[key];
    },
    setItem(key: string, value: string): void {
      mem[key] = value;
    },
  } as Storage;
}

function baseLog(overrides: Partial<JobLog> = {}): JobLog {
  return {
    id: `job_${Math.random().toString(36).slice(2)}`,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'completed',
    projectName: 'P',
    gcodeLines: 1,
    estimatedTime: '1m',
    layers: [],
    machineStatus: 'idle',
    startPosition: { x: 0, y: 0 },
    entries: [],
    linesCompleted: 1,
    errors: 0,
    warnings: 0,
    actualDuration: 1000,
    ...overrides,
  };
}

void (async () => {
  console.log('\n=== job-log quota + compaction ===');
  installMockLocalStorage();
  for (const k of Object.keys(mem)) delete mem[k];

  {
    let setItemCalls: string[] = [];
    let setItemN = 0;
    const orig = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    (globalThis.localStorage as Storage).setItem = (key: string, value: string) => {
      setItemN++;
      if (setItemN === 1) {
        const e = new Error('The quota has been exceeded.');
        e.name = 'QuotaExceededError';
        throw e;
      }
      setItemCalls.push(value);
      orig(key, value);
    };
    const log = baseLog({ id: 'emerg', entries: [{ timestamp: 1, type: 'milestone', message: 'm' }, { timestamp: 2, type: 'sent', message: 's' }] });
    const r = saveJobLog(log);
    (globalThis.localStorage as Storage).setItem = orig;
    assert(r.ok === true, 'quota then ok → ok true');
    assert(r.error === 'quota' && r.message != null, 'emergency path sets quota + message');
    const parsed = JSON.parse(setItemCalls[setItemCalls.length - 1]) as JobLog[];
    assert(parsed.length === 1 && parsed[0].id === 'emerg', 'emergency save is single log');
  }

  for (const k of Object.keys(mem)) delete mem[k];
  {
    let n = 0;
    const orig = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    (globalThis.localStorage as Storage).setItem = () => {
      n++;
      const e = new Error('q');
      e.name = 'QuotaExceededError';
      throw e;
    };
    const r = saveJobLog(baseLog());
    (globalThis.localStorage as Storage).setItem = orig;
    assert(r.ok === false && r.error === 'quota', 'double quota → ok false');
    assert(
      (r.message ?? '').toLowerCase().includes('could not be saved'),
      'failed message is user-facing',
    );
  }

  for (const k of Object.keys(mem)) delete mem[k];
  clearJobLogs();
  {
    const log = baseLog();
    const r = saveJobLog(log);
    assert(r.ok === true && r.message == null, 'happy path: ok, no message');
    assert(getJobLogs().length === 1, 'one log in storage');
  }

  {
    const entries: JobLogEntry[] = [];
    for (let i = 0; i < 150; i++) {
      entries.push({ timestamp: i, type: 'sent', message: `s${i}` });
    }
    for (let i = 0; i < 100; i++) {
      entries.push({ timestamp: 200 + i, type: 'received', message: `r${i}` });
    }
    for (let i = 0; i < 50; i++) {
      entries.push({ timestamp: 400 + i, type: 'milestone', message: `m${i}` });
    }
    const log = baseLog({ entries });
    const c = compactJobLogForStorage(log);
    const milestones = c.entries.filter(e => e.type === 'milestone');
    const sent = c.entries.filter(e => e.type === 'sent');
    const received = c.entries.filter(e => e.type === 'received');
    assert(milestones.length === 50, 'all milestones kept');
    assert(sent.length === 25, '25 first sent');
    assert(received.length === 25, '25 last received');
    assert(c.entries.length <= 100, `total <= 100 (got ${c.entries.length})`);
  }

  for (const k of Object.keys(mem)) delete mem[k];
  {
    const older: JobLog[] = [];
    for (let i = 0; i < 10; i++) {
      older.push(
        baseLog({
          id: `old${i}`,
          startedAt: new Date(Date.now() - (i + 1) * 1000).toISOString(),
          entries: [{ timestamp: 1, type: 'info', message: 'i' }],
        }),
      );
    }
    mem.laserforge_job_logs = JSON.stringify(older);
    const newest = baseLog({ id: 'newest', entries: [{ timestamp: 1, type: 'sent', message: 'x' }] });
    saveJobLog(newest);
    const out = getJobLogs();
    assert(out.length === 5, 'trim to 5 logs (was 10 + 1 new)');
    assert(out[0].id === 'newest', 'newest first');
  }

  for (const k of Object.keys(mem)) delete mem[k];
  {
    const oldTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const oldLog = baseLog({
      id: 'stale',
      startedAt: oldTime,
      entries: [
        { timestamp: 1, type: 'milestone', message: 'ms' },
        { timestamp: 2, type: 'sent', message: 's1' },
        { timestamp: 3, type: 'error', message: 'e' },
        { timestamp: 4, type: 'warning', message: 'w' },
        { timestamp: 5, type: 'info', message: 'noise' },
      ],
    });
    mem.laserforge_job_logs = JSON.stringify([oldLog]);
    const fresh = baseLog({
      id: 'fresh',
      startedAt: new Date().toISOString(),
      entries: [
        { timestamp: 9, type: 'sent', message: 's' },
        { timestamp: 10, type: 'info', message: 'i' },
      ],
    });
    saveJobLog(fresh);
    const out = getJobLogs();
    assert(out[0].id === 'fresh' && out[0].entries.length === 2, 'newest log keeps all entries');
    const aged = out.find(l => l.id === 'stale');
    assert(aged != null, 'stale log still present');
    const types = new Set(aged!.entries.map(e => e.type));
    assert(!types.has('info') && !types.has('sent'), 'aged log drops sent/info');
    assert(types.has('milestone') && types.has('error') && types.has('warning'), 'keeps m/w/e');
  }

  if (failed > 0) process.exit(1);
  process.stdout.write(`\nJob log tests: ${passed} passed\n`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
