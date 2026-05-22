/**
 * WCS normalization must stay behind the same machine-state boundary as
 * other machine operations. The UI button can be stale for one render tick;
 * the controller must still refuse to rewrite G54/$10 while motion/job
 * execution is active.
 *
 * Run: npx tsx tests/wcs-normalization-operation-gate.test.ts
 */
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function sent(port: MockSerialPort): string[] {
  return port.received.map(line => line.trim());
}

function controllerWithOpenPort(): { ctrl: GrblController; port: MockSerialPort } {
  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  const priv = ctrl as unknown as {
    _port: MockSerialPort;
    _state: { status: string };
  };
  priv._port = port;
  priv._state.status = 'idle';
  return { ctrl, port };
}

async function run(): Promise<void> {
  console.log('\n=== WCS normalization operation gate ===\n');

  {
    const { ctrl, port } = controllerWithOpenPort();
    const priv = ctrl as unknown as {
      _isJobRunning: boolean;
      _placementUncertain: boolean;
    };
    priv._isJobRunning = true;
    priv._placementUncertain = true;

    ctrl.applyWcsNormalization?.();

    assert(!sent(port).includes('G10 L2 P1 X0 Y0 Z0'), 'active job: applyWcsNormalization does not write G10');
    assert(!sent(port).includes('$10=0'), 'active job: applyWcsNormalization does not write $10');
    assert(ctrl.getPlacementUncertain?.() === true, 'active job: placement remains uncertain when normalization is refused');
  }

  {
    const { ctrl, port } = controllerWithOpenPort();
    const priv = ctrl as unknown as {
      _state: { status: string };
      _placementUncertain: boolean;
    };
    priv._state.status = 'run';
    priv._placementUncertain = true;

    ctrl.applyWcsNormalization?.();

    assert(!sent(port).includes('G10 L2 P1 X0 Y0 Z0'), 'non-idle machine: applyWcsNormalization does not write G10');
    assert(!sent(port).includes('$10=0'), 'non-idle machine: applyWcsNormalization does not write $10');
    assert(ctrl.getPlacementUncertain?.() === true, 'non-idle machine: placement remains uncertain when normalization is refused');
  }

  {
    const { ctrl, port } = controllerWithOpenPort();
    const priv = ctrl as unknown as {
      _placementUncertain: boolean;
    };
    priv._placementUncertain = true;

    ctrl.applyWcsNormalization?.();

    assert(sent(port).includes('G10 L2 P1 X0 Y0 Z0'), 'idle machine: applyWcsNormalization still writes G10');
    assert(sent(port).includes('$10=0'), 'idle machine: applyWcsNormalization still writes $10');
    assert(ctrl.getPlacementUncertain?.() === false, 'idle machine: normalization clears placement uncertainty');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
