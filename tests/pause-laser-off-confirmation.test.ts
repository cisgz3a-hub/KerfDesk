/**
 * T1-252: pause must not report a clean, safe pause until the M5 S0
 * laser-off write has actually completed.
 *
 * Pre-T1-252 `GrblController.pause()` emitted feed-hold, fired
 * `_writeCriticalSystemLine('M5 S0')` in a detached promise, and
 * returned `makePauseResult()` immediately. A transport failure in
 * that M5 path only reached console.warn, while MachineService saw a
 * clean paused state.
 *
 * Run: npx tsx tests/pause-laser-off-confirmation.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import { MachineService } from '../src/app/MachineService';
import type { LaserController } from '../src/controllers/ControllerInterface';
import type { SerialPortLike } from '../src/communication/SerialPort';
import type { SafetyActionResult } from '../src/controllers/SafetyActionResult';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function forceRunning(ctrl: GrblController, port: MockSerialPort): void {
  const internals = ctrl as unknown as {
    _port: SerialPortLike;
    _isJobRunning: boolean;
    _state: { status: string };
  };
  internals._port = port;
  internals._isJobRunning = true;
  internals._state = { ...internals._state, status: 'run' };
}

function pauseFailureResult(message = 'M5 S0 failed during pause'): SafetyActionResult {
  return {
    action: 'pause',
    accepted: false,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: false,
    requiresInspection: true,
    message,
    timestamp: 252,
  };
}

async function main(): Promise<void> {
  console.log('\n=== T1-252 pause laser-off confirmation ===\n');

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    await port.open();
    forceRunning(ctrl, port);

    const result = await ctrl.pause();
    assert(port.realtimeBytes.includes(0x21), 'pause sends feed-hold before reporting');
    assert(port.received.includes('M5 S0'), 'pause writes M5 S0 through the critical path');
    assert(result.accepted === true, 'M5 success: pause result accepted');
    assert(result.laserState === 'off', "M5 success: pause result laserState is confirmed 'off'");
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    await port.open();
    forceRunning(ctrl, port);
    port.failNextCriticalWrite = true;

    const result = await ctrl.pause();
    assert(port.realtimeBytes.includes(0x21), 'M5 failure: feed-hold is still sent first');
    assert(result.accepted === false, 'M5 failure: pause result is not accepted as clean');
    assert(result.laserState === 'unknown', 'M5 failure: laser state is unknown');
    assert(result.requiresInspection === true, 'M5 failure: operator inspection is required');
    assert(/M5 S0|laser-off/i.test(result.message ?? ''), 'M5 failure: message names the laser-off failure');
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    await port.open();
    forceRunning(ctrl, port);

    const operationResult = await ctrl.operations.pauseJob();
    const safetyResult = 'safetyResult' in operationResult
      ? operationResult.safetyResult
      : undefined;
    assert(operationResult.ok === true, 'operations.pauseJob returns ok on confirmed pause');
    assert(
      safetyResult?.action === 'pause' && safetyResult.laserState === 'off',
      'operations.pauseJob carries the controller SafetyActionResult for MachineService',
    );
  }

  {
    const mockController = {
      protocolName: 'mock',
      state: {
        status: 'idle',
        position: { x: 0, y: 0, z: 0 },
        feedRate: 0,
        spindleSpeed: 0,
        alarmCode: null,
        errorCode: null,
      },
      isJobRunning: false,
      maxSpindle: null,
      operations: {
        pauseJob: async () => ({
          ok: false as const,
          reason: 'pause laser-off failed',
          safetyResult: pauseFailureResult(),
        }),
      },
      requestStatusReport: () => {},
    } as unknown as LaserController;

    const service = new MachineService(
      { current: mockController },
      { current: null } as { current: SerialPortLike | null },
    );

    const result = await service.pause();
    assert(result.accepted === false, 'MachineService preserves failed pause result');
    assert(result.laserState === 'unknown', 'MachineService sees failed pause laser state');
    assert(service.getSafetyState().kind === 'unsafeUnknown', 'failed pause latches unsafe safety state');
    assert(service.getLaserOutputState() === 'unknown', 'failed pause latches unknown laser-output state');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

export {};
