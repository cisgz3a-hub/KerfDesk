/**
 * T3-60: disconnect must not be treated as a job stop for controllers
 * whose jobs keep running after the host transport closes.
 * Run: npx tsx tests/disconnect-stops-job-gating.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';
import type { LaserController, MachineState, OperationResult } from '../src/controllers/ControllerInterface';
import type { SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const idleState: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function safetyResult(action: SafetyActionResult['action'], accepted: boolean, message?: string): SafetyActionResult {
  return {
    action,
    accepted,
    motionState: accepted ? 'stopped' : 'unknown',
    laserState: accepted ? 'commandedOff' : 'unknown',
    positionTrusted: accepted ? true : 'unknown',
    requiresRehome: false,
    requiresReconnect: false,
    requiresInspection: !accepted,
    message,
    timestamp: 0,
  };
}

function okOperation(): OperationResult {
  return { ok: true };
}

function makeController(args: {
  family?: string;
  isJobRunning?: boolean;
  disconnectStopsJob?: boolean | 'unknown';
  abortAccepted?: boolean;
  exposeAbort?: boolean;
}) {
  const calls: string[] = [];
  const controller = {
    family: args.family ?? 'file-upload',
    state: { ...idleState, status: args.isJobRunning ? 'run' : 'idle' },
    isJobRunning: args.isJobRunning ?? false,
    capabilities: args.disconnectStopsJob === undefined ? undefined : {
      safety: { disconnectStopsJob: args.disconnectStopsJob },
    },
    safetyOps: args.exposeAbort === false ? undefined : {
      abortJob: async () => {
        calls.push('abortJob');
        return safetyResult(
          'abortJob',
          args.abortAccepted !== false,
          args.abortAccepted === false ? 'native stop refused' : undefined,
        );
      },
    },
    operations: {
      laserOff: async () => {
        calls.push('laserOff');
        return okOperation();
      },
    },
    disconnect: async () => {
      calls.push('disconnect');
    },
  } as unknown as LaserController;
  return { controller, calls };
}

async function disconnectWith(controller: LaserController) {
  const controllerRef = { current: controller };
  const portRef = { current: { close: () => undefined } as unknown as SerialPortLike };
  const service = new MachineService(controllerRef, portRef);
  const result = await service.disconnect();
  return { result, portRef };
}

console.log('\n=== T3-60 disconnect-stops-job capability gating ===\n');

void (async () => {
  {
    const { controller, calls } = makeController({
      family: 'grbl',
      isJobRunning: true,
      exposeAbort: false,
    });
    const { result, portRef } = await disconnectWith(controller);
    assert(result.accepted, 'GRBL running disconnect remains accepted');
    assert(!calls.includes('abortJob'), 'GRBL does not require extra native abort');
    assert(calls.join('>') === 'laserOff>disconnect', `GRBL order unchanged (${calls.join('>')})`);
    assert(portRef.current === null, 'GRBL disconnect still clears port ref');
  }

  {
    const { controller, calls } = makeController({
      family: 'file-upload',
      isJobRunning: true,
      disconnectStopsJob: false,
      abortAccepted: true,
    });
    const { result, portRef } = await disconnectWith(controller);
    assert(result.accepted, 'file-upload controller disconnect accepted after abort');
    assert(calls.join('>') === 'abortJob>laserOff>disconnect',
      `file-upload aborts job before close (${calls.join('>')})`);
    assert(portRef.current === null, 'successful gated disconnect clears port ref');
  }

  {
    const { controller, calls } = makeController({
      family: 'file-upload',
      isJobRunning: true,
      disconnectStopsJob: false,
      abortAccepted: false,
    });
    const { result, portRef } = await disconnectWith(controller);
    assert(!result.accepted, 'abort refusal blocks disconnect');
    assert(result.message?.includes('Cannot safely disconnect') === true,
      `blocker message explains unsafe disconnect (got ${result.message})`);
    assert(calls.join('>') === 'abortJob', `no laserOff/disconnect after refused abort (${calls.join('>')})`);
    assert(portRef.current !== null, 'blocked disconnect keeps port ref so host still controls machine');
  }

  {
    const { controller, calls } = makeController({
      family: 'device-native',
      isJobRunning: true,
      disconnectStopsJob: 'unknown',
      exposeAbort: false,
    });
    const { result, portRef } = await disconnectWith(controller);
    assert(!result.accepted, 'unknown disconnectStopsJob without abort blocks disconnect');
    assert(result.message?.includes('no native abort') === true,
      `missing abort message names native abort (got ${result.message})`);
    assert(calls.length === 0, 'no laserOff/disconnect when native abort is unavailable');
    assert(portRef.current !== null, 'blocked unknown-controller disconnect keeps port ref');
  }

  {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/app/MachineService.ts', 'utf8');
    assert(src.includes('T3-60'), 'MachineService carries T3-60 marker');
    assert(src.includes('disconnectStopsJob'), 'MachineService reads disconnectStopsJob');
    assert(src.includes('abortJob'), 'MachineService can call native abort before disconnect');
  }

  console.log(`\nDisconnect-stops-job gating: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
