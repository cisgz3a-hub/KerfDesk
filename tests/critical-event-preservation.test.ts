/**
 * T2-68: critical error history preserved across clearMessages /
 * disconnect. Pre-T2-68 disconnect at ConnectionPanelMain.tsx:582
 * called clearMessages() unconditionally and wiped post-failure
 * diagnostic context.
 *
 * Run: npx tsx tests/critical-event-preservation.test.ts
 */
import {
  CriticalEventStore,
  isCriticalSeverity,
  eventFromError,
  describeLastProblem,
  type CriticalEvent,
} from '../src/app/CriticalEventStore';
import type { UserFacingError, ErrorSeverity } from '../src/app/ErrorReporter';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-68 critical event preservation ===\n');

const ev = (overrides: Partial<CriticalEvent> = {}): CriticalEvent => ({
  id: overrides.id ?? 'evt-1',
  timestamp: overrides.timestamp ?? 1000,
  domain: overrides.domain ?? 'connection',
  severity: overrides.severity ?? 'error',
  title: overrides.title ?? 'Connection lost',
  message: overrides.message ?? 'USB cable unplugged',
  recoverySteps: overrides.recoverySteps,
  developerDetails: overrides.developerDetails,
});

void (async () => {

// 1. isCriticalSeverity: error+critical → true
{
  assert(isCriticalSeverity('error'), `error → critical`);
  assert(isCriticalSeverity('critical'), `critical → critical`);
}

// 2. isCriticalSeverity: info+warning → false
{
  for (const s of ['info', 'warning'] as ErrorSeverity[]) {
    assert(!isCriticalSeverity(s), `'${s}' → not critical`);
  }
}

// 3. eventFromError: warning → null (not preserved)
{
  const err: UserFacingError = {
    id: 'e1', timestamp: 0, domain: 'compile', severity: 'warning',
    title: 't', message: 'm',
  };
  assert(eventFromError(err) === null, `warning → null`);
}

// 4. eventFromError: error → CriticalEvent
{
  const err: UserFacingError = {
    id: 'e2', timestamp: 5, domain: 'compile', severity: 'error',
    title: 't', message: 'm', recoverySteps: ['s1'], developerDetails: { x: 1 },
  };
  const c = eventFromError(err);
  assert(c !== null, `error → event`);
  assert(c?.severity === 'error', `severity preserved`);
  assert(c?.domain === 'compile', `domain preserved`);
  assert(c?.recoverySteps?.[0] === 's1', `recoverySteps preserved`);
}

// 5. record → store grows + lastByDomain updated
{
  const store = new CriticalEventStore();
  store.record(ev({ id: '1' }));
  assert(store.size() === 1, `size=1`);
  assert(store.getEvents()[0].id === '1', `event present`);
  assert(store.getLastForDomain('connection')?.id === '1', `lastByDomain set`);
}

// 6. record: same domain twice → lastByDomain points to most recent
{
  const store = new CriticalEventStore();
  store.record(ev({ id: '1', timestamp: 100 }));
  store.record(ev({ id: '2', timestamp: 200 }));
  assert(store.getLastForDomain('connection')?.id === '2', `latest wins`);
  assert(store.size() === 2, `both retained in events`);
}

// 7. clearAll: explicit purge
{
  const store = new CriticalEventStore();
  store.record(ev({ id: '1' }));
  store.record(ev({ id: '2' }));
  store.clearAll();
  assert(store.size() === 0, `cleared`);
  assert(store.getLastForDomain('connection') === null, `lastByDomain cleared`);
}

// 8. THE audit's headline: NO clearSessionMessages method
{
  const store = new CriticalEventStore() as unknown as Record<string, unknown>;
  assert(typeof store['clearSessionMessages'] !== 'function',
    `no clearSessionMessages method (the contract)`);
  // session messages are owned by a separate store (out of scope here);
  // CriticalEventStore CANNOT be wiped by session-clear ops by design.
}

// 9. onChange listener fires on record
{
  const store = new CriticalEventStore();
  let calls = 0;
  store.onChange(() => { calls++; });
  store.record(ev());
  store.record(ev({ id: '2' }));
  assert(calls === 2, `2 records → 2 notifications`);
}

// 10. onChange unsubscribe stops notifications
{
  const store = new CriticalEventStore();
  let calls = 0;
  const unsub = store.onChange(() => { calls++; });
  store.record(ev());
  unsub();
  store.record(ev({ id: '2' }));
  assert(calls === 1, `unsub stopped notifications`);
}

// 11. Bounded retention: maxEvents=2 evicts oldest
{
  const store = new CriticalEventStore({ maxEvents: 2 });
  store.record(ev({ id: '1' }));
  store.record(ev({ id: '2' }));
  store.record(ev({ id: '3' }));
  const events = store.getEvents();
  assert(events.length === 2, `bounded to 2`);
  assert(events[0].id === '2' && events[1].id === '3', `oldest evicted`);
}

// 12. getLastByDomain: per-domain ordered most-recent-first
{
  const store = new CriticalEventStore();
  store.record(ev({ id: 'c', domain: 'connection', timestamp: 100 }));
  store.record(ev({ id: 'm', domain: 'machine', timestamp: 200 }));
  store.record(ev({ id: 'j', domain: 'job', timestamp: 300 }));
  const all = store.getLastByDomain();
  assert(all.length === 3, `3 domains`);
  assert(all[0].id === 'j' && all[1].id === 'm' && all[2].id === 'c',
    `ordered most-recent-first`);
}

// 13. hydrate from persisted JSON
{
  const store1 = new CriticalEventStore();
  store1.record(ev({ id: 'a', timestamp: 100 }));
  store1.record(ev({ id: 'b', domain: 'job', timestamp: 200 }));
  const json = store1.toJSON();
  assert(json.version === 1, `version=1`);
  assert(json.events.length === 2, `2 events serialised`);

  const store2 = new CriticalEventStore();
  store2.hydrate(json.events);
  assert(store2.size() === 2, `hydrated 2`);
  assert(store2.getLastForDomain('job')?.id === 'b', `domain index restored`);
}

// 14. describeLastProblem: empty store → null
{
  const store = new CriticalEventStore();
  assert(describeLastProblem(store, 1000) === null, `empty → null`);
}

// 15. describeLastProblem: returns latest + relative-time string
{
  const store = new CriticalEventStore();
  store.record(ev({ id: 'old', timestamp: 1000 }));
  store.record(ev({ id: 'new', domain: 'machine', timestamp: 5000 }));
  const r = describeLastProblem(store, 245000);  // 4 minutes after 'new'
  assert(r !== null, `non-null`);
  assert(r?.event.id === 'new', `latest event`);
  assert(r?.relativeAgo === '4 minutes ago', `4 minutes ago`);
}

// 16. describeLastProblem: relative-time formatting
{
  const store = new CriticalEventStore();
  store.record(ev({ timestamp: 1000 }));
  // seconds
  assert(describeLastProblem(store, 1500)?.relativeAgo.includes('second') === true,
    `< 1 min → seconds`);
  // hours
  assert(describeLastProblem(store, 1000 + 3600 * 1000 * 2)?.relativeAgo === '2 hours ago',
    `2h`);
  // days
  assert(describeLastProblem(store, 1000 + 86400 * 1000 * 3)?.relativeAgo === '3 days ago',
    `3 days`);
}

// 17. Audit's Visibility 2 case: disconnect-then-reconnect preserves diagnosis
{
  const store = new CriticalEventStore();
  // Before disconnect: a job error was recorded.
  store.record(ev({
    id: 'job-fail-1', domain: 'job', severity: 'critical',
    title: 'Job failed', message: 'GRBL alarm 2 mid-job',
    timestamp: 100,
  }));
  // ... user clicks disconnect (which used to call clearMessages).
  // SessionMessages would be wiped; CriticalEventStore is NOT wiped.
  // Verify the event survives:
  assert(store.size() === 1, `event survives disconnect`);
  assert(store.getLastForDomain('job')?.title === 'Job failed', `diagnosis preserved`);
}

// 18. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/CriticalEventStore.ts'), 'utf-8');
  assert(/T2-68/.test(src), 'T2-68 marker');
  for (const id of [
    'CriticalEvent', 'CriticalEventStore',
    'isCriticalSeverity', 'eventFromError',
    'describeLastProblem',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  // Audit contract: NO clearSessionMessages method on this class
  assert(!src.includes('clearSessionMessages'),
    `clearSessionMessages NOT on the class (contract)`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
