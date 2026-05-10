/**
 * T1-117 integration: end-to-end exercise of the WCS fail-closed
 * path through GrblController. Spins up a MockSerialPort whose
 * `$#` response is missing the `[G54:...]` line (or whose `$10`
 * is missing from `$$`) and asserts the controller:
 *   - does NOT call applyWcsNormalization (no G10 written)
 *   - flips _placementUncertain = true
 *   - reports the matching WcsUncertainReason via
 *     getPlacementUncertainReason()
 *
 * Run: npx tsx tests/wcs-fail-closed-integration.test.ts
 */
import {
  GrblController,
  type WcsUncertainReason,
} from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  PASS ${m}`);
  } else {
    failed++;
    console.error(`  FAIL ${m}`);
  }
}

async function waitUntil(fn: () => boolean, timeoutMs = 2000, step = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return;
    await new Promise<void>((x) => setTimeout(x, step));
  }
}

console.log('\n=== T1-117 GrblController fail-closed integration ===\n');

void (async () => {
  // -------- Scenario 1: $# returns only `ok` (missing [G54:...]) --------
  // Pre-fix this would default g54IsZero=true and, combined with $10=0,
  // call applyWcsNormalization silently. Post-fix the controller
  // refuses, sets _placementUncertain, and records 'missing_g54'.
  {
    const port = new MockSerialPort((line: string) => {
      if (line === '$$') return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
      if (line === '$#') return ['ok']; // no [G54:...] line at all
      if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
      if (line.startsWith('$10=')) return ['ok'];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await waitUntil(() => ctrl.getPlacementUncertain?.() === true, 2000);

    assert(
      ctrl.getPlacementUncertain?.() === true,
      'missing [G54:...] in $# response → placement-uncertain',
    );
    assert(
      ctrl.getPlacementUncertainReason?.() === 'missing_g54',
      `reason='missing_g54' (got '${ctrl.getPlacementUncertainReason?.()}')`,
    );
    assert(
      !port.received.includes('G10 L2 P1 X0 Y0 Z0'),
      'controller did NOT write G10 L2 P1 X0 Y0 Z0 (no silent auto-apply)',
    );
    assert(
      !port.received.includes('$10=0'),
      'controller did NOT write $10=0 (no silent auto-apply)',
    );
    await ctrl.disconnect();
  }

  // -------- Scenario 2: $$ omits $10 entirely (missing status mask) --------
  // G54 is the explicit baseline (0,0,0) but $10 is unknown. Pre-fix
  // mask defaulted to 0 → applyWcsNormalization fired. Post-fix flagged
  // as 'missing_status_mask'.
  {
    const port = new MockSerialPort((line: string) => {
      // $$ response omits $10 specifically. Other settings present so
      // the settings phase can complete normally.
      if (line === '$$') return ['$130=200.000', '$131=200.000', 'ok'];
      if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
      if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
      if (line.startsWith('$10=')) return ['ok'];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await waitUntil(() => ctrl.getPlacementUncertain?.() === true, 2000);

    assert(
      ctrl.getPlacementUncertain?.() === true,
      'missing $10 in $$ response → placement-uncertain',
    );
    assert(
      ctrl.getPlacementUncertainReason?.() === 'missing_status_mask',
      `reason='missing_status_mask' (got '${ctrl.getPlacementUncertainReason?.()}')`,
    );
    assert(
      !port.received.includes('G10 L2 P1 X0 Y0 Z0'),
      'controller did NOT write G10 (no silent auto-apply)',
    );
    await ctrl.disconnect();
  }

  // -------- Scenario 3: malformed [G54:bad,bad,bad] --------
  // _tryParseG54WcsLine refuses non-finite coords so _currentG54 stays
  // null. Same outcome as scenario 1 (missing_g54) — pin it explicitly.
  {
    const port = new MockSerialPort((line: string) => {
      if (line === '$$') return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
      if (line === '$#') return ['[G54:bad,bad,bad]', 'ok'];
      if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
      if (line.startsWith('$10=')) return ['ok'];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await waitUntil(() => ctrl.getPlacementUncertain?.() === true, 2000);

    assert(
      ctrl.getPlacementUncertain?.() === true,
      'malformed [G54:...] → placement-uncertain',
    );
    const reason = ctrl.getPlacementUncertainReason?.();
    assert(
      reason === 'missing_g54' || reason === 'malformed_g54',
      `reason is missing_g54 or malformed_g54 (got '${reason}')`,
    );
    await ctrl.disconnect();
  }

  // -------- Scenario 4: malformed $10 value --------
  {
    const port = new MockSerialPort((line: string) => {
      if (line === '$$') return ['$10=NaN', '$130=200.000', '$131=200.000', 'ok'];
      if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
      if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
      if (line.startsWith('$10=')) return ['ok'];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await waitUntil(() => ctrl.getPlacementUncertain?.() === true, 2000);

    assert(
      ctrl.getPlacementUncertain?.() === true,
      'malformed $10 value → placement-uncertain',
    );
    assert(
      ctrl.getPlacementUncertainReason?.() === 'malformed_status_mask',
      `reason='malformed_status_mask' (got '${ctrl.getPlacementUncertainReason?.()}')`,
    );
    await ctrl.disconnect();
  }

  // -------- Scenario 5: clean baseline still auto-normalizes --------
  // Regression guard: the fix must not break the happy path.
  {
    const port = new MockSerialPort((line: string) => {
      if (line === '$$') return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
      if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
      if (line.startsWith('G10') && line.includes('L2')) return ['ok'];
      if (line.startsWith('$10=')) return ['ok'];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await waitUntil(
      () => port.received.includes('G10 L2 P1 X0 Y0 Z0')
        || ctrl.getPlacementUncertain?.() === true,
      2000,
    );

    assert(
      port.received.includes('G10 L2 P1 X0 Y0 Z0'),
      'verified-zero baseline still auto-applies G10 (happy path preserved)',
    );
    assert(
      ctrl.getPlacementUncertain?.() === false,
      'verified-zero baseline does NOT trip placement-uncertain',
    );
    assert(
      ctrl.getPlacementUncertainReason?.() === null,
      'reason stays null in happy path',
    );
    await ctrl.disconnect();
  }

  // -------- Scenario 6: disconnect clears the reason field --------
  {
    const port = new MockSerialPort((line: string) => {
      if (line === '$$') return ['$10=0', '$130=200.000', '$131=200.000', 'ok'];
      if (line === '$#') return ['ok'];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await waitUntil(() => ctrl.getPlacementUncertain?.() === true, 2000);
    const beforeDisconnect: WcsUncertainReason | null = ctrl.getPlacementUncertainReason?.() ?? null;
    assert(beforeDisconnect != null,
      'precondition: reason populated after fail-closed verdict');
    await ctrl.disconnect();
    assert(
      ctrl.getPlacementUncertainReason?.() === null,
      'disconnect clears placement-uncertain reason',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
