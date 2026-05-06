/**
 * T2-129: destructive `forceSafeState()` primitive. Pre-T2-129 a
 * user who hit an alarm at end-of-job had no in-app affordance to
 * reset. Audit 1D required fix (the destructive half of T1-25's
 * non-destructive observation pair).
 *
 * Run: npx tsx tests/force-safe-state-primitive.test.ts
 */
import {
  evaluateForceSafeState,
  shouldOfferForceSafeState,
  forceSafeStateFailureMessage,
  forceSafeStateConfirmation,
  REALTIME_RESET,
  REALTIME_STATUS_QUERY,
  type ForceSafeStateResult,
} from '../src/controllers/grbl/ForceSafeState';
import type { ControllerStatus } from '../src/app/MachineSafetyState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-129 forceSafeState primitive ===\n');

void (async () => {

// 1. REALTIME bytes match GRBL spec
{
  assert(REALTIME_RESET === 0x18, `soft reset = 0x18 (Ctrl-X)`);
  assert(REALTIME_STATUS_QUERY === 0x3f, `status query = 0x3F ('?')`);
}

// 2. evaluateForceSafeState: clean reset → ok
{
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: { feedRate: 0, spindleSpeed: 0, status: 'idle' },
  });
  assert(r.ok === true, `clean reset → ok=true`);
  if (r.ok) {
    assert(r.state === 'idle', `state=idle`);
  }
}

// 3. No banner → no-banner-response
{
  const r = evaluateForceSafeState({
    bannerReceived: false,
    statusReport: { feedRate: 0, spindleSpeed: 0, status: 'idle' },
  });
  assert(!r.ok, `no banner → ok=false`);
  if (!r.ok) {
    assert(r.reason === 'no-banner-response', `reason=no-banner-response`);
  }
}

// 4. Banner but no status → no-status-response
{
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: null,
  });
  if (!r.ok) {
    assert(r.reason === 'no-status-response', `reason=no-status-response`);
  } else {
    assert(false, `should be ok=false`);
  }
}

// 5. F!=0 → fs-not-zero with actual values
{
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: { feedRate: 1500, spindleSpeed: 0, status: 'idle' },
  });
  if (!r.ok) {
    assert(r.reason === 'fs-not-zero', `reason=fs-not-zero`);
    assert(r.actual?.feedRate === 1500, `actual.feedRate=1500`);
  } else { assert(false, `expected ok=false`); }
}

// 6. S!=0 → fs-not-zero
{
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: { feedRate: 0, spindleSpeed: 500, status: 'idle' },
  });
  if (!r.ok) {
    assert(r.reason === 'fs-not-zero', `S=500 → fs-not-zero`);
  } else { assert(false, `expected ok=false`); }
}

// 7. status='alarm' → still-non-idle
//    (alarm requires $X, not soft-reset, so even after a clean reset
//    response the controller is still in alarm)
{
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: { feedRate: 0, spindleSpeed: 0, status: 'alarm' },
  });
  if (!r.ok) {
    assert(r.reason === 'still-non-idle', `alarm → still-non-idle`);
    assert(r.actual?.status === 'alarm', `actual.status=alarm`);
  } else { assert(false, `expected ok=false`); }
}

// 8. status='hold' → still-non-idle
{
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: { feedRate: 0, spindleSpeed: 0, status: 'hold' },
  });
  if (!r.ok) {
    assert(r.reason === 'still-non-idle', `hold → still-non-idle`);
  } else { assert(false, `expected ok=false`); }
}

// 9. shouldOfferForceSafeState: only meaningful in non-clean states
{
  const offer: ControllerStatus[] = ['alarm', 'hold', 'run', 'door'];
  const noOffer: ControllerStatus[] = ['idle', 'jog', 'check', 'home', 'sleep', 'unknown'];
  for (const s of offer) {
    assert(shouldOfferForceSafeState(s), `${s}: offer button`);
  }
  for (const s of noOffer) {
    assert(!shouldOfferForceSafeState(s), `${s}: no button`);
  }
}

// 10. forceSafeStateFailureMessage: ok result → null
{
  const ok: ForceSafeStateResult = { ok: true, state: 'idle' };
  assert(forceSafeStateFailureMessage(ok) === null, `ok → null`);
}

// 11. forceSafeStateFailureMessage: each kind has a non-empty message
{
  const messages = new Set<string>();
  for (const reason of ['no-banner-response', 'no-status-response', 'fs-not-zero', 'still-non-idle'] as const) {
    const r: ForceSafeStateResult = reason === 'fs-not-zero' || reason === 'still-non-idle'
      ? { ok: false, reason, actual: { feedRate: 0, spindleSpeed: 0, status: 'alarm' } }
      : { ok: false, reason };
    const msg = forceSafeStateFailureMessage(r);
    assert(msg != null && msg.length > 0, `'${reason}': non-empty message`);
    if (msg) messages.add(msg);
  }
  assert(messages.size === 4,
    `4 distinct messages (got ${messages.size})`);
}

// 12. fs-not-zero message names actual feed + spindle
{
  const r: ForceSafeStateResult = {
    ok: false, reason: 'fs-not-zero',
    actual: { feedRate: 1500, spindleSpeed: 500, status: 'idle' },
  };
  const msg = forceSafeStateFailureMessage(r);
  assert(msg?.includes('1500') === true && msg?.includes('500') === true,
    `message names actual feed + spindle (got '${msg}')`);
}

// 13. still-non-idle on alarm: message tells user to send $X
{
  const r: ForceSafeStateResult = {
    ok: false, reason: 'still-non-idle',
    actual: { feedRate: 0, spindleSpeed: 0, status: 'alarm' },
  };
  const msg = forceSafeStateFailureMessage(r);
  assert(msg?.includes('$X') === true, `alarm message includes '$X' instruction`);
}

// 14. still-non-idle on hold: message tells user to send cycle-start
{
  const r: ForceSafeStateResult = {
    ok: false, reason: 'still-non-idle',
    actual: { feedRate: 0, spindleSpeed: 0, status: 'hold' },
  };
  const msg = forceSafeStateFailureMessage(r);
  assert(msg?.includes('~') === true || msg?.toLowerCase().includes('cycle-start') === true,
    `hold message includes cycle-start guidance`);
}

// 15. forceSafeStateConfirmation: structure
{
  const c = forceSafeStateConfirmation('alarm');
  assert(c.title.length > 0, `title non-empty`);
  assert(c.message.includes('alarm'),
    `message names current status`);
  assert(c.confirmLabel === 'Reset' && c.cancelLabel === 'Cancel',
    `confirm/cancel labels`);
  assert(c.consequences.length > 0, `consequences listed`);
}

// 16. Confirmation: 'run' state warns about job abort
{
  const c = forceSafeStateConfirmation('run');
  const txt = c.consequences.join(' ');
  assert(/abort|aborted/i.test(txt),
    `'run' confirmation warns about job abort`);
}

// 17. Confirmation: 'hold' warns about non-resumable abandonment
{
  const c = forceSafeStateConfirmation('hold');
  const txt = c.consequences.join(' ');
  assert(/abandon|cannot be resumed/i.test(txt),
    `'hold' confirmation warns about job abandonment`);
}

// 18. Confirmation: every state warns about position-clear
{
  for (const s of ['alarm', 'hold', 'run', 'idle'] as ControllerStatus[]) {
    const c = forceSafeStateConfirmation(s);
    const txt = c.consequences.join(' ');
    assert(/position|re-home/i.test(txt),
      `'${s}' confirmation: position-clear warning`);
  }
}

// 19. Confirmation: 'alarm' state warns soft-reset doesn't clear it
{
  const c = forceSafeStateConfirmation('alarm');
  const txt = c.consequences.join(' ');
  assert(/\$X/.test(txt) && /clear/i.test(txt),
    `'alarm' confirmation: warns soft-reset does NOT clear alarm`);
}

// 20. Realistic post-reset path: end-to-end
{
  // Operator hits alarm 1 mid-job → soft-reset → controller alive
  // (banner) but in alarm → still-non-idle → user instructed to $X.
  const r = evaluateForceSafeState({
    bannerReceived: true,
    statusReport: { feedRate: 0, spindleSpeed: 0, status: 'alarm' },
  });
  if (!r.ok) {
    assert(r.reason === 'still-non-idle', `e2e: still-non-idle`);
    const msg = forceSafeStateFailureMessage(r);
    assert(msg?.includes('$X') === true,
      `e2e: user told to send $X for alarm clearance`);
  } else { assert(false, `expected ok=false`); }
}

// 21. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/controllers/grbl/ForceSafeState.ts'), 'utf-8');
  assert(/T2-129/.test(src), 'T2-129 marker in ForceSafeState.ts');
  for (const id of [
    'ForceSafeStateFailureReason', 'ForceSafeStateResult',
    'REALTIME_RESET', 'REALTIME_STATUS_QUERY',
    'PostResetObservations', 'evaluateForceSafeState',
    'shouldOfferForceSafeState', 'forceSafeStateFailureMessage',
    'forceSafeStateConfirmation', 'ForceSafeStateConfirmation',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['no-banner-response', 'no-status-response', 'fs-not-zero', 'still-non-idle']) {
    assert(src.includes(`'${r}'`), `failure reason '${r}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
