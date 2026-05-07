/**
 * T1-21: frame-dot must force laser-off in a finally block.
 *
 * Run: npx tsx tests/frame-dot-finally-emits-m5.test.ts
 */
import { ExecutionCoordinator, type FrameResult } from '../src/app/ExecutionCoordinator';
import { type SafetyAction, type SafetyActionResult } from '../src/app/SafetyActionResult';
import type { LaserController, MachineState } from '../src/controllers/ControllerInterface';
import { buildGrblFrameGcode } from '../src/controllers/grbl/GrblFrameGcode';

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

function acceptedSafety(action: SafetyAction): SafetyActionResult {
  return {
    action,
    accepted: true,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: false,
    requiresInspection: false,
    timestamp: Date.now(),
  };
}

interface MockController {
  ctrl: LaserController;
  sentCommands: string[];
  readonly safetyOffCalls: number;
}

function makeController(opts: {
  throwOnCommandIndex?: number;
  safetyOffThrows?: boolean;
} = {}): MockController {
  const sentCommands: string[] = [];
  let safetyOffCalls = 0;
  const state: MachineState = {
    status: 'idle',
    position: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    alarmCode: null,
    errorCode: null,
  };

  const ctrl = {
    protocolName: 'mock',
    state,
    isJobRunning: false,
    maxSpindle: null,
    async connect() { /* no-op */ },
    async disconnect() { /* no-op */ },
    async sendJob() { /* no-op */ },
    pause() { return acceptedSafety('pause'); },
    resume() { return acceptedSafety('resume'); },
    stop() { return acceptedSafety('abortJob'); },
    emergencyStop() { return acceptedSafety('emergencyStop'); },
    operations: {
      jog: async () => ({ ok: true as const }),
      home: async () => ({ ok: true as const }),
      unlockAlarm: async () => ({ ok: true as const }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true as const }),
      resetWcsToMachineOrigin: async () => ({ ok: true as const }),
      testFire: async () => ({ ok: true as const }),
      frame: async (args) => {
        const lines = buildGrblFrameGcode(args.corners, {
          startMode: args.startMode,
          laserMode: args.laserMode,
          maxSpindle: args.maxSpindle,
          crosshairAfterFrame: args.crosshairAfterFrame,
        });
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          try {
            ctrl.sendCommand(line);
          } catch (err) {
            return {
              ok: false as const,
              reason: 'command-blocked',
              message: err instanceof Error ? err.message : String(err),
              blockedAtLine: i,
            };
          }
          args.onCommand?.(line);
        }
        return { ok: true as const };
      },
      laserOff: async () => {
        safetyOffCalls++;
        if (opts.safetyOffThrows) throw new Error('mock: safetyOff transport failure');
        return { ok: true as const };
      },
      pauseJob: async () => ({ ok: true as const }),
      resumeJob: async () => ({ ok: true as const }),
      stopJob: async () => ({ ok: true as const }),
      emergencyStop: async () => ({ ok: true as const }),
    },
    async safetyOff() {
      safetyOffCalls++;
      if (opts.safetyOffThrows) throw new Error('mock: safetyOff transport failure');
      return { stage: 'm5' as const };
    },
    sendCommand(cmd: string) {
      if (opts.throwOnCommandIndex !== undefined && sentCommands.length === opts.throwOnCommandIndex) {
        throw new Error(`mock: rejected at index ${sentCommands.length}`);
      }
      sentCommands.push(cmd);
    },
    requestStatusReport() { /* no-op */ },
  } satisfies Partial<LaserController>;

  return {
    ctrl: ctrl as unknown as unknown as LaserController,
    sentCommands,
    get safetyOffCalls() {
      return safetyOffCalls;
    },
  };
}

function makeCoordinator(ctrl: LaserController): ExecutionCoordinator {
  return new ExecutionCoordinator({
    controllerRef: { current: ctrl },
    // T2-11: runFrame acquires/releases the operation mutex. Permissive
    // stub keeps the frame-dot finally semantics under test isolated
    // from the mutex layer (covered by tests/operation-mutex-prevents-overlap.test.ts).
    machineService: {
      notifyLaserSafetyOutcome: () => {},
      tryAcquireOperation: () => true,
      releaseOperation: () => {},
    } as never,
    notifySimulatorRef: { current: () => {} },
  });
}

const sceneBounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 };
const transformOpts = {
  startMode: 'absolute' as const,
  savedOrigin: null,
  originCorner: 'front-left' as const,
  bedHeightMm: 268,
};

console.log('\n=== T1-21 frame-dot finally emits M5 ===\n');

async function main(): Promise<void> {
  {
    const mock = makeController();
    const result = await makeCoordinator(mock.ctrl).frameSafe({
      sceneBounds,
      transformOpts,
      idleTimeoutMs: 1000,
    });
    assertContract(
      result.ok === true && mock.safetyOffCalls === 0,
      'frameSafe success does not call emergencyLaserOff',
    );
  }

  {
    const mock = makeController();
    const result = await makeCoordinator(mock.ctrl).frameDot({
      sceneBounds,
      transformOpts,
      maxSpindle: 1000,
      idleTimeoutMs: 1000,
    });
    assertContract(
      result.ok === true && mock.safetyOffCalls === 1,
      'frameDot success calls emergencyLaserOff once in finally',
    );
  }

  {
    const mock = makeController({ throwOnCommandIndex: 3 });
    const result = await makeCoordinator(mock.ctrl).frameDot({
      sceneBounds,
      transformOpts,
      maxSpindle: 1000,
      idleTimeoutMs: 1000,
    });
    assertContract(
      result.ok === false && result.reason === 'command-blocked' && mock.safetyOffCalls === 1,
      'frameDot command-blocked path still calls emergencyLaserOff',
    );
  }

  {
    const mock = makeController({ throwOnCommandIndex: 0 });
    const result = await makeCoordinator(mock.ctrl).frameDot({
      sceneBounds,
      transformOpts,
      maxSpindle: 1000,
      idleTimeoutMs: 1000,
    });
    assertContract(
      result.ok === false && result.reason === 'command-blocked' && mock.safetyOffCalls === 1,
      'frameDot blocked at index 0 still calls emergencyLaserOff',
    );
  }

  {
    const mock = makeController({ safetyOffThrows: true });
    const result: FrameResult = await makeCoordinator(mock.ctrl).frameDot({
      sceneBounds,
      transformOpts,
      maxSpindle: 1000,
      idleTimeoutMs: 1000,
    });
    assertContract(
      result.ok === true && mock.safetyOffCalls === 1,
      'throwing emergencyLaserOff is logged and does not mask original FrameResult',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
