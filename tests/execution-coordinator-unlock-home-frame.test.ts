/**
 * ExecutionCoordinator unlock / home / frame (T2-4 phase 4).
 * Run: npx tsx tests/execution-coordinator-unlock-home-frame.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { buildFrameCorners, buildFrameGcode } from '../src/app/frameGcode';
import { FRAME_IDLE_POLL_MS } from '../src/app/grblIdlePoll';
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

function frameOperation(sent: string[], onLine?: (line: string) => void) {
  return async (args: Parameters<LaserController['operations']['frame']>[0]) => {
    const lines = buildFrameGcode(args.corners, {
      startMode: args.startMode,
      laserMode: args.laserMode,
      maxSpindle: args.maxSpindle,
      crosshairAfterFrame: args.crosshairAfterFrame,
    });
    for (const line of lines) {
      sent.push(line);
      args.onCommand?.(line);
      onLine?.(line);
    }
    return { ok: true as const };
  };
}

void (async () => {
  console.log('\n=== execution-coordinator unlock/home/frame ===\n');

  {
    const sent: string[] = [];
    const mock = {
      protocolName: 'mock',
      state: idle,
      isJobRunning: false,
      maxSpindle: null,
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async (args?: { onCommand?: (line: string) => void }) => {
          sent.push('$H');
          args?.onCommand?.('$H');
          return { ok: true as const };
        },
        unlockAlarm: async (args?: { onCommand?: (line: string) => void }) => {
          sent.push('$X');
          args?.onCommand?.('$X');
          return { ok: true as const };
        },
        setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
        resetWcsToMachineOrigin: async () => ({ ok: true as const }),
        testFire: async () => ({ ok: true as const }),
        frame: frameOperation(sent),
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
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const sim: string[] = [];
    const notifyRef = { current: (line: string) => { sim.push(line); } };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: notifyRef,
    });

    await coord.unlock();
    assert(sent.includes('$X'), 'unlock sends $X to controller');
    assert(sim.includes('$X'), 'unlock notifies simulator');

    sent.length = 0;
    sim.length = 0;
    await coord.home();
    assert(sent.includes('$H'), 'home sends $H');
    assert(sim.includes('$H'), 'home notifies simulator');
  }

  {
    const portRef = { current: null } as { current: SerialPortLike | null };
    const controllerRef = { current: null } as { current: LaserController | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const nr = { current: (_line: string) => {} };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: nr,
    });
    const r = await coord.frameSafe({
      sceneBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transformOpts: {
        startMode: 'current',
        savedOrigin: null,
        originCorner: 'front-left',
        bedHeightMm: 300,
      },
    });
    assert(r.ok === false && r.reason === 'no-controller', 'frameSafe without controller');
  }

  {
    const sent: string[] = [];
    const simLines: string[] = [];
    const nr = { current: (line: string) => { simLines.push(line); } };
    let status: 'idle' | 'run' = 'run';
    const mock = {
      protocolName: 'mock',
      get state() {
        return { ...idle, status };
      },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
      emergencyStop: () => {},
      sendCommand: (cmd: string, _s?: string) => {
        sent.push(cmd);
        if (cmd === 'G90') status = 'idle';
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
        resetWcsToMachineOrigin: async () => ({ ok: true as const }),
        testFire: async () => ({ ok: true as const }),
        frame: frameOperation(sent, (line) => {
          if (line === 'G90') status = 'idle';
        }),
        laserOff: async () => ({ ok: true as const }),
        pauseJob: async () => ({ ok: true as const }),
        resumeJob: async () => ({ ok: true as const }),
        stopJob: async () => ({ ok: true as const }),
        emergencyStop: async () => ({ ok: true as const }),
      },
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: nr,
    });

    const sceneBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const transformOpts = {
      startMode: 'current' as const,
      savedOrigin: null,
      originCorner: 'front-left' as const,
      bedHeightMm: 300,
    };
    const corners = buildFrameCorners(sceneBounds, transformOpts);
    const expected = buildFrameGcode(corners, {
      startMode: 'current',
      laserMode: 'off',
      maxSpindle: 1000,
      crosshairAfterFrame: true,
    });

    status = 'run';
    sent.length = 0;
    simLines.length = 0;
    const ok = await coord.frameSafe({ sceneBounds, transformOpts });
    assert(ok.ok, 'frameSafe completes when controller goes idle');
    assert(JSON.stringify(sent) === JSON.stringify(expected), 'frameSafe sends expected gcode sequence');
    assert(JSON.stringify(simLines) === JSON.stringify(expected), 'frameSafe notifies simulator per line');
  }

  {
    const nr = { current: (_line: string) => {} };
    let status: 'idle' | 'run' = 'run';
    const mock = {
      protocolName: 'mock',
      get state() {
        return { ...idle, status };
      },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
      emergencyStop: () => {},
      sendCommand: () => {},
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
        resetWcsToMachineOrigin: async () => ({ ok: true as const }),
        testFire: async () => ({ ok: true as const }),
        frame: frameOperation([]),
        laserOff: async () => ({ ok: true as const }),
        pauseJob: async () => ({ ok: true as const }),
        resumeJob: async () => ({ ok: true as const }),
        stopJob: async () => ({ ok: true as const }),
        emergencyStop: async () => ({ ok: true as const }),
      },
      safetyOff: async () => ({ stage: 'm5' as const }),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: nr,
    });
    const shortMs = FRAME_IDLE_POLL_MS * 2 + 50;
    const r = await coord.frameSafe({
      sceneBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transformOpts: {
        startMode: 'current',
        savedOrigin: null,
        originCorner: 'front-left',
        bedHeightMm: 300,
      },
      idleTimeoutMs: shortMs,
    });
    assert(r.ok === false && r.reason === 'idle-timeout', 'frameSafe idle-timeout when never idle');
  }

  {
    const sent: string[] = [];
    const nr = { current: (_line: string) => {} };
    let status: 'idle' | 'run' = 'run';
    const mock = {
      protocolName: 'mock',
      get state() {
        return { ...idle, status };
      },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
      emergencyStop: () => {},
      sendCommand: (cmd: string) => {
        sent.push(cmd);
        if (cmd === 'G90') status = 'idle';
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      operations: {
        jog: async () => ({ ok: true as const }),
        home: async () => ({ ok: true as const }),
        unlockAlarm: async () => ({ ok: true as const }),
        setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
        resetWcsToMachineOrigin: async () => ({ ok: true as const }),
        testFire: async () => ({ ok: true as const }),
        frame: frameOperation(sent, (line) => {
          if (line === 'G90') status = 'idle';
        }),
        laserOff: async () => {
          sent.push('M5 S0');
          return { ok: true as const };
        },
        pauseJob: async () => ({ ok: true as const }),
        resumeJob: async () => ({ ok: true as const }),
        stopJob: async () => ({ ok: true as const }),
        emergencyStop: async () => ({ ok: true as const }),
      },
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: nr,
    });
    const sceneBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const transformOpts = {
      startMode: 'current' as const,
      savedOrigin: null,
      originCorner: 'front-left' as const,
      bedHeightMm: 300,
    };
    status = 'run';
    sent.length = 0;
    await coord.frameDot({ sceneBounds, transformOpts, maxSpindle: 1000 });
    assert(sent.some(l => l.startsWith('M4 S')), 'frameDot emits M4');
    assert(sent.some(l => l === 'M4 S5'), 'frameDot M4 S5 for maxSpindle 1000');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
