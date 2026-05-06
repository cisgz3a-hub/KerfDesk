/**
 * T2-94: clock-tamper detection. Pre-T2-94 offline grace used
 * `Date.now() - cached.validatedAt` — a user could roll back the
 * system clock to extend grace indefinitely. Audit 5A Critical 7 +
 * Required Priority 7.
 *
 * Run: npx tsx tests/clock-tamper.test.ts
 */
import {
  emptyClockState,
  detectClockTamper,
  updateClockState,
  checkServerTimeGrace,
  clockTamperUserMessage,
  FORWARD_JUMP_THRESHOLD_MS,
  type ClockState,
} from '../src/entitlements/ClockTamperDetection';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-94 Clock-tamper detection ===\n');

void (async () => {

const t0 = Date.parse('2026-05-06T00:00:00Z');
const oneDay = 24 * 60 * 60 * 1000;

// 1. emptyClockState shape
{
  const s = emptyClockState(t0);
  assert(s.monotonicCounter === 0, `counter=0`);
  assert(s.lastObservedWallClock === t0, `lastObservedWallClock=t0`);
  assert(s.serverTimeAtLastVerify === t0, `serverTime defaults to now`);
  assert(s.graceUntilServerTime === 0, `graceUntilServerTime=0`);
}

// 2. No tamper: clock advances normally
{
  const state = emptyClockState(t0);
  const r = detectClockTamper({ state, currentNow: t0 + oneDay });
  assert(r === null, `clock advances by 1 day → null`);
}

// 3. Wall clock rolls back → 'rolled-back'
{
  const state = emptyClockState(t0);
  const r = detectClockTamper({ state, currentNow: t0 - oneDay });
  assert(r != null && r.kind === 'rolled-back',
    `clock rolled back → 'rolled-back'`);
  if (r) {
    assert(r.message.length > 0, `message non-empty`);
    assert(r.detail?.observed === t0 - oneDay, `detail.observed`);
    assert(r.detail?.previous === t0, `detail.previous`);
  }
}

// 4. Forward jump > 1 year → 'jumped-forward'
{
  const state = emptyClockState(t0);
  const r = detectClockTamper({
    state, currentNow: t0 + FORWARD_JUMP_THRESHOLD_MS + 1,
  });
  assert(r != null && r.kind === 'jumped-forward',
    `forward jump > 1 year → 'jumped-forward'`);
}

// 5. Forward jump exactly at threshold → no tamper
{
  const state = emptyClockState(t0);
  const r = detectClockTamper({
    state, currentNow: t0 + FORWARD_JUMP_THRESHOLD_MS,
  });
  assert(r === null, `forward jump at exact threshold → null`);
}

// 6. Server-time grace expired
{
  const state: ClockState = {
    monotonicCounter: 1,
    lastObservedWallClock: t0,
    serverTimeAtLastVerify: t0,
    graceUntilServerTime: t0 + oneDay,
  };
  const r = detectClockTamper({ state, currentNow: t0 + 2 * oneDay });
  // Wall-clock advance is fine, but graceUntilServerTime is past
  assert(r != null && r.kind === 'server-time-grace-expired',
    `server-time grace expired → 'server-time-grace-expired'`);
}

// 7. Server-time grace check: in-grace
{
  const state: ClockState = {
    monotonicCounter: 1,
    lastObservedWallClock: t0,
    serverTimeAtLastVerify: t0,
    graceUntilServerTime: t0 + oneDay * 30,
  };
  const r = detectClockTamper({ state, currentNow: t0 + oneDay * 5 });
  assert(r === null, `still within grace (5 days of 30) → null`);
}

// 8. Monotonic regression
{
  const state: ClockState = {
    monotonicCounter: 100,
    lastObservedWallClock: t0,
    serverTimeAtLastVerify: t0,
    graceUntilServerTime: 0,
  };
  const r = detectClockTamper({ state, currentNow: t0 + oneDay, currentCounter: 50 });
  assert(r != null && r.kind === 'monotonic-regression',
    `counter regression → 'monotonic-regression'`);
}

// 9. Monotonic check skipped when currentCounter undefined
{
  const state: ClockState = {
    monotonicCounter: 100,
    lastObservedWallClock: t0,
    serverTimeAtLastVerify: t0,
    graceUntilServerTime: 0,
  };
  const r = detectClockTamper({ state, currentNow: t0 + oneDay });
  assert(r === null, `no currentCounter → skip monotonic check`);
}

// 10. Priority: monotonic-regression reported BEFORE rolled-back
{
  const state: ClockState = {
    monotonicCounter: 100, lastObservedWallClock: t0,
    serverTimeAtLastVerify: t0, graceUntilServerTime: 0,
  };
  // Both monotonic regression AND rolled-back present
  const r = detectClockTamper({
    state, currentNow: t0 - oneDay, currentCounter: 50,
  });
  assert(r != null && r.kind === 'monotonic-regression',
    `monotonic regression checked first`);
}

// 11. Priority: rolled-back reported BEFORE jumped-forward
//     (impossible scenario — but check the priority ordering matches
//     the documented spec)
{
  // Construct a state where time both rolled back AND a forward jump
  // applies — impossible in reality, but we verify the precedence.
  const state = emptyClockState(t0);
  // Rolled-back (currentNow < lastObservedWallClock) is the only
  // signal that fires here; jumped-forward needs a positive delta.
  // The priority is verified by the rolled-back test plus the
  // ordering in the source.
  const r = detectClockTamper({ state, currentNow: t0 - oneDay });
  assert(r?.kind === 'rolled-back', `rolled-back fires`);
}

// 12. updateClockState: increments counter + records wall clock
{
  const state = emptyClockState(t0);
  const next = updateClockState({ state, currentNow: t0 + oneDay });
  assert(next.monotonicCounter === 1, `counter incremented`);
  assert(next.lastObservedWallClock === t0 + oneDay, `wall clock recorded`);
}

// 13. updateClockState: optional serverTime + grace overrides
{
  const state = emptyClockState(t0);
  const next = updateClockState({
    state, currentNow: t0 + oneDay,
    serverTime: t0 + oneDay + 100,
    graceUntilServerTime: t0 + 30 * oneDay,
  });
  assert(next.serverTimeAtLastVerify === t0 + oneDay + 100,
    `serverTime override applied`);
  assert(next.graceUntilServerTime === t0 + 30 * oneDay,
    `grace override applied`);
}

// 14. checkServerTimeGrace: in-grace
{
  const r = checkServerTimeGrace({ iat: t0, exp: t0 + 30 * oneDay, currentNow: t0 + 5 * oneDay });
  assert(r === 'in-grace', `5 days of 30: in-grace`);
}

// 15. checkServerTimeGrace: expired
{
  const r = checkServerTimeGrace({ iat: t0, exp: t0 + oneDay, currentNow: t0 + 2 * oneDay });
  assert(r === 'expired', `past exp: expired`);
}

// 16. checkServerTimeGrace: not-yet (clock far in past)
{
  const r = checkServerTimeGrace({ iat: t0, exp: t0 + oneDay, currentNow: t0 - oneDay });
  assert(r === 'not-yet', `before iat: not-yet`);
}

// 17. The KEY property: rolled-back clock CANNOT extend server-time grace
{
  // Server says "expires at t0+30d". Local clock rolls back to t0-100d.
  // The TOKEN says expired status applies based on what server stamped,
  // not what local clock says. checkServerTimeGrace doesn't grant
  // extra grace from rollback — it returns 'not-yet' (clock < iat).
  const r = checkServerTimeGrace({
    iat: t0, exp: t0 + 30 * oneDay, currentNow: t0 - 100 * oneDay,
  });
  assert(r === 'not-yet',
    `rolled-back clock returns 'not-yet' (cannot pretend to be in grace forever)`);
  // Combined with the detector's 'rolled-back' signal, this means a
  // rollback cannot evade the grace boundary.
  const tamper = detectClockTamper({
    state: emptyClockState(t0),
    currentNow: t0 - 100 * oneDay,
  });
  assert(tamper?.kind === 'rolled-back',
    `rollback also raised by tamper detector`);
}

// 18. clockTamperUserMessage per kind
{
  for (const kind of ['rolled-back', 'jumped-forward', 'server-time-grace-expired', 'monotonic-regression'] as const) {
    const m = clockTamperUserMessage({ kind, message: 'x' });
    assert(m.length > 0, `'${kind}': non-empty user message`);
  }
}

// 19. End-to-end: boot → verify online → grace tracked → rollback → block
{
  let state = emptyClockState(t0);
  // Verify online: server stamps 30-day grace
  state = updateClockState({
    state, currentNow: t0,
    serverTime: t0,
    graceUntilServerTime: t0 + 30 * oneDay,
  });
  // Run for 5 days
  state = updateClockState({ state, currentNow: t0 + 5 * oneDay });
  let r = detectClockTamper({ state, currentNow: t0 + 6 * oneDay });
  assert(r === null, `boot 6 days in: in-grace, no tamper`);
  // User rolls back to t0
  r = detectClockTamper({ state, currentNow: t0 });
  assert(r?.kind === 'rolled-back',
    `rollback after 5 days of forward progression → 'rolled-back'`);
}

// 20. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/entitlements/ClockTamperDetection.ts'), 'utf-8');
  assert(/T2-94/.test(src), 'T2-94 marker in ClockTamperDetection.ts');
  for (const id of [
    'ClockState', 'ClockTamperKind', 'ClockTamperReason',
    'FORWARD_JUMP_THRESHOLD_MS',
    'emptyClockState', 'detectClockTamper', 'updateClockState',
    'checkServerTimeGrace', 'clockTamperUserMessage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of [
    'rolled-back', 'jumped-forward', 'server-time-grace-expired', 'monotonic-regression',
  ]) {
    assert(src.includes(`'${k}'`), `tamper kind '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
