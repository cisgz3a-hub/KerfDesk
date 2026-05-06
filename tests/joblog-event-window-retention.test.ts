/**
 * T2-112: event-window retention. Pre-T2-112 the compactor at
 * `JobLog.ts:69` kept only first 25 + last 25 — for a job that
 * fails at line 500 of 1000, the diagnostic window around 500 was
 * thrown away. Audit 5C Critical 5 + Required Priority 6.
 *
 * Run: npx tsx tests/joblog-event-window-retention.test.ts
 */
import {
  compactWithEventWindow,
  compactEntries,
  isEventEntry,
  estimateCompactionSavings,
  DEFAULT_EVENT_WINDOW_OPTIONS,
  type JobLogEntryLike,
} from '../src/app/JobLogEventWindow';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-112 JobLog event-window retention ===\n');

function rawEntries(count: number, offset = 0): JobLogEntryLike[] {
  return Array.from({ length: count }, (_, i) => ({
    type: i % 2 === 0 ? 'sent' : 'received' as const,
    message: `line ${i + offset}`,
    timestamp: i + offset,
  }));
}

void (async () => {

// 1. DEFAULT_EVENT_WINDOW_OPTIONS pin
{
  assert(DEFAULT_EVENT_WINDOW_OPTIONS.triggerThreshold === 200,
    `triggerThreshold=200 (matches pre-T2-112)`);
  assert(DEFAULT_EVENT_WINDOW_OPTIONS.windowBefore === 100,
    `windowBefore=100 per audit`);
  assert(DEFAULT_EVENT_WINDOW_OPTIONS.windowAfter === 50,
    `windowAfter=50 per audit`);
  assert(DEFAULT_EVENT_WINDOW_OPTIONS.headKeep === 50,
    `headKeep=50 per audit`);
  assert(DEFAULT_EVENT_WINDOW_OPTIONS.tailKeep === 200,
    `tailKeep=200 per audit`);
}

// 2. isEventEntry: classifies milestone/error/warning/info as events
{
  assert(isEventEntry({ type: 'milestone', message: 'm' }), `milestone is event`);
  assert(isEventEntry({ type: 'error', message: 'e' }), `error is event`);
  assert(isEventEntry({ type: 'warning', message: 'w' }), `warning is event`);
  assert(isEventEntry({ type: 'info', message: 'i' }), `info is event`);
  assert(!isEventEntry({ type: 'sent', message: 's' }), `sent is NOT event`);
  assert(!isEventEntry({ type: 'received', message: 'r' }), `received is NOT event`);
}

// 3. Below threshold: no compaction
{
  const entries = rawEntries(150);
  const r = compactWithEventWindow(entries);
  assert(!r.truncated, `150 entries: not compacted`);
  assert(r.entries.length === 150, `all 150 retained`);
  assert(r.droppedCount === 0, `0 dropped`);
}

// 4. THE audit's headline case: 1000-entry job with single error at index 500
{
  const entries: JobLogEntryLike[] = rawEntries(1000);
  entries[500] = { type: 'error', message: 'job alarm', timestamp: 500 };
  const r = compactWithEventWindow(entries);
  assert(r.truncated, `>200 with event: compacted`);
  // Indices 400-550 should ALL be in the kept set (window 100 before, 50 after,
  // plus the event itself at 500)
  for (let i = 400; i <= 550; i++) {
    assert(r.keptIndices.includes(i),
      `index ${i} preserved (within event window of error at 500)`);
  }
  // Event itself is in the result
  const errorEntry = r.entries.find((e) => e.type === 'error');
  assert(errorEntry?.message === 'job alarm', `error entry preserved`);
  assert(r.eventCount === 1, `1 event counted`);
}

// 5. Multiple errors → multiple windows preserved
{
  const entries: JobLogEntryLike[] = rawEntries(1000);
  entries[200] = { type: 'error', message: 'err 200', timestamp: 200 };
  entries[500] = { type: 'error', message: 'err 500', timestamp: 500 };
  entries[800] = { type: 'error', message: 'err 800', timestamp: 800 };
  const r = compactWithEventWindow(entries);
  assert(r.eventCount === 3, `3 events counted`);
  // Each window: [event-100, event+50]
  for (const event of [200, 500, 800]) {
    for (let i = event - 100; i <= event + 50; i++) {
      assert(r.keptIndices.includes(i),
        `index ${i} preserved (event ${event} window)`);
    }
  }
}

// 6. Head context preserved (first 50)
{
  const entries: JobLogEntryLike[] = rawEntries(1000);
  entries[800] = { type: 'error', message: 'late error', timestamp: 800 };
  const r = compactWithEventWindow(entries);
  for (let i = 0; i < 50; i++) {
    assert(r.keptIndices.includes(i), `head index ${i} preserved`);
  }
}

// 7. Tail context preserved (last 200)
{
  const entries: JobLogEntryLike[] = rawEntries(1000);
  entries[100] = { type: 'error', message: 'early error', timestamp: 100 };
  const r = compactWithEventWindow(entries);
  for (let i = 800; i < 1000; i++) {
    assert(r.keptIndices.includes(i), `tail index ${i} preserved`);
  }
}

// 8. No events → just head + tail kept
{
  const entries = rawEntries(1000);
  const r = compactWithEventWindow(entries);
  assert(r.eventCount === 0, `no events`);
  // First 50 + last 200 = 250 indices kept
  assert(r.keptIndices.length === 250,
    `head 50 + tail 200 = 250 (got ${r.keptIndices.length})`);
}

// 9. Indices are sorted ascending in result
{
  const entries: JobLogEntryLike[] = rawEntries(500);
  entries[100] = { type: 'error', message: 'e', timestamp: 100 };
  entries[300] = { type: 'warning', message: 'w', timestamp: 300 };
  const r = compactWithEventWindow(entries);
  for (let i = 1; i < r.keptIndices.length; i++) {
    assert(r.keptIndices[i] > r.keptIndices[i - 1],
      `keptIndices monotonically ascending at ${i}`);
  }
}

// 10. Output entries align with kept indices
{
  const entries: JobLogEntryLike[] = rawEntries(500);
  entries[300] = { type: 'milestone', message: 'half done', timestamp: 300 };
  const r = compactWithEventWindow(entries);
  // Each output entry is the original input at the corresponding kept index
  for (let i = 0; i < r.entries.length; i++) {
    assert(r.entries[i] === entries[r.keptIndices[i]],
      `output[${i}] === input[keptIndices[${i}]]`);
  }
}

// 11. Custom options — small windows for tests that want minimal output
{
  const entries: JobLogEntryLike[] = rawEntries(50);
  // Force compaction by lowering threshold
  entries[25] = { type: 'error', message: 'mid', timestamp: 25 };
  const r = compactWithEventWindow(entries, {
    triggerThreshold: 30, windowBefore: 5, windowAfter: 5,
    headKeep: 5, tailKeep: 5,
  });
  assert(r.truncated, `triggered`);
  // Window: [20, 30] + head [0, 5) + tail [45, 50)
  for (let i = 20; i <= 30; i++) {
    assert(r.keptIndices.includes(i), `window index ${i}`);
  }
  for (let i = 0; i < 5; i++) {
    assert(r.keptIndices.includes(i), `head index ${i}`);
  }
}

// 12. Window clamped to array bounds
{
  const entries: JobLogEntryLike[] = rawEntries(300);
  // Error AT index 0 (very start) — windowBefore=100 would go negative
  entries[0] = { type: 'error', message: 'start', timestamp: 0 };
  const r = compactWithEventWindow(entries);
  assert(r.keptIndices[0] === 0, `index 0 still preserved (clamped)`);
  assert(r.entries[0].message === 'start',
    `event at index 0 carried`);
}

// 13. Window clamped at high end
{
  const entries: JobLogEntryLike[] = rawEntries(300);
  // Error at last index — windowAfter would go past array length
  entries[299] = { type: 'error', message: 'end', timestamp: 299 };
  const r = compactWithEventWindow(entries);
  assert(r.keptIndices[r.keptIndices.length - 1] === 299,
    `last index preserved`);
}

// 14. compactEntries: convenience — just the array
{
  const entries: JobLogEntryLike[] = rawEntries(500);
  entries[250] = { type: 'error', message: 'e', timestamp: 250 };
  const out = compactEntries(entries);
  assert(Array.isArray(out), `returns plain array`);
  assert(out.length > 0 && out.length < entries.length,
    `compacted to fewer than input`);
}

// 15. Input not mutated
{
  const entries: JobLogEntryLike[] = rawEntries(500);
  entries[250] = { type: 'error', message: 'e', timestamp: 250 };
  const before = entries.length;
  compactWithEventWindow(entries);
  assert(entries.length === before, `input array length unchanged`);
}

// 16. estimateCompactionSavings
{
  const entries = rawEntries(1000);
  const est = estimateCompactionSavings(entries);
  assert(est.droppedCount > 0, `non-zero drop`);
  assert(est.estimatedBytesSaved === est.droppedCount * 80,
    `~80 bytes per dropped entry`);
}

// 17. estimateCompactionSavings: below threshold = 0
{
  const est = estimateCompactionSavings(rawEntries(150));
  assert(est.droppedCount === 0, `under threshold: 0 dropped`);
}

// 18. Realistic pattern: long job with one alarm at 67%
{
  const total = 1850;
  const alarmAt = Math.floor(total * 0.67);   // ~1240
  const entries: JobLogEntryLike[] = rawEntries(total);
  entries[alarmAt] = { type: 'error', message: 'alarm 1', timestamp: alarmAt };
  const r = compactWithEventWindow(entries);
  assert(r.truncated, `compacted`);
  // The window around the alarm IS preserved
  for (let i = alarmAt - 100; i <= alarmAt + 50; i++) {
    assert(r.keptIndices.includes(i),
      `realistic-pattern: index ${i} (around alarm) preserved`);
  }
}

// 19. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/JobLogEventWindow.ts'), 'utf-8');
  assert(/T2-112/.test(src), 'T2-112 marker in JobLogEventWindow.ts');
  for (const id of [
    'JobLogEntryType', 'JobLogEntryLike', 'isEventEntry',
    'EventWindowOptions', 'DEFAULT_EVENT_WINDOW_OPTIONS',
    'CompactionResult', 'compactWithEventWindow', 'compactEntries',
    'estimateCompactionSavings',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
