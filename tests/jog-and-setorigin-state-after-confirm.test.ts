/**
 * T1-105: Jog and Set Origin expose transport-accept results so UI state
 * updates only after sendCommand accepts the line.
 *
 * Run: npx tsx tests/jog-and-setorigin-state-after-confirm.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { sendSetOriginWcsCommand } from '../src/app/sendSetOriginWcsCommand';
import type { LaserController, MachineState } from '../src/controllers/ControllerInterface';
import type { SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
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

function makeController(opts: { throwOnSend?: boolean } = {}): { ctrl: LaserController; sent: string[] } {
  const sent: string[] = [];
  const send = (cmd: string): void => {
    if (opts.throwOnSend) throw new Error('mock: transport rejected');
    sent.push(cmd);
  };
  const ctrl = {
    protocolName: 'mock',
    state: idleState,
    isJobRunning: false,
    maxSpindle: null,
    operations: {
      jog: async ({ axis, distanceMm, feedMmPerMin }) => {
        try {
          send(`$J=G91 G21 ${axis}${distanceMm} F${feedMmPerMin}`);
          return { ok: true as const };
        } catch (err: unknown) {
          return { ok: false as const, reason: err instanceof Error ? err.message : String(err) };
        }
      },
      home: async () => ({ ok: true as const }),
      unlockAlarm: async () => ({ ok: true as const }),
      setWorkOriginAtCurrentPosition: async () => {
        try {
          send('G10 L20 P1 X0 Y0');
          return { ok: true as const };
        } catch (err: unknown) {
          return { ok: false as const, reason: err instanceof Error ? err.message : String(err) };
        }
      },
      resetWcsToMachineOrigin: async () => ({ ok: true as const }),
      laserOff: async () => ({ ok: true as const }),
      pauseJob: async () => ({ ok: true as const }),
      resumeJob: async () => ({ ok: true as const }),
      stopJob: async () => ({ ok: true as const }),
      emergencyStop: async () => ({ ok: true as const }),
    },
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: send,
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
  } satisfies LaserController;
  return { ctrl, sent };
}

function makeService(ctrl: LaserController | null): MachineService {
  const controllerRef = { current: ctrl } as { current: LaserController };
  const portRef = { current: null } as { current: SerialPortLike | null };
  return new MachineService(controllerRef, portRef);
}

function makeCoordinator(ctrl: LaserController | null, sim: string[] = []): ExecutionCoordinator {
  const controllerRef = { current: ctrl } as { current: LaserController | null };
  const portRef = { current: null } as { current: SerialPortLike | null };
  const machineService = new MachineService(
    controllerRef as { current: LaserController },
    portRef,
  );
  return new ExecutionCoordinator({
    controllerRef,
    machineService,
    notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
  });
}

console.log('\n=== T1-105 Jog + Set Origin state-after-confirm ===\n');

void (async () => {
  {
    const { ctrl, sent } = makeController();
    const result = sendSetOriginWcsCommand(ctrl);
    assertContract(result.ok === true && sent[0] === 'G10 L20 P1 X0 Y0',
      'sendSetOriginWcsCommand success returns ok=true and emits G10');
  }

  {
    const result = sendSetOriginWcsCommand(null);
    assertContract(result.ok === false && result.reason === 'no-controller',
      'sendSetOriginWcsCommand null controller returns no-controller');
  }

  {
    const { ctrl } = makeController({ throwOnSend: true });
    const result = sendSetOriginWcsCommand(ctrl);
    assertContract(result.ok === false && (result.reason ?? '').includes('rejected'),
      'sendSetOriginWcsCommand transport throw returns error reason');
  }

  {
    const { ctrl, sent } = makeController();
    const result = makeService(ctrl).jog('X', 10, 3000);
    assertContract(result.ok === true && sent[0]?.startsWith('$J=G91 G21 X10'),
      'MachineService.jog success returns ok=true and emits jog');
  }

  {
    const result = makeService(null).jog('X', 10, 3000);
    assertContract(result.ok === false && result.reason === 'no-controller',
      'MachineService.jog null controller returns no-controller');
  }

  {
    const { ctrl } = makeController({ throwOnSend: true });
    const result = makeService(ctrl).jog('X', 10, 3000);
    assertContract(result.ok === false && (result.reason ?? '').includes('rejected'),
      'MachineService.jog transport throw returns error reason');
  }

  {
    const { ctrl } = makeController();
    const sim: string[] = [];
    const result = makeCoordinator(ctrl, sim).jog('Y', 5, 2000);
    assertContract(result.ok === true && sim[0]?.includes('$J=G91 G21 Y5'),
      'ExecutionCoordinator.jog forwards success and notifies simulator');
  }

  {
    const { ctrl, sent } = makeController();
    const result = await makeCoordinator(ctrl).setOriginAtCurrentPosition();
    assertContract(result.ok === true && sent[0] === 'G10 L20 P1 X0 Y0',
      'ExecutionCoordinator.setOriginAtCurrentPosition forwards success');
  }

  {
    const { ctrl } = makeController({ throwOnSend: true });
    const sim: string[] = [];
    const result = await makeCoordinator(ctrl, sim).setOriginAtCurrentPosition();
    assertContract(result.ok === false && sim[0] === 'G10 L20 P1 X0 Y0',
      'ExecutionCoordinator.setOriginAtCurrentPosition returns failure and still records simulator intent');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
