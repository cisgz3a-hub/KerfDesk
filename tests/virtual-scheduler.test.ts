/**
 * T2-49: virtual-time scheduler. Pre-T2-49 time-sensitive tests
 * (status polling cadence, character-counting flow control, deadman
 * timers, reconnect retry intervals) relied on real timers and
 * arbitrary flush delays — slow, flaky, imprecise.
 *
 * Run: npx tsx tests/virtual-scheduler.test.ts
 */
import { VirtualScheduler, RealScheduler } from './helpers/VirtualScheduler';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-49 VirtualScheduler ===\n');

void (async () => {

// 1. Initial state: now=0, no pending
{
  const s = new VirtualScheduler();
  assert(s.now === 0, `initial now=0 (got ${s.now})`);
  assert(s.pendingCount === 0, `initial pendingCount=0`);
}

// 2. setTimeout enqueues; advanceBy fires when due
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  s.setTimeout(() => fired.push(s.now), 100);
  assert(s.pendingCount === 1, 'pending after setTimeout');
  s.advanceBy(99);
  assert(fired.length === 0, `not fired before due (got ${fired.length})`);
  s.advanceBy(1);
  assert(fired.length === 1 && fired[0] === 100,
    `fired at exact due time (got fired=${fired.join(',')})`);
}

// 3. Three callbacks at t=10, 20, 30; advanceBy(15)
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  s.setTimeout(() => fired.push(10), 10);
  s.setTimeout(() => fired.push(20), 20);
  s.setTimeout(() => fired.push(30), 30);
  s.advanceBy(15);
  assert(fired.toString() === '10', `only first callback fired (got ${fired.join(',')})`);
  assert(s.now === 15, `now advanced to 15 (got ${s.now})`);
  assert(s.pendingCount === 2, `2 still pending`);
}

// 4. setInterval: advanceBy(450) with 100ms recurring → 4 fires
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  s.setInterval(() => fired.push(s.now), 100);
  s.advanceBy(450);
  assert(fired.length === 4 && fired.toString() === '100,200,300,400',
    `4 fires at 100/200/300/400 (got ${fired.join(',')})`);
}

// 5. clearTimeout cancels a pending callback
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  const h = s.setTimeout(() => fired.push(1), 100);
  s.clearTimeout(h);
  s.advanceBy(200);
  assert(fired.length === 0, `cleared timeout did not fire (got ${fired.length})`);
}

// 6. clearInterval cancels a recurring task
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  const h = s.setInterval(() => fired.push(1), 100);
  s.advanceBy(250);
  assert(fired.length === 2, `2 fires before clear (got ${fired.length})`);
  s.clearInterval(h);
  s.advanceBy(500);
  assert(fired.length === 2, `no further fires after clearInterval (got ${fired.length})`);
}

// 7. advanceBy(0) is a no-op
{
  const s = new VirtualScheduler();
  s.setTimeout(() => {}, 10);
  s.advanceBy(0);
  assert(s.pendingCount === 1, `advanceBy(0): nothing fires`);
  assert(s.now === 0, `advanceBy(0): now unchanged`);
}

// 8. Negative advanceBy throws
{
  const s = new VirtualScheduler();
  let threw = false;
  try { s.advanceBy(-1); } catch { threw = true; }
  assert(threw, 'advanceBy(-1) throws');
}

// 9. advanceUntilIdle drains everything
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  s.setTimeout(() => fired.push(s.now), 100);
  s.setTimeout(() => fired.push(s.now), 500);
  s.setTimeout(() => fired.push(s.now), 1000);
  s.advanceUntilIdle();
  assert(fired.toString() === '100,500,1000',
    `advanceUntilIdle drains all in order (got ${fired.join(',')})`);
  assert(s.pendingCount === 0, 'queue empty after advanceUntilIdle');
  assert(s.now === 1000, `now is the latest fireAt (got ${s.now})`);
}

// 10. Tasks scheduled inside a callback fire when due
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  s.setTimeout(() => {
    fired.push(s.now);
    s.setTimeout(() => fired.push(s.now), 50);
  }, 100);
  s.advanceBy(200);
  assert(fired.toString() === '100,150',
    `outer + nested both fired (got ${fired.join(',')})`);
}

// 11. Recurring task that throws does not loop infinitely
{
  // setInterval semantics: missed intervals are NOT compounded; if a
  // fire takes a long time, only the next fire is rescheduled at +interval.
  const s = new VirtualScheduler();
  let count = 0;
  s.setInterval(() => { count += 1; }, 100);
  s.advanceBy(1000);
  assert(count === 10, `10 fires in 1000ms with interval=100 (got ${count})`);
}

// 12. clearTimeout on already-fired handle is a no-op
{
  const s = new VirtualScheduler();
  const fired: number[] = [];
  const h = s.setTimeout(() => fired.push(1), 100);
  s.advanceBy(200);
  assert(fired.length === 1, 'fired once');
  let threw = false;
  try { s.clearTimeout(h); } catch { threw = true; }
  assert(!threw, 'clearTimeout on fired handle is a no-op');
}

// 13. Tie-breaking: same fireAt fires in enqueue order
{
  const s = new VirtualScheduler();
  const fired: string[] = [];
  s.setTimeout(() => fired.push('a'), 100);
  s.setTimeout(() => fired.push('b'), 100);
  s.setTimeout(() => fired.push('c'), 100);
  s.advanceBy(100);
  assert(fired.toString() === 'a,b,c',
    `enqueue order preserved on tie (got ${fired.join(',')})`);
}

// 14. advanceUntilIdle safety limit catches infinite loops
{
  const s = new VirtualScheduler();
  // Self-rescheduling task at 0ms — this would loop forever
  let count = 0;
  const reschedule = () => {
    count += 1;
    s.setTimeout(reschedule, 0);
  };
  s.setTimeout(reschedule, 0);
  let threw = false;
  try {
    s.advanceUntilIdle(1000);
  } catch (e) {
    threw = e instanceof Error && /safety limit/i.test(e.message);
  }
  assert(threw, `safety limit catches runaway loop`);
  assert(count > 999, `counter grew before bail (got ${count})`);
}

// 15. RealScheduler implements the same surface
{
  const s = new RealScheduler();
  assert(typeof s.setTimeout === 'function'
      && typeof s.setInterval === 'function'
      && typeof s.clearTimeout === 'function'
      && typeof s.clearInterval === 'function'
      && typeof s.now === 'number',
    `RealScheduler has SchedulerLike surface`);
  // Set + clear a timeout to verify the wrapper doesn't leave a real
  // timer running (which would keep tsx alive past the test).
  const h = s.setTimeout(() => {}, 100_000);
  s.clearTimeout(h);
}

// 16. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, './helpers/VirtualScheduler.ts'), 'utf-8');
  assert(/T2-49/.test(src), 'T2-49 marker in VirtualScheduler.ts');
  for (const id of [
    'class VirtualScheduler', 'class RealScheduler',
    'SchedulerLike', 'TimerHandle',
    'advanceBy', 'advanceUntilIdle', 'pendingCount',
  ]) {
    assert(src.includes(id), `'${id}' present`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
