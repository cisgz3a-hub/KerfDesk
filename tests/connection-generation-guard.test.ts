/**
 * T2-34: connection generation guard. Pre-T2-34 stale read-loop
 * events from a closed WebSerialPort could mutate the new
 * controller after a rapid disconnect/reconnect.
 *
 * Run: npx tsx tests/connection-generation-guard.test.ts
 */
import {
  ConnectionGenerationAllocator,
  isStaleContext,
  contextFromToken,
  withGenerationGuard,
  guardCallback,
  compareTokens,
  classifyContext,
  type ConnectionToken,
  type TransportCallbackContext,
} from '../src/communication/ConnectionGenerationGuard';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-34 connection generation guard ===\n');

void (async () => {

// 1. Allocator: generations strictly increase
{
  const a = new ConnectionGenerationAllocator({ now: () => 1000 });
  const t1 = a.allocate();
  const t2 = a.allocate();
  const t3 = a.allocate();
  assert(t1.generation === 1, `gen1=1`);
  assert(t2.generation === 2, `gen2=2`);
  assert(t3.generation === 3, `gen3=3`);
}

// 2. Allocator: ids include the generation
{
  const a = new ConnectionGenerationAllocator();
  const t = a.allocate();
  assert(t.id === 'conn-1', `id=conn-1`);
  assert(a.allocate().id === 'conn-2', `next id=conn-2`);
}

// 3. Allocator: createdAt comes from injected clock
{
  const a = new ConnectionGenerationAllocator({ now: () => 12345 });
  const t = a.allocate();
  assert(t.createdAt === 12345, `createdAt from clock`);
}

// 4. Allocator: startGeneration override
{
  const a = new ConnectionGenerationAllocator({ startGeneration: 100 });
  assert(a.allocate().generation === 100, `start gen=100`);
  assert(a.allocate().generation === 101, `next=101`);
}

// 5. Allocator: nextGeneration introspection
{
  const a = new ConnectionGenerationAllocator();
  assert(a.nextGeneration === 1, `next pre-allocate`);
  a.allocate();
  assert(a.nextGeneration === 2, `next post-allocate`);
}

// 6. isStaleContext: matching ctx is not stale
{
  const a = new ConnectionGenerationAllocator();
  const t = a.allocate();
  const ctx = contextFromToken(t);
  assert(!isStaleContext(ctx, t), `same token → not stale`);
}

// 7. isStaleContext: null active → stale
{
  const ctx: TransportCallbackContext = { connectionId: 'conn-1', generation: 1 };
  assert(isStaleContext(ctx, null), `null active → stale`);
}

// 8. isStaleContext: generation mismatch → stale
{
  const a = new ConnectionGenerationAllocator();
  const t1 = a.allocate();
  const t2 = a.allocate();
  const ctx = contextFromToken(t1);
  assert(isStaleContext(ctx, t2), `old gen vs new active → stale`);
}

// 9. isStaleContext: id mismatch (same gen) → stale
{
  const ctx: TransportCallbackContext = { connectionId: 'conn-X', generation: 1 };
  const active: ConnectionToken = { id: 'conn-Y', generation: 1, createdAt: 0 };
  assert(isStaleContext(ctx, active), `id mismatch → stale`);
}

// 10. contextFromToken: shape preserves id + generation
{
  const t: ConnectionToken = { id: 'conn-7', generation: 7, createdAt: 100 };
  const c = contextFromToken(t);
  assert(c.connectionId === 'conn-7' && c.generation === 7, `ctx from token`);
}

// 11. withGenerationGuard: bound to active → fires
{
  const a = new ConnectionGenerationAllocator();
  const t = a.allocate();
  let active: ConnectionToken | null = t;
  let calls = 0;
  const wrapped = withGenerationGuard(t, () => active, (n: number) => { calls += n; });
  wrapped(5);
  assert(calls === 5, `live callback fires`);
}

// 12. withGenerationGuard: bound to old, new active → no-op
{
  const a = new ConnectionGenerationAllocator();
  const old = a.allocate();
  const fresh = a.allocate();
  let active: ConnectionToken | null = fresh;
  let calls = 0;
  const wrapped = withGenerationGuard(old, () => active, () => { calls++; });
  wrapped();
  assert(calls === 0, `stale callback dropped`);
}

// 13. withGenerationGuard: active=null → no-op
{
  const a = new ConnectionGenerationAllocator();
  const t = a.allocate();
  let calls = 0;
  const wrapped = withGenerationGuard(t, () => null, () => { calls++; });
  wrapped();
  assert(calls === 0, `null active → drop`);
}

// 14. withGenerationGuard: getActive re-evaluated each call
{
  const a = new ConnectionGenerationAllocator();
  const t1 = a.allocate();
  let active: ConnectionToken | null = t1;
  let calls = 0;
  const wrapped = withGenerationGuard(t1, () => active, () => { calls++; });
  wrapped();
  assert(calls === 1, `first call fires`);
  active = a.allocate();  // new connection takes over
  wrapped();
  assert(calls === 1, `second call (now stale) drops`);
}

// 15. guardCallback: ctx live → fires
{
  const a = new ConnectionGenerationAllocator();
  const t = a.allocate();
  let active: ConnectionToken | null = t;
  let received: number[] = [];
  const wrapped = guardCallback(() => active, (n: number) => { received.push(n); });
  wrapped(contextFromToken(t), 42);
  assert(received.length === 1 && received[0] === 42, `live ctx → fires`);
}

// 16. guardCallback: ctx stale → no-op
{
  const a = new ConnectionGenerationAllocator();
  const old = a.allocate();
  const fresh = a.allocate();
  let active: ConnectionToken | null = fresh;
  let received: number[] = [];
  const wrapped = guardCallback(() => active, (n: number) => { received.push(n); });
  wrapped(contextFromToken(old), 42);
  assert(received.length === 0, `stale ctx → dropped`);
}

// 17. compareTokens: newer wins
{
  const a = new ConnectionGenerationAllocator();
  const t1 = a.allocate();
  const t2 = a.allocate();
  assert(compareTokens(t2, t1) > 0, `t2 newer than t1`);
  assert(compareTokens(t1, t2) < 0, `t1 older than t2`);
  assert(compareTokens(t1, t1) === 0, `equal`);
}

// 18. classifyContext: live
{
  const a = new ConnectionGenerationAllocator();
  const t = a.allocate();
  assert(classifyContext(contextFromToken(t), t) === 'live', `live`);
}

// 19. classifyContext: no-active-connection
{
  const ctx: TransportCallbackContext = { connectionId: 'x', generation: 1 };
  assert(classifyContext(ctx, null) === 'no-active-connection', `null active`);
}

// 20. classifyContext: generation-mismatch
{
  const a = new ConnectionGenerationAllocator();
  const t1 = a.allocate();
  const t2 = a.allocate();
  assert(classifyContext(contextFromToken(t1), t2) === 'generation-mismatch',
    `gen-mismatch`);
}

// 21. classifyContext: id-mismatch (same gen, different id — synthetic)
{
  const active: ConnectionToken = { id: 'conn-A', generation: 5, createdAt: 0 };
  const ctx: TransportCallbackContext = { connectionId: 'conn-B', generation: 5 };
  assert(classifyContext(ctx, active) === 'id-mismatch', `id-mismatch`);
}

// 22. THE audit's headline case: rapid disconnect/reconnect drops stale event
{
  const a = new ConnectionGenerationAllocator();
  const oldConn = a.allocate();          // first connection
  let activeToken: ConnectionToken | null = oldConn;
  let dataReceivedByController = 0;
  const onData = guardCallback(() => activeToken, (line: string) => {
    dataReceivedByController += line.length;
  });
  // First connection delivers some data:
  onData(contextFromToken(oldConn), 'hello');
  assert(dataReceivedByController === 5, `first data delivered`);
  // Disconnect → new connection:
  const newConn = a.allocate();
  activeToken = newConn;
  // Stale event from the OLD transport arrives in the microtask queue:
  onData(contextFromToken(oldConn), 'STALE PAYLOAD');
  assert(dataReceivedByController === 5, `stale event was DROPPED`);
  // New transport's events still flow:
  onData(contextFromToken(newConn), 'fresh');
  assert(dataReceivedByController === 10, `new events still flow`);
}

// 23. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/communication/ConnectionGenerationGuard.ts'), 'utf-8');
  assert(/T2-34/.test(src), 'T2-34 marker');
  for (const id of [
    'ConnectionToken', 'TransportCallbackContext',
    'ConnectionGenerationAllocator',
    'isStaleContext', 'contextFromToken',
    'withGenerationGuard', 'guardCallback',
    'compareTokens', 'classifyContext',
    'StaleEventReason',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['no-active-connection', 'generation-mismatch', 'id-mismatch', 'live']) {
    assert(src.includes(`'${r}'`), `reason '${r}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
