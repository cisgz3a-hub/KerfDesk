/**
 * ExecutionCoordinator emergencyLaserOff + safeDisconnect (T2-4 phase 7).
 * Run: npx tsx tests/execution-coordinator-disconnect.test.ts
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

const baseState: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

void (async () => {
  console.log('\n=== execution-coordinator disconnect cleanup ===\n');

  {
    const sent: string[] = [];
    const mock = {
      protocolName: 'mock',
      state: { ...baseState },
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
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
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
    await coord.emergencyLaserOff();
    assert(sent.includes('M5 S0') && sim.includes('M5 S0'), 'emergencyLaserOff with controller sends M5 S0');
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
    await coord.emergencyLaserOff();
    assert(sim.length === 1 && sim[0] === 'M5 S0', 'no controller → simulator only M5');
  }

  {
    const mock = {
      protocolName: 'mock',
      state: { ...baseState },
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
      await coord.emergencyLaserOff();
    } finally {
      console.warn = orig;
    }
    assert(!warns.some(w => w.includes('[LaserOff]')), 'Not connected → no LaserOff warn');
  }

  {
    const mock = {
      protocolName: 'mock',
      state: { ...baseState },
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
      await coord.emergencyLaserOff();
    } finally {
      console.warn = orig;
    }
    assert(warns.some(w => w.includes('[LaserOff] blocked:')), 'other error → LaserOff warn');
  }

  {
    const portRef = { current: null } as { current: SerialPortLike | null };
    const controllerRef = { current: null } as { current: LaserController | null };
    const svc = new MachineService(controllerRef, portRef);
    let disconnectCalls = 0;
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnectCalls++;
      return inner();
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    let threw = false;
    try {
      await coord.safeDisconnect();
    } catch (e) {
      threw = true;
    }
    assert(!threw && disconnectCalls === 0, 'no controller → safeDisconnect no-op, no throw');
  }

  {
    const sent: string[] = [];
    let stopCalls = 0;
    let disconnectCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'idle' as const },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {
        stopCalls++;
      },
      emergencyStop: () => {},
      sendCommand: (cmd: string, _s?: string) => {
        sent.push(cmd);
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnectCalls++;
      return inner();
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect();
    assert(stopCalls === 1, 'safeDisconnect calls stop');
    assert(sent.includes('M5 S0'), 'safeDisconnect sends M5 S0');
    assert(disconnectCalls === 1, 'safeDisconnect calls machineService.disconnect');
  }

  {
    let stopCalls = 0;
    let disconnectCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'idle' as const },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {
        stopCalls++;
        throw new Error('stop failed');
      },
      emergencyStop: () => {},
      sendCommand: (cmd: string, _s?: string) => {
        void cmd;
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnectCalls++;
      return inner();
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect();
    assert(stopCalls === 1 && disconnectCalls === 1, 'stop throws → still disconnects');
  }

  {
    const sent: string[] = [];
    let disconnectCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'idle' as const },
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
        if (cmd === 'M5 S0') throw new Error('M5 blocked');
        sent.push(cmd);
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnectCalls++;
      return inner();
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect();
    assert(disconnectCalls === 1, 'M5 S0 throws → still reaches disconnect');
  }

  {
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'disconnected' as const },
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
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    let disconnectCalls = 0;
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnectCalls++;
      return inner();
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect();
    assert(disconnectCalls === 0, 'already disconnected status → no machineService.disconnect');
  }

  {
    const sent: string[] = [];
    let stopCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'idle' as const },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {
        stopCalls++;
      },
      emergencyStop: () => {},
      sendCommand: (cmd: string, _s?: string) => {
        sent.push(cmd);
      },
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
    } as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<void> }).disconnect = async () => inner();
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect({ skipStop: true });
    assert(stopCalls === 0 && sent.includes('M5 S0'), 'skipStop: no stop, still M5');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
