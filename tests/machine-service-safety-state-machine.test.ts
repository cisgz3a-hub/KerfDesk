/**
 * T2-44 follow-up: MachineService safety methods should feed their
 * SafetyActionResult outcomes into the canonical SafetyStateMachine.
 *
 * Run: npx tsx tests/machine-service-safety-state-machine.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import type { SafetyState } from '../src/app/SafetyStateMachine';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  fail - ${message}`);
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
  pause?: () => void;
  resume?: () => void;
  stop?: () => void;
  emergencyStop?: () => void;
}): LaserController {
  return {
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => { args?.pause?.(); },
    resume: () => { args?.resume?.(); },
    stop: () => { args?.stop?.(); },
    emergencyStop: () => { args?.emergencyStop?.(); },
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => {
        args?.pause?.();
        return { ok: true };
      },
      resumeJob: async () => {
        args?.resume?.();
        return { ok: true };
      },
      stopJob: async () => {
        args?.stop?.();
        return { ok: true };
      },
      emergencyStop: async () => {
        args?.emergencyStop?.();
        return { ok: true };
      },
    },
  } as unknown as LaserController;
}

function makeService(controller = makeController()): MachineService {
  return new MachineService(
    { current: controller },
    { current: {} as SerialPortLike } as { current: SerialPortLike | null },
  );
}

function kind(state: SafetyState): SafetyState['kind'] {
  return state.kind;
}

console.log('\n=== machine-service SafetyStateMachine wiring ===\n');

void (async () => {

{
  const svc = makeService();

  assert(kind(svc.getSafetyState()) === 'safeIdle', 'initial service safety state is safeIdle');

  await svc.pause();
  assert(kind(svc.getSafetyState()) === 'pausedVerified', 'pause result transitions service state to pausedVerified');

  await svc.resume();
  assert(kind(svc.getSafetyState()) === 'running', 'resume result transitions service state to running');

  await svc.stopAndEnsureLaserOff();
  const stopped = svc.getSafetyState();
  assert(kind(stopped) === 'stoppedPositionUnknown', 'soft-reset stop transitions to stoppedPositionUnknown');
  assert(
    stopped.kind !== 'stoppedPositionUnknown' || /rehome|required|position/i.test(stopped.reason),
    'soft-reset stop records rehome/position reason',
  );
}

{
  const svc = makeService();
  const observed: SafetyState['kind'][] = [];
  const unsubscribe = svc.onSafetyStateChange((state) => observed.push(state.kind));

  await svc.pause();
  await svc.resume();
  unsubscribe();
  await svc.pause();

  assert(observed.join(',') === 'pausedVerified,running', 'onSafetyStateChange publishes transitions and unsubscribes');
}

{
  const svc = makeService(makeController({
    emergencyStop: () => {},
  }));

  await svc.emergencyStop();
  assert(kind(svc.getSafetyState()) === 'requiresInspection', 'emergencyStop result transitions to requiresInspection');
}

{
  const svc = makeService(makeController({
    pause: () => { throw new Error('feed hold rejected'); },
  }));

  const result = await svc.pause();
  const state = svc.getSafetyState();

  assert(result.accepted === false, 'failed pause returns accepted=false');
  assert(kind(state) === 'unsafeUnknown', 'failed pause transitions to unsafeUnknown');
  assert(state.kind !== 'unsafeUnknown' || /feed hold rejected/.test(state.reason), 'failed pause carries controller error reason');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

export {};
