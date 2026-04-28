/**
 * T1-20 regression test (part 1): default behavior blocks job start when
 * the WCS consent flow has no listeners.
 *
 * Background: pre-T1-20, when GrblController._emitWcsPayload found zero
 * registered consent listeners, it logged a warning and silently called
 * applyWcsNormalization(). The hole: in production, a UI subscription
 * race (component not yet mounted, listener not yet attached) could result in
 * silent WCS mutation without user consent.
 *
 * Fix: default behavior on no listener is to skip apply, mark
 * placement-uncertain, and emit a state-change so the UI gates job
 * start. Tests that need the auto-apply behavior pass the explicit
 * `allowHeadlessWcsAutoNormalize: true` constructor option.
 *
 * What this test enforces:
 *   1. Controller constructed with default options (no flag passed).
 *   2. No listener is registered for onWcsConsentNeeded.
 *   3. Connect to a mock port where G54 != 0 (consent path is needed).
 *   4. After the WCS query resolves, verify:
 *      a. G10 / $10= were NOT written (no silent auto-apply)
 *      b. getPlacementUncertain() returns true
 *
 * Run: npx tsx tests/wcs-no-listener-blocks-job.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

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

async function waitUntil(fn: () => boolean, timeoutMs = 2000, step = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return;
    await new Promise<void>(x => setTimeout(x, step));
  }
}

void (async () => {
  console.log('\n=== T1-20: no-listener default → placement-uncertain ===\n');

  // ── Setup: G54 has a non-zero offset, so the consent flow IS needed.
  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
    }
    if (line === '$#') {
      return ['[G54:5.250,0.000,0.000]', 'ok'];
    }
    if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
    if (line.startsWith('$10=')) return ['ok'];
    return ['ok'];
  });

  // ── Default options: no flag passed.
  const ctrl = new GrblController();
  assert(
    ctrl.getPlacementUncertain?.() === false,
    'sanity: fresh controller is not placement-uncertain (nothing to be uncertain about yet)',
  );

  // No onWcsConsentNeeded — that's the whole point of this test.
  port.open();
  await ctrl.connect(port);

  // Wait for the WCS query to resolve. Either path (auto-apply or
  // placement-uncertain) means the controller has finished its post-
  // connect handshake. We wait on the public placement-uncertain flag
  // flipping true OR on G10 being written. Whichever comes first
  // tells us the path.
  await waitUntil(
    () =>
      ctrl.getPlacementUncertain?.() === true
      || port.received.includes('G10 L2 P1 X0 Y0 Z0'),
    2000,
  );

  assert(
    !port.received.includes('G10 L2 P1 X0 Y0 Z0'),
    'no-listener default: did NOT silently auto-apply G10 (placement-uncertain path)',
  );
  assert(
    !port.received.includes('$10=0'),
    'no-listener default: did NOT silently auto-apply $10=0',
  );
  assert(
    ctrl.getPlacementUncertain?.() === true,
    'no-listener default: getPlacementUncertain() returns true after consent flow',
  );

  // After applyWcsNormalization runs (e.g. user reconnects with a
  // listener that calls apply), placement-uncertain clears.
  ctrl.applyWcsNormalization?.();
  assert(
    ctrl.getPlacementUncertain?.() === false,
    'applyWcsNormalization clears placement-uncertain',
  );

  // Disconnect resets the flag too. (Verify by re-setting it via the
  // same path then disconnecting.)
  // We can't easily re-trigger _emitWcsPayload without another connect
  // cycle, but we can verify disconnect itself doesn't leave the flag
  // sticky from earlier in the lifecycle. (The applyWcsNormalization
  // above already cleared it; this is a regression-guard for the
  // disconnect reset.)
  await ctrl.disconnect();
  assert(
    ctrl.getPlacementUncertain?.() === false,
    'disconnect: placement-uncertain stays false',
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
