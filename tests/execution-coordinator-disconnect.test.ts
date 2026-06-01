/**
 * ExecutionCoordinator emergencyLaserOff + safeDisconnect (T2-4 phase 7).
 * Run: npx tsx tests/execution-coordinator-disconnect.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import { type SafetyActionResult } from '../src/app/SafetyActionResult';
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

type LaserOffObserverArgs = { emergency?: boolean; onCommand?: (line: string) => void };

function operations(
  laserOff: (args?: LaserOffObserverArgs) => Promise<{ ok: true; message?: string } | { ok: false; reason: string; message?: string }>,
) {
  return {
    jog: async () => ({ ok: true as const }),
    home: async () => ({ ok: true as const }),
    unlockAlarm: async () => ({ ok: true as const }),
    setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
    resetWcsToMachineOrigin: async () => ({ ok: true as const }),
    laserOff,
    pauseJob: async () => ({ ok: true as const }),
    resumeJob: async () => ({ ok: true as const }),
    stopJob: async () => ({ ok: true as const }),
    emergencyStop: async () => ({ ok: true as const }),
  };
}

void (async () => {
  console.log('\n=== execution-coordinator disconnect cleanup ===\n');

  {
    let cancelConnectCalls = 0;
    let stopCalls = 0;
    let disconnectCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'connecting' as const },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {},
      sendJob: async () => {},
      pause: () => {},
      resume: () => {},
      stop: () => { stopCalls++; },
      emergencyStop: () => {},
      sendCommand: () => {},
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => ({ stage: 'm5' as const }),
      operations: operations(async () => ({ ok: true as const })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    (svc as unknown as { cancelActiveConnect: (reason?: Error) => Promise<boolean> }).cancelActiveConnect = async (reason?: Error) => {
      cancelConnectCalls++;
      assert(reason instanceof Error && /disconnect/i.test(reason.message),
        'connecting safeDisconnect passes a disconnect cancel reason');
      return true;
    };
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => {
      disconnectCalls++;
      return inner();
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect();
    assert(cancelConnectCalls === 1, 'connecting status -> safeDisconnect cancels active connect');
    assert(stopCalls === 0, 'connecting status -> safeDisconnect does not call stop');
    assert(disconnectCalls === 0, 'connecting status -> safeDisconnect does not run normal disconnect');
  }

  {
    const sent: string[] = [];
    let portDisconnectCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState },
      isJobRunning: false,
      maxSpindle: null,
      connect: async () => {},
      disconnect: async () => {
        portDisconnectCalls++;
      },
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
      operations: operations(async (args) => {
        sent.push('M5 S0');
        args?.onCommand?.('M5 S0');
        return { ok: true as const };
      }),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    await svc.disconnect();
    assert(
      portDisconnectCalls === 1 && sent.length === 0,
      'machineService.disconnect: no-job idle/off fast path closes without redundant M5',
    );
  }

  {
    const sent: string[] = [];
    let rawSafetyOffCalls = 0;
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
      safetyOff: async () => {
        rawSafetyOffCalls++;
        return { stage: 'm5' as const };
      },
      operations: operations(async (args) => {
        sent.push('M5 S0');
        args?.onCommand?.('M5 S0');
        return { ok: true as const };
      }),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    await coord.emergencyLaserOff();
    assert(sent.includes('M5 S0') && sim.includes('M5 S0') && rawSafetyOffCalls === 0,
      'emergencyLaserOff with controller uses operations.laserOff and not raw safetyOff');
  }

  {
    const portRef = { current: null } as { current: SerialPortLike | null };
    const controllerRef = { current: null } as { current: LaserController | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const sim: string[] = [];
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: (line: string) => { sim.push(line); } },
    });
    await coord.emergencyLaserOff();
    assert(sim.length === 0, 'no controller → no simulator M5');
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
      safetyOff: async () => ({ stage: 'failed' as const, error: new Error('Not connected') }),
      operations: operations(async () => ({ ok: false as const, reason: 'failed', message: 'Not connected' })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
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
      safetyOff: async () => ({ stage: 'failed' as const, error: new Error('serial fault') }),
      operations: operations(async () => ({ ok: false as const, reason: 'failed', message: 'serial fault' })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
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
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    let disconnectCalls = 0;
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => {
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
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
      operations: operations(async (args) => {
        sent.push('M5 S0');
        args?.onCommand?.('M5 S0');
        return { ok: true as const };
      }),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => {
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
    const m5FromSend = sent.filter(s => s === 'M5 S0').length;
    assert(m5FromSend === 0, 'safeDisconnect: no-job idle/off fast path skips redundant M5');
    assert(disconnectCalls === 1, 'safeDisconnect calls machineService.disconnect');
  }

  {
    let stopCalls = 0;
    let disconnectCalls = 0;
    const mock = {
      protocolName: 'mock',
      state: { ...baseState, status: 'run' as const },
      isJobRunning: true,
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
      sendCommand: () => {},
      requestStatusReport: () => {},
      onStateChange: () => () => {},
      onProgress: () => () => {},
      onError: () => () => {},
      onRawLine: () => () => {},
      safetyOff: async () => ({ stage: 'm5' as const }),
      operations: operations(async () => ({ ok: true as const })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: (options?: { jobWasRunningAtSequenceStart?: boolean }) => Promise<SafetyActionResult> }).disconnect = async (options) => {
      disconnectCalls++;
      assert(options?.jobWasRunningAtSequenceStart === true,
        'running toolbar disconnect preserves running-job proof');
      return inner(options);
    };
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect({ skipStop: true });
    assert(stopCalls === 1, 'running safeDisconnect ignores skipStop and sends stop');
    assert(disconnectCalls === 1, 'running safeDisconnect still closes through MachineService');
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
      safetyOff: async () => ({ stage: 'failed' as const, error: new Error('serial fault') }),
      operations: operations(async () => ({ ok: false as const, reason: 'failed', message: 'serial fault' })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => {
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
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
      operations: operations(async () => ({ ok: false as const, reason: 'failed', message: 'M5 blocked' })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => {
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
      safetyOff: async () => ({ stage: 'failed' as const, error: new Error('Not connected') }),
      operations: operations(async () => ({ ok: false as const, reason: 'failed', message: 'Not connected' })),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    let disconnectCalls = 0;
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => {
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
      safetyOff: async () => {
        sent.push('M5 S0');
        return { stage: 'm5' as const };
      },
      operations: operations(async (args) => {
        sent.push('M5 S0');
        args?.onCommand?.('M5 S0');
        return { ok: true as const };
      }),
    } as unknown as LaserController;
    const controllerRef = { current: mock };
    const portRef = { current: null } as { current: SerialPortLike | null };
    const svc = new MachineService(controllerRef as { current: LaserController }, portRef);
    const inner = svc.disconnect.bind(svc);
    (svc as unknown as { disconnect: () => Promise<SafetyActionResult> }).disconnect = async () => inner();
    const coord = new ExecutionCoordinator({
      machineService: svc,
      controllerRef,
      notifySimulatorRef: { current: () => {} },
    });
    await coord.safeDisconnect({ skipStop: true });
    assert(
      stopCalls === 0 && sent.filter(s => s === 'M5 S0').length === 0,
      'skipStop: no stop and no redundant M5 on no-job idle/off disconnect',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
