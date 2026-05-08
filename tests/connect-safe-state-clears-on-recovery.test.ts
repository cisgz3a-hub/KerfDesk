/**
 * T1-111: GrblController._unsafeAtConnect must clear when the
 * controller has demonstrably recovered to a known-safe state
 * (idle + FS 0,0). T1-25 captures the verdict at the first status
 * report after connect; pre-T1-111 it stayed sticky for the whole
 * session, so clicking the on-screen Unlock recovery button cleared
 * the GRBL alarm but left preflight blocking Start with "alarm
 * state from previous session." T1-111 adds a symmetric CLEAR
 * path on subsequent status reports without changing T1-25's
 * one-shot RAISE contract.
 *
 * Run: npx tsx tests/connect-safe-state-clears-on-recovery.test.ts
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

function portWith(initialStatus: string): MockSerialPort {
  const port = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=0', '$22=0', '$23=0', '$32=0', '$30=1000.000',
        '$110=10000.000', '$111=10000.000',
        '$120=10.000', '$121=10.000',
        '$130=400.000', '$131=300.000',
        'ok',
      ];
    }
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    if (line === '' || line.startsWith(';')) return line === '' ? ['ok'] : [];
    if (line.startsWith('$') && !line.startsWith('$J=')) return ['ok'];
    return ['ok'];
  });
  port.nextStatusQueryResponse = initialStatus;
  return port;
}

console.log('\n=== T1-111 _unsafeAtConnect clears on recovery to idle ===\n');

async function run(): Promise<void> {
  // 1. alarm at connect → verdict captured (regression check for T1-25)
  // 2. controller recovers to Idle + FS 0,0 → verdict clears
  {
    const port = portWith('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);

    const before = ctrl.getUnsafeAtConnect();
    assert(before?.reason === 'alarm', `precondition: verdict=alarm (got ${before?.reason})`);

    // Simulate user clicking Unlock — controller transitions to Idle.
    // The next ?-poll injects the new status; the listener clears the
    // verdict per T1-111.
    port.nextStatusQueryResponse =
      '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:0,0>';
    await flush(400);

    const after = ctrl.getUnsafeAtConnect();
    assert(after === null,
      `alarm → idle recovery: verdict cleared (got ${JSON.stringify(after)})`);

    await ctrl.disconnect();
  }

  // 3. hold at connect + recovery to idle → verdict clears
  {
    const port = portWith('<Hold|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    assert(ctrl.getUnsafeAtConnect()?.reason === 'hold',
      'precondition: hold verdict captured');

    port.nextStatusQueryResponse =
      '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:0,0>';
    await flush(400);

    assert(ctrl.getUnsafeAtConnect() === null,
      'hold → idle recovery: verdict cleared');
    await ctrl.disconnect();
  }

  // 4. unsafe-residual-spindle at connect + recovery to FS 0,0 → clears
  {
    const port = portWith('<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:1500,500>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    assert(ctrl.getUnsafeAtConnect()?.reason === 'unsafe-residual-spindle',
      'precondition: unsafe-residual-spindle verdict captured');

    port.nextStatusQueryResponse =
      '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:0,0>';
    await flush(400);

    assert(ctrl.getUnsafeAtConnect() === null,
      'unsafe-residual-spindle → FS:0,0 recovery: verdict cleared');
    await ctrl.disconnect();
  }

  // 5. T1-25 contract preserved: subsequent status reports do NOT
  //    re-raise a new verdict. Idle at connect → null verdict; even
  //    if controller later transitions to Alarm mid-session, the
  //    connect-time verdict stays null (alarm/error listeners handle
  //    mid-session unsafe states; T1-25/T1-111 are connect-time only).
  {
    const port = portWith('<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    assert(ctrl.getUnsafeAtConnect() === null, 'precondition: idle → null verdict');

    // Simulate mid-session alarm. T1-111 must not re-raise.
    port.nextStatusQueryResponse = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';
    await flush(400);

    assert(ctrl.getUnsafeAtConnect() === null,
      'T1-25 contract preserved: mid-session alarm does NOT re-raise the connect-time verdict',
    );
    await ctrl.disconnect();
  }

  // 6. Alarm at connect + recovery + new alarm mid-session →
  //    cleared once, NOT re-raised when alarm comes back. The CLEAR
  //    path is symmetric, but the contract is "raise only on first
  //    status after connect."
  {
    const port = portWith('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    port.open();
    const ctrl = new GrblController();
    await ctrl.connect(port);
    await flush(300);
    assert(ctrl.getUnsafeAtConnect()?.reason === 'alarm',
      'precondition: alarm verdict captured');

    port.nextStatusQueryResponse =
      '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|FS:0,0>';
    await flush(400);
    assert(ctrl.getUnsafeAtConnect() === null,
      'cleared after recovery (precondition for re-raise check)');

    port.nextStatusQueryResponse = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';
    await flush(400);
    assert(ctrl.getUnsafeAtConnect() === null,
      'subsequent alarm does NOT re-raise (CLEAR-only T1-111 path)',
    );
    await ctrl.disconnect();
  }

  // 7. Source-pin: T1-111 marker + symmetric clear in _handleStatusReport
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __filename = url.fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const ctrlPath = path.resolve(__dirname, '..', 'src', 'controllers', 'grbl', 'GrblController.ts');
    const src = fs.readFileSync(ctrlPath, 'utf8');
    assert(/T1-111/.test(src), 'T1-111 marker present in GrblController.ts');
    assert(
      /this\._unsafeAtConnect\s*=\s*null;[^]{0,400}T1-111|T1-111[^]{0,800}this\._unsafeAtConnect\s*=\s*null/.test(src),
      'T1-111 block clears _unsafeAtConnect = null',
    );
    assert(
      /T1-111[^]{0,800}_classifySafeStateReason\(\)\s*===\s*null/.test(src),
      'T1-111 clear path gates on _classifySafeStateReason() returning null',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
