/**
 * ExecutionCoordinator jog (T2-4). Run: npx tsx tests/execution-coordinator.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

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

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeController(jogSpy: (axis: 'X' | 'Y', d: number, f: number) => void): LaserController {
  return {
    protocolName: 'mock',
    state: idle,
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: (cmd: string, _source?: string) => {
      void cmd;
    },
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async ({ axis, distanceMm, feedMmPerMin, onCommand }) => {
        jogSpy(axis as 'X' | 'Y', distanceMm, feedMmPerMin);
        onCommand?.(`$J=G91 G21 ${axis}${distanceMm} F${feedMmPerMin}`);
        return { ok: true };
      },
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as LaserController;
}

void (async () => {
  console.log('\n=== execution-coordinator (jog) ===\n');

  let jogCalls: Array<{ axis: 'X' | 'Y'; d: number; f: number }> = [];
  const mock = makeController((axis, d, f) => {
    jogCalls.push({ axis, d, f });
  });
  const controllerRef = { current: mock } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const svc = new MachineService(controllerRef, portRef);
  const simLines: string[] = [];
  const notifyRef = { current: (line: string) => { simLines.push(line); } };
  const coord = new ExecutionCoordinator({
    machineService: svc,
    controllerRef,
    notifySimulatorRef: notifyRef,
  });

  const jogResult = await coord.jog('X', 1.5, 2400);

  assert(simLines.length === 1 && simLines[0]?.includes('$J=') && simLines[0]?.includes('X1.5'), 'simulator sees $J line');
  assert(jogCalls.length === 1 && jogCalls[0]?.axis === 'X' && jogCalls[0]?.d === 1.5 && jogCalls[0]?.f === 2400, 'controller receives jog');
  assert(jogResult.ok === true, 'jog returns ok=true when accepted');

  jogCalls = [];
  const sim2: string[] = [];
  const nr2 = { current: (line: string) => { sim2.push(line); } };
  const coordNoCtrl = new ExecutionCoordinator({
    machineService: svc,
    controllerRef: { current: null },
    notifySimulatorRef: nr2,
  });
  const noCtrlResult = await coordNoCtrl.jog('Y', 10, 3000);
  assert(jogCalls.length === 0 && sim2.length === 0, 'no controller → jog is a no-op');
  assert(noCtrlResult.ok === false && noCtrlResult.reason === 'no-controller', 'no controller → jog returns no-controller result');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
