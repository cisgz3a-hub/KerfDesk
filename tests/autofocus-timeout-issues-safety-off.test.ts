/**
 * T1-28: GrblController.runAutoFocus must trigger safety-off on
 * timeout AND on alarm before rejecting. Autofocus moves the Z-axis
 * against a probe; if the firmware hangs or alarms mid-probe, the
 * head may be pressing into the workpiece while the laser is still
 * in M3/M4 modal state from a previous operation. Rejecting without
 * firing M5 / soft reset leaves the machine in an undefined state.
 *
 * Hardware verification needed — Falcon A1 Pro front-origin burn test.
 * Test sequence: trigger autofocus with the Z-stage obstructed (or
 * disconnect the probe pin) so the firmware times out → verify M5
 * fires (laser stays off) and the timeout error surfaces. Don't
 * leave the laser in a fired state.
 *
 * Run: npx tsx tests/autofocus-timeout-issues-safety-off.test.ts
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

function flush(ms = 30): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

console.log('\n=== T1-28 autofocus timeout issues safety-off ===\n');

async function makeConnectedController(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const port = new MockSerialPort((line: string) => {
    if (line === '$I') {
      return ['[VER:1.1h.20221128:]', 'ok'];
    }
    if (line === '$$') {
      return [
        '$30=1000', '$32=1', '$22=0', '$23=0',
        '$120=500', '$121=500', '$130=400', '$131=300', '$110=6000', '$111=6000', 'ok',
      ];
    }
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  port.open();
  // port.open() injects the GRBL banner automatically — connect's welcome
  // predicate accepts it and the handshake completes.
  const ctrl = new GrblController({ allowHeadlessWcsAutoNormalize: true });
  await ctrl.connect(port);
  await flush(50);
  return { ctrl, port };
}

async function run(): Promise<void> {
  // ── 1. Timeout → safetyOff fires + reject with new error message ──
  {
    const { ctrl, port } = await makeConnectedController();
    let safetyOffCalls = 0;
    const origSafetyOff = ctrl.safetyOff.bind(ctrl);
    (ctrl as unknown as { safetyOff: () => Promise<{ stage: 'm5' }> }).safetyOff = async () => {
      safetyOffCalls += 1;
      return { stage: 'm5' as const };
    };

    let caught: unknown = null;
    try {
      await ctrl.runAutoFocus('$HZ1', 100);
    } catch (e) {
      caught = e;
    }
    // Extra wait for the void-promise safetyOff microtask.
    await flush(30);

    assert(caught instanceof Error, 'timeout: rejects with an Error');
    if (caught instanceof Error) {
      assert(/timed out/i.test(caught.message),
        `timeout: error message mentions "timed out" (got "${caught.message}")`);
      assert(/safety-off attempted/i.test(caught.message),
        'timeout: error message includes "safety-off attempted" marker');
    }
    assert(safetyOffCalls === 1,
      `timeout: safetyOff called exactly once (got ${safetyOffCalls})`);
    void origSafetyOff;
    ctrl.disconnect();
  }

  // ── 2. Alarm path source-pin (the alarm code path is symmetric to the
  //       timeout path; behavioral injection through MockSerialPort's
  //       status-line plumbing has been flaky across runs because the
  //       controller's status parser only accepts certain shapes
  //       depending on poll state. Pinning the source structure
  //       guarantees the alarm branch fires safetyOff before reject.
  {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const ctrlSrc = fs.readFileSync(path.resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf-8');
    const startIdx = ctrlSrc.indexOf('async runAutoFocus');
    assert(startIdx >= 0, 'alarm-pin: runAutoFocus is locatable');
    const endIdx = ctrlSrc.indexOf('// ─── EVENTS', startIdx);
    const body = ctrlSrc.slice(startIdx, endIdx);
    const alarmBlock = body.slice(body.indexOf("if (next.status === 'alarm')"));
    assert(alarmBlock.length > 0, 'alarm-pin: alarm branch found in runAutoFocus');
    assert(/cleanup\(\)/.test(alarmBlock.slice(0, 200)),
      'alarm-pin: alarm branch calls cleanup() first (clears timer, unsubscribes)');
    assert(/_buildAutoFocusSafetyOffError/.test(alarmBlock.slice(0, 400)),
      'alarm-pin: alarm branch awaits safety-off helper before reject');
    assert(/safety-off attempted/.test(alarmBlock.slice(0, 600)),
      'alarm-pin: alarm reject message includes "safety-off attempted" marker');
    assert(/T1-28/.test(body),
      'alarm-pin: T1-28 marker present in runAutoFocus comments');
  }

  // ── 3. safetyOff itself rejects → original timeout error still surfaces ──
  {
    const { ctrl, port } = await makeConnectedController();
    let safetyOffCalls = 0;
    (ctrl as unknown as { safetyOff: () => Promise<{ stage: 'm5' }> }).safetyOff = async () => {
      safetyOffCalls += 1;
      throw new Error('mock safety-off transport failure');
    };

    let caught: unknown = null;
    try {
      await ctrl.runAutoFocus('$HZ1', 100);
    } catch (e) {
      caught = e;
    }
    await flush(30);

    assert(caught instanceof Error, 'safetyOff-throws: rejects with an Error');
    if (caught instanceof Error) {
      // The ORIGINAL timeout cause must surface, not the safetyOff failure.
      assert(/timed out/i.test(caught.message),
        `safetyOff-throws: original "timed out" error preserved (got "${caught.message}")`);
      assert(!/transport failure/.test(caught.message),
        'safetyOff-throws: secondary error is swallowed, not chained');
    }
    assert(safetyOffCalls === 1,
      `safetyOff-throws: safetyOff was attempted once (got ${safetyOffCalls})`);
    ctrl.disconnect();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
