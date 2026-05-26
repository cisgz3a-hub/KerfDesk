/**
 * T2-41 follow-up: MachineService.disconnect() returns a typed
 * SafetyActionResult instead of losing the outcome.
 *
 * Run: npx tsx tests/machine-service-disconnect-safety-result.test.ts
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

const alarm: MachineState = {
  ...idle,
  status: 'alarm',
  alarmCode: 1,
};

function makeController(args?: {
  disconnect?: () => Promise<void>;
  sendCommand?: (cmd: string) => void;
  state?: MachineState;
}): { controller: LaserController; calls: { disconnect: number; commands: string[]; laserOff: number } } {
  const calls = { disconnect: 0, commands: [] as string[], laserOff: 0 };
  const controller = {
    protocolName: 'mock',
    state: { ...(args?.state ?? idle) },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {
      calls.disconnect++;
      if (args?.disconnect) await args.disconnect();
    },
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: (cmd: string) => {
      calls.commands.push(cmd);
      args?.sendCommand?.(cmd);
    },
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
      laserOff: async () => {
        calls.laserOff++;
        return { ok: true };
      },
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
  return { controller, calls };
}

console.log('\n=== machine-service disconnect SafetyActionResult ===\n');

void (async () => {
  {
    const { controller, calls } = makeController();
    const portRef = { current: {} as SerialPortLike } as { current: SerialPortLike | null };
    const svc = new MachineService({ current: controller }, portRef);
    svc.notifyLaserSafetyOutcome('failed');

    const result: SafetyActionResult = await svc.disconnect();

    assert(calls.laserOff === 1, 'unknown laser state: disconnect uses controller operations.laserOff before controller disconnect');
    assert(calls.commands.length === 0, 'disconnect does not construct a raw M5 command in MachineService');
    assert(calls.disconnect === 1, 'disconnect calls controller.disconnect once');
    assert(portRef.current === null, 'disconnect clears portRef');
    assert(result.action === 'disconnectSafe', 'result action=disconnectSafe');
    assert(result.accepted === true, 'result accepted=true');
    assert(result.motionState === 'stopped', 'result motionState=stopped');
    assert(result.laserState === 'commandedOff', 'result laserState=commandedOff');
    assert(result.requiresReconnect === true, 'result requires reconnect after port close');
    assert(result.requiresInspection === false, 'routine disconnect does not require inspection');
  }

  {
    const { controller, calls } = makeController({ state: alarm });
    const portRef = { current: {} as SerialPortLike } as { current: SerialPortLike | null };
    const svc = new MachineService({ current: controller }, portRef);

    const result: SafetyActionResult = await svc.disconnect();

    assert(calls.laserOff === 0, 'GRBL4040 no-job alarm disconnect skips redundant laserOff when laser is already off');
    assert(calls.disconnect === 1, 'GRBL4040 no-job alarm disconnect still closes the controller transport');
    assert(portRef.current === null, 'GRBL4040 no-job alarm disconnect clears portRef');
    assert(result.action === 'disconnectSafe', 'GRBL4040 fast disconnect result action=disconnectSafe');
  }

  {
    const { controller } = makeController({
      state: alarm,
      disconnect: async () => new Promise<void>(() => {}),
    });
    const portRef = { current: {} as SerialPortLike } as { current: SerialPortLike | null };
    const svc = new MachineService({ current: controller }, portRef);

    const result = await Promise.race([
      svc.disconnect(),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 150)),
    ]);

    assert(result !== 'timeout', 'GRBL4040 no-job alarm disconnect is bounded when transport close stalls');
    assert(portRef.current === null, 'bounded disconnect still clears portRef');
  }

  {
    const { controller } = makeController({
      disconnect: async () => { throw new Error('close failed'); },
    });
    const portRef = { current: {} as SerialPortLike } as { current: SerialPortLike | null };
    const svc = new MachineService({ current: controller }, portRef);

    let result: SafetyActionResult | null = null;
    let threw = false;
    try {
      result = await svc.disconnect();
    } catch {
      threw = true;
    }

    assert(!threw, 'disconnect failure returns a typed result instead of throwing');
    assert(portRef.current === null, 'disconnect failure still clears portRef');
    assert(result?.action === 'disconnectSafe', 'failure result action=disconnectSafe');
    assert(result?.accepted === false, 'failure result accepted=false');
    assert(result?.requiresReconnect === true, 'failure result requiresReconnect=true');
    assert(/close failed/.test(result?.message ?? ''), 'failure result carries disconnect error message');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
