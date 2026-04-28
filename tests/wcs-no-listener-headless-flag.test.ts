/**
 * T1-20 regression test (part 2): allowHeadlessWcsAutoNormalize flag
 * preserves the pre-T1-20 auto-apply behavior for tests / headless
 * callers that need it.
 *
 * Companion to wcs-no-listener-blocks-job.test.ts. That test verifies
 * the new default (block job start). This one verifies the opt-in
 * escape hatch.
 *
 * What this test enforces:
 *   1. Controller constructed with `allowHeadlessWcsAutoNormalize: true`.
 *   2. No listener is registered for onWcsConsentNeeded.
 *   3. Connect to a mock port where G54 != 0 (consent path is needed).
 *   4. After the WCS query resolves, verify:
 *      a. G10 / $10= ARE written (auto-apply happened)
 *      b. getPlacementUncertain() returns false (no uncertainty
 *         introduced - we explicitly opted into the auto-apply path)
 *
 * Run: npx tsx tests/wcs-no-listener-headless-flag.test.ts
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
  console.log('\n=== T1-20: headless flag preserves auto-apply ===\n');

  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return ['$10=255', '$130=200.000', '$131=200.000', 'ok'];
    }
    if (line === '$#') {
      return ['[G54:7.500,0.000,0.000]', 'ok'];
    }
    if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
    if (line.startsWith('$10=')) return ['ok'];
    return ['ok'];
  });

  // ── Constructed WITH the headless flag.
  const ctrl = new GrblController({ allowHeadlessWcsAutoNormalize: true });
  assert(
    ctrl.getPlacementUncertain?.() === false,
    'sanity: fresh controller is not placement-uncertain',
  );

  // No listener — same as the default-behavior test, but with the flag
  // set the controller should auto-apply instead of marking uncertain.
  port.open();
  await ctrl.connect(port);

  await waitUntil(() => port.received.includes('G10 L2 P1 X0 Y0 Z0'), 2000);

  assert(
    port.received.includes('G10 L2 P1 X0 Y0 Z0'),
    'headless flag: G10 L2 P1 X0 Y0 Z0 was written (auto-applied)',
  );
  assert(
    port.received.includes('$10=0'),
    'headless flag: $10=0 was written (auto-applied)',
  );
  assert(
    ctrl.getPlacementUncertain?.() === false,
    'headless flag: placement-uncertain stays false (we opted in)',
  );

  await ctrl.disconnect();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
