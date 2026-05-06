/**
 * T2-36: subscription-based transport callbacks. Pre-T2-36 each
 * callback was a single field that overwrote the previous, so a
 * logger / simulator / lifecycle monitor / T2-34 guard could not
 * coexist with the controller's handler.
 *
 * Run: npx tsx tests/transport-multi-subscribe.test.ts
 */
import {
  SubscriptionSet,
  combineUnsubscribes,
  type DataListener,
  type ErrorListener,
  type CloseListener,
  type TransportCtx,
  type Unsubscribe,
} from '../src/communication/TransportSubscription';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-36 transport subscription set ===\n');

const ctx = (n: number): TransportCtx => ({ connectionId: `conn-${n}`, generation: n });

void (async () => {

// 1. subscribe + dispatch: listener fires
{
  const set = new SubscriptionSet<[string]>();
  const seen: string[] = [];
  set.subscribe((s) => seen.push(s));
  set.dispatch('hello');
  assert(seen.length === 1 && seen[0] === 'hello', `single subscriber receives event`);
}

// 2. multiple subscribers: all receive
{
  const set = new SubscriptionSet<[number]>();
  let a = 0, b = 0;
  set.subscribe((n) => { a += n; });
  set.subscribe((n) => { b += n; });
  set.dispatch(5);
  assert(a === 5 && b === 5, `both subscribers receive`);
}

// 3. unsubscribe: returned function removes listener
{
  const set = new SubscriptionSet<[]>();
  let calls = 0;
  const unsub = set.subscribe(() => { calls++; });
  set.dispatch();
  unsub();
  set.dispatch();
  assert(calls === 1, `unsubscribed listener stops receiving`);
}

// 4. unsubscribe is idempotent
{
  const set = new SubscriptionSet<[]>();
  let calls = 0;
  const unsub = set.subscribe(() => { calls++; });
  unsub();
  unsub();   // should not throw
  unsub();
  set.dispatch();
  assert(calls === 0, `idempotent unsubscribe`);
}

// 5. subscribe-during-dispatch: new listener does NOT fire for current event
{
  const set = new SubscriptionSet<[]>();
  let firstCalls = 0;
  let secondCalls = 0;
  set.subscribe(() => {
    firstCalls++;
    set.subscribe(() => { secondCalls++; });
  });
  set.dispatch();
  assert(firstCalls === 1, `first fires`);
  assert(secondCalls === 0, `second NOT invoked for current event (snapshot)`);
  set.dispatch();
  assert(secondCalls === 1, `second fires for next event`);
}

// 6. unsubscribe-during-dispatch: listener removed mid-dispatch is skipped
{
  const set = new SubscriptionSet<[]>();
  let aCalls = 0;
  let bCalls = 0;
  let unsubB!: Unsubscribe;
  set.subscribe(() => { aCalls++; unsubB(); });   // a unsubscribes b
  unsubB = set.subscribe(() => { bCalls++; });
  set.dispatch();
  assert(aCalls === 1, `a fires`);
  assert(bCalls === 0, `b removed before its turn → skipped`);
}

// 7. listener exception is caught + forwarded; other listeners still fire
{
  const errors: unknown[] = [];
  const set = new SubscriptionSet<[]>({ onListenerError: (e) => errors.push(e) });
  let goodCalls = 0;
  set.subscribe(() => { throw new Error('bad'); });
  set.subscribe(() => { goodCalls++; });
  set.dispatch();
  assert(errors.length === 1, `exception forwarded to onListenerError`);
  assert(goodCalls === 1, `other listeners still fire`);
}

// 8. has(): membership check
{
  const set = new SubscriptionSet<[]>();
  const l = (): void => {};
  assert(!set.has(l), `not subscribed`);
  const u = set.subscribe(l);
  assert(set.has(l), `subscribed`);
  u();
  assert(!set.has(l), `unsubscribed`);
}

// 9. size: count subscribers
{
  const set = new SubscriptionSet<[]>();
  assert(set.size === 0, `empty=0`);
  const u1 = set.subscribe(() => {});
  set.subscribe(() => {});
  assert(set.size === 2, `two subscribers`);
  u1();
  assert(set.size === 1, `after unsub=1`);
}

// 10. clear(): removes all
{
  const set = new SubscriptionSet<[]>();
  set.subscribe(() => {});
  set.subscribe(() => {});
  set.clear();
  assert(set.size === 0, `cleared`);
}

// 11. duplicate subscribe: Set semantics → no-op
{
  const set = new SubscriptionSet<[]>();
  let calls = 0;
  const l = (): void => { calls++; };
  set.subscribe(l);
  set.subscribe(l);   // no-op
  set.dispatch();
  assert(calls === 1, `dedup'd by Set`);
  assert(set.size === 1, `size still 1`);
}

// 12. maxListeners exceeded: throws
{
  const set = new SubscriptionSet<[]>({ maxListeners: 2 });
  set.subscribe(() => {});
  set.subscribe(() => {});
  let threw = false;
  try { set.subscribe(() => {}); } catch { threw = true; }
  assert(threw, `3rd subscription throws past max=2`);
}

// 13. maxListeners with duplicate: still no throw
{
  const set = new SubscriptionSet<[]>({ maxListeners: 1 });
  const l = (): void => {};
  set.subscribe(l);
  let threw = false;
  try { set.subscribe(l); } catch { threw = true; }    // duplicate, no-op
  assert(!threw, `re-subscribing same listener at max: no throw`);
}

// 14. setMaxListeners: adjust at runtime
{
  const set = new SubscriptionSet<[]>({ maxListeners: 1 });
  set.subscribe(() => {});
  set.setMaxListeners(3);
  set.subscribe(() => {});   // now allowed
  set.subscribe(() => {});   // still allowed
  assert(set.size === 3, `cap raised at runtime`);
}

// 15. setMaxListeners(null): removes cap
{
  const set = new SubscriptionSet<[]>({ maxListeners: 0 });
  set.setMaxListeners(null);
  for (let i = 0; i < 100; i++) set.subscribe(() => {});
  assert(set.size === 100, `null cap → unbounded`);
}

// 16. dispatch with no subscribers: no error
{
  const set = new SubscriptionSet<[number]>();
  set.dispatch(42);
  assert(true, `dispatch with empty set is a no-op`);
}

// 17. combineUnsubscribes: all run
{
  const set = new SubscriptionSet<[]>();
  let a = 0, b = 0, c = 0;
  const u = combineUnsubscribes(
    set.subscribe(() => { a++; }),
    set.subscribe(() => { b++; }),
    set.subscribe(() => { c++; }),
  );
  set.dispatch();
  assert(a === 1 && b === 1 && c === 1, `all 3 fire`);
  u();
  set.dispatch();
  assert(a === 1 && b === 1 && c === 1, `combined unsubscribe removed all`);
}

// 18. combineUnsubscribes: throwing inner unsub doesn't stop the rest
{
  let aRan = 0;
  let cRan = 0;
  const u = combineUnsubscribes(
    () => { aRan++; },
    () => { throw new Error('boom'); },
    () => { cRan++; },
  );
  u();
  assert(aRan === 1 && cRan === 1, `throwing unsub does not block others`);
}

// 19. Transport-shape signatures (DataListener / ErrorListener / CloseListener)
{
  const dataSet = new SubscriptionSet<[string, TransportCtx]>();
  const errSet = new SubscriptionSet<[Error, TransportCtx]>();
  const closeSet = new SubscriptionSet<[TransportCtx]>();

  let receivedLine = '';
  let receivedErr: Error | null = null;
  let closeCount = 0;

  const onData: DataListener = (line, c) => { receivedLine = `${line}@${c.generation}`; };
  const onError: ErrorListener = (e) => { receivedErr = e; };
  const onClose: CloseListener = () => { closeCount++; };

  dataSet.subscribe(onData);
  errSet.subscribe(onError);
  closeSet.subscribe(onClose);

  dataSet.dispatch('hello', ctx(7));
  errSet.dispatch(new Error('oops'), ctx(7));
  closeSet.dispatch(ctx(7));

  assert(receivedLine === 'hello@7', `data listener received line + ctx`);
  assert(receivedErr !== null && (receivedErr as Error).message === 'oops', `error received`);
  assert(closeCount === 1, `close received`);
}

// 20. Audit's headline case: simulator mirrors data alongside controller's handler
{
  const dataSet = new SubscriptionSet<[string, TransportCtx]>();
  const controllerLines: string[] = [];
  const simulatorLines: string[] = [];
  dataSet.subscribe((l) => { controllerLines.push(l); });
  dataSet.subscribe((l) => { simulatorLines.push(l); });
  dataSet.dispatch('ok', ctx(1));
  dataSet.dispatch('<Idle>', ctx(1));
  assert(controllerLines.length === 2 && simulatorLines.length === 2,
    `controller + simulator both observe transport stream`);
  assert(controllerLines.join(',') === simulatorLines.join(','),
    `same events in same order`);
}

// 21. Listener exception default: errors don't propagate to dispatch caller
{
  const set = new SubscriptionSet<[]>();
  set.subscribe(() => { throw new Error('crash'); });
  let dispatchThrew = false;
  try { set.dispatch(); } catch { dispatchThrew = true; }
  assert(!dispatchThrew, `dispatch swallows listener exception via default handler`);
}

// 22. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/communication/TransportSubscription.ts'), 'utf-8');
  assert(/T2-36/.test(src), 'T2-36 marker');
  for (const id of [
    'Unsubscribe', 'Listener', 'SubscriptionSet',
    'combineUnsubscribes',
    'TransportCtx', 'DataListener', 'ErrorListener', 'CloseListener',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
