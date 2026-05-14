/**
 * T2-41 follow-up: direct GRBL safety methods must return
 * SafetyActionResult, not void, so callers that still use the
 * controller-level API can log and gate on the actual outcome.
 *
 * Run: npx tsx tests/controller-safety-action-result-methods.test.ts
 */

import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import type { SafetyAction, SafetyActionResult } from '../src/app/SafetyActionResult';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSafetyActionResult(value: unknown, action: SafetyAction): value is SafetyActionResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Partial<SafetyActionResult>;
  return (
    result.action === action &&
    typeof result.accepted === 'boolean' &&
    typeof result.requiresReconnect === 'boolean' &&
    typeof result.requiresInspection === 'boolean' &&
    typeof result.timestamp === 'number'
  );
}

async function main(): Promise<void> {
  console.log('\n=== Controller safety methods return SafetyActionResult ===');

  {
    const ctrl = new GrblController();
    const pause = await ctrl.pause();
    // T1-216 (v30 audit #3): resume is async — awaits the modal
    // spindle reassert (`M3/M4 S0`) before issuing cycle-start so
    // a failed reassert blocks motion restart.
    const resume = await ctrl.resume();
    const stop = ctrl.stop();
    const emergency = ctrl.emergencyStop();

    assert(isSafetyActionResult(pause, 'pause'), 'pause() returns a pause SafetyActionResult');
    assert(pause.accepted === false, 'pause() with no port is refused');
    assert(pause.requiresReconnect === true, 'pause() with no port requires reconnect');

    assert(isSafetyActionResult(resume, 'resume'), 'resume() returns a resume SafetyActionResult');
    assert(resume.accepted === false, 'resume() with no port is refused');

    assert(isSafetyActionResult(stop, 'abortJob'), 'stop() returns an abortJob SafetyActionResult');
    assert(stop.accepted === false, 'stop() with no port is refused');

    assert(isSafetyActionResult(emergency, 'emergencyStop'), 'emergencyStop() returns an emergencyStop SafetyActionResult');
    assert(emergency.accepted === false, 'emergencyStop() with no port is refused');
    assert(emergency.requiresInspection === false, 'unconnected emergency stop does not claim machine inspection is newly required');

    const pauseOperation = await ctrl.operations.pauseJob();
    const stopOperation = await ctrl.operations.stopJob();
    const emergencyOperation = await ctrl.operations.emergencyStop();
    assert(!pauseOperation.ok, 'operations.pauseJob() preserves no-port refusal');
    assert(!stopOperation.ok, 'operations.stopJob() preserves no-port refusal');
    assert(!emergencyOperation.ok, 'operations.emergencyStop() preserves no-port refusal');
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort((line: string) => {
      if (line.startsWith(';')) return [];
      if (/\bG0\b|\bG00\b/.test(line)) return [];
      return ['ok'];
    });
    port.open();
    await ctrl.connect(port);
    await flush();
    const lines = ['G21', 'G90', 'G0 X1 Y1', 'M2'];
    await ctrl.sendJob(lines);
    await flush();
    port.realtimeBytes.length = 0;

    const pause = await ctrl.pause();
    await flush();
    assert(isSafetyActionResult(pause, 'pause'), 'connected pause() returns a typed result');
    assert(pause.accepted === true, 'connected pause() is accepted');
    assert(pause.motionState === 'paused', 'connected pause() reports paused motion');
    assert(pause.laserState === 'off', 'connected pause() reports confirmed laser off');
    assert(port.realtimeBytes.includes(0x21), 'connected pause() still sends feed hold');

    // T1-216 (v30 audit #3): resume is async — await the modal
    // reassert before checking the result.
    const resume = await ctrl.resume();
    assert(isSafetyActionResult(resume, 'resume'), 'connected resume() returns a typed result');
    assert(resume.accepted === true, 'resume() after pause is accepted');
    assert(resume.motionState === 'running', 'resume() reports running motion');
    assert(port.realtimeBytes.includes(0x7e), 'resume() still sends cycle start');

    const stop = ctrl.stop();
    assert(isSafetyActionResult(stop, 'abortJob'), 'connected stop() returns a typed result');
    assert(stop.accepted === true, 'connected stop() is accepted');
    assert(stop.requiresRehome === true, 'connected stop() requires rehome');
    assert(port.realtimeBytes.includes(0x18), 'connected stop() still sends soft reset');

    await ctrl.disconnect();
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    const emergency = ctrl.emergencyStop();
    await flush(250);

    assert(isSafetyActionResult(emergency, 'emergencyStop'), 'connected emergencyStop() returns a typed result');
    assert(emergency.accepted === true, 'connected emergencyStop() is accepted');
    assert(emergency.requiresReconnect === true, 'connected emergencyStop() requires reconnect');
    assert(emergency.requiresInspection === true, 'connected emergencyStop() requires inspection');
    assert(port.realtimeBytes.includes(0x18), 'connected emergencyStop() still sends soft reset');
    assert(port.isOpen === false, 'connected emergencyStop() still closes the port');
  }

  console.log(`\nController safety action result methods: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
