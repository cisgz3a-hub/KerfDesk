/**
 * ExecutionCoordinator test fire + set origin (T2-4 phase 5).
 * Run: npx tsx tests/execution-coordinator-testfire-setorigin.test.ts
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

void (async () => {
  console.log('\n=== execution-coordinator testfire + setorigin ===\n');

  {
    const sent: string[] = [];
    const mock = {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => {
          sent.push('G10 L20 P1 X0 Y0');
          return { ok: true as const };
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
      sendCommand: (cmd: string, _s?: string) => {
        sent.push(cmd);
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const sim: string[] = [];
    const notifyRef = { current: (line: string) => { sim.push(line); } };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: notifyRef,
    });

    assert((await coord.beginTestFire({ maxSpindle: 1000 })) === true, 'beginTestFire 1000 returns true');
    assert(sent.includes('M3 S50') && sim.includes('M3 S50'), 'beginTestFire 1000 sends M3 S50');

    sent.length = 0;
    sim.length = 0;
    await coord.beginTestFire({ maxSpindle: 500 });
    assert(sent.includes('M3 S25'), 'beginTestFire 500 → M3 S25');

    sent.length = 0;
    sim.length = 0;
    await coord.beginTestFire({ maxSpindle: 0 });
    assert(sent.includes('M3 S0'), 'beginTestFire 0 → M3 S0');
  }

  {
    const portRef = { current: null } as { current: SerialPortLike | null };
    const controllerRef = { current: null } as { current: LaserController | null };
    const svc = new MachineService(controllerRef, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    assert((await coord.beginTestFire({ maxSpindle: 1000 })) === false, 'no controller → beginTestFire false');
    assert(sim.length === 0, 'no controller → no simulator notify for begin');
  }

  {
    const mock = {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => {
          sent.push('G10 L20 P1 X0 Y0');
          return { ok: true as const };
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
      sendCommand: () => {
        throw new Error('blocked');
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => ({ stage: 'm5' as const }),
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    assert((await coord.beginTestFire({ maxSpindle: 1000 })) === false, 'sendCommand throws → false');
  }

  {
    const sent: string[] = [];
    const mock = {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => {
          sent.push('G10 L20 P1 X0 Y0');
          return { ok: true as const };
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
      sendCommand: (cmd: string, _s?: string) => {
        sent.push(cmd);
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    await coord.endTestFire();
    assert(sent.includes('M5 S0') && sim.includes('M5 S0'), 'endTestFire with controller sends M5 S0');
  }

  {
    const portRef = { current: null } as { current: SerialPortLike | null };
    const controllerRef = { current: null } as { current: LaserController | null };
    const svc = new MachineService(controllerRef, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    await coord.endTestFire();
    assert(sim.length === 1 && sim[0] === 'M5 S0', 'no controller → simulator only M5');
  }

  {
    const mock = {
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
      sendCommand: () => {
        throw new Error('Not connected');
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => ({ stage: 'failed' as const, error: new Error('Not connected') }),
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(a => String(a)).join(' '));
    };
    try {
      await coord.endTestFire();
    } finally {
      console.warn = orig;
    }
    assert(!warns.some(w => w.includes('[LaserOff] blocked:')), 'Not connected → no LaserOff warn');
  }

  {
    const mock = {
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
      sendCommand: () => {
        throw new Error('serial fault');
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => ({ stage: 'failed' as const, error: new Error('serial fault') }),
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(a => String(a)).join(' '));
    };
    try {
      await coord.endTestFire();
    } finally {
      console.warn = orig;
    }
    assert(warns.some(w => w.includes('[LaserOff] blocked:')), 'other error → LaserOff warn');
  }

  {
    const sent: string[] = [];
    const mock = {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => {
          sent.push('G10 L20 P1 X0 Y0');
          return { ok: true as const };
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
      sendCommand: (cmd: string, _s?: string) => {
        sent.push(cmd);
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    const result = await coord.setOriginAtCurrentPosition();
    assert(
      sent.length === 1 && sent[0] === 'G10 L20 P1 X0 Y0',
      'setOriginAtCurrentPosition sends G10 L20 P1 X0 Y0',
    );
    assert(result.ok === true, 'setOriginAtCurrentPosition returns ok=true on success');
    assert(sim.length === 1 && sim[0] === 'G10 L20 P1 X0 Y0', 'setOrigin notifies simulator');
  }

  {
    const portRef = { current: null } as { current: SerialPortLike | null };
    const controllerRef = { current: null } as { current: LaserController | null };
    const svc = new MachineService(controllerRef, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    const result = await coord.setOriginAtCurrentPosition();
    assert(sim.length === 0, 'no controller → setOrigin no simulator G10 (early return)');
    assert(result.ok === false && result.reason === 'no-controller', 'no controller → setOrigin returns no-controller result');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
