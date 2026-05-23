/**
 * BUG-004 / BUG-002: GRBL Jog reports must be treated as active motion,
 * and externally-held GRBL Hold must not be released by LaserForge resume.
 *
 * Run: npx tsx tests/grbl-jog-and-unowned-hold.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import { canExecuteOperation } from '../src/app/OperationGate';
import { grblCapabilities } from '../src/controllers/ControllerCapabilities';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

async function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectedControllerWithStatus(status: string): Promise<{
  ctrl: GrblController;
  port: MockSerialPort;
}> {
  const port = new MockSerialPort((line: string) => {
    if (line === '?') return [`<${status}|MPos:0,0,0|FS:0,0>`];
    return ['ok'];
  });
  const ctrl = new GrblController();
  port.open();
  await ctrl.connect(port);
  await flush();
  return { ctrl, port };
}

console.log('\n=== BUG-004 / BUG-002 GRBL jog and unowned Hold ===\n');

void (async () => {
  {
    const { ctrl } = await connectedControllerWithStatus('Jog');
    assert(ctrl.state.status === 'jog',
      `GRBL <Jog|...> updates controller state to 'jog' (got '${ctrl.state.status}')`);

    const state = {
      connected: true,
      status: 'jog',
      activeOperation: null,
      homingRequiredAtBoot: false,
    } as const;
    const unsafeOps = ['job-start', 'frame-safe', 'frame-dot', 'test-fire', 'home', 'set-origin'] as const;
    for (const op of unsafeOps) {
      const decision = canExecuteOperation(op, grblCapabilities, state);
      assert(!decision.allowed, `operation '${op}' is blocked while GRBL reports Jog`);
    }

    const idleDecision = canExecuteOperation('job-start', grblCapabilities, {
      ...state,
      status: 'idle',
    });
    assert(idleDecision.allowed, 'fresh Idle allows job-start again after Jog clears');
    await ctrl.disconnect();
  }

  {
    const { ctrl, port } = await connectedControllerWithStatus('Hold');
    port.realtimeBytes.length = 0;

    const result = await ctrl.resume();
    await flush();

    assert(result.accepted === false, 'direct controller resume refuses unowned Hold');
    assert(/no active LaserForge job/i.test(result.message ?? ''),
      `direct controller resume message names unowned Hold (got: ${result.message ?? ''})`);
    assert(!port.realtimeBytes.includes(0x7e),
      'direct controller resume does not send cycle-start for unowned Hold');

    await ctrl.disconnect();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
