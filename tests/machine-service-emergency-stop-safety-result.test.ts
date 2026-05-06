/**
 * T2-41 follow-up: MachineService.emergencyStop() returns a typed
 * SafetyActionResult for the destructive soft-reset + disconnect path.
 *
 * Run: npx tsx tests/machine-service-emergency-stop-safety-result.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeController(args?: {
  emergencyStop?: () => void;
}): { controller: LaserController; calls: { emergencyStop: number } } {
  const calls = { emergencyStop: 0 };
  const controller = {
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: true,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {
      calls.emergencyStop++;
      args?.emergencyStop?.();
    },
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
  } as LaserController;
  return { controller, calls };
}

console.log('\n=== machine-service emergencyStop SafetyActionResult ===\n');

{
  const { controller, calls } = makeController();
  const portRef = { current: {} as SerialPortLike } as { current: SerialPortLike | null };
  const svc = new MachineService({ current: controller }, portRef);

  const result: SafetyActionResult = svc.emergencyStop();

  assert(calls.emergencyStop === 1, 'emergencyStop calls controller.emergencyStop once');
  assert(portRef.current === null, 'emergencyStop clears portRef');
  assert(result.action === 'emergencyStop', 'result action=emergencyStop');
  assert(result.accepted === true, 'result accepted=true');
  assert(result.motionState === 'stopped', 'result motionState=stopped');
  assert(result.laserState === 'commandedOff', 'result laserState=commandedOff');
  assert(result.positionTrusted === false, 'result positionTrusted=false');
  assert(result.requiresRehome === true, 'result requiresRehome=true');
  assert(result.requiresReconnect === true, 'result requiresReconnect=true');
  assert(result.requiresInspection === true, 'result requiresInspection=true');
}

{
  const { controller } = makeController({
    emergencyStop: () => { throw new Error('reset failed'); },
  });
  const portRef = { current: {} as SerialPortLike } as { current: SerialPortLike | null };
  const svc = new MachineService({ current: controller }, portRef);

  let result: SafetyActionResult | null = null;
  let threw = false;
  try {
    result = svc.emergencyStop();
  } catch {
    threw = true;
  }

  assert(!threw, 'emergencyStop failure returns a typed result instead of throwing');
  assert(portRef.current === null, 'emergencyStop failure still clears portRef');
  assert(result?.action === 'emergencyStop', 'failure result action=emergencyStop');
  assert(result?.accepted === false, 'failure result accepted=false');
  assert(result?.requiresReconnect === true, 'failure result requiresReconnect=true');
  assert(result?.requiresInspection === true, 'failure result requiresInspection=true');
  assert(/reset failed/.test(result?.message ?? ''), 'failure result carries emergency error message');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
