/**
 * T1-103: runFrame must fail with reason='command-blocked' if any
 * ctrl.sendCommand() call throws during corner streaming.
 *
 * Run: npx tsx tests/run-frame-fail-fast-on-blocked-command.test.ts
 */
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import type { LaserController } from '../src/controllers/ControllerInterface';
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

interface MockController {
  state: LaserController['state'];
  sentCommands: string[];
  throwOnCommandIndex: number | null;
  operations: LaserController['operations'];
  sendCommand: (cmd: string, source?: 'internal' | 'user') => void;
  requestStatusReport: () => void;
}

function makeController(throwOnIndex: number | null = null): MockController {
  const ctrl: MockController = {
    state: {
      status: 'idle',
      position: { x: 0, y: 0, z: 0 },
      feedRate: 0,
      spindleSpeed: 0,
      alarmCode: null,
      errorCode: null,
    },
    sentCommands: [],
    throwOnCommandIndex: throwOnIndex,
    sendCommand(cmd: string) {
      if (this.throwOnCommandIndex !== null && this.sentCommands.length === this.throwOnCommandIndex) {
        throw new Error(`mock: command rejected at index ${this.sentCommands.length}`);
      }
      this.sentCommands.push(cmd);
    },
    requestStatusReport() {
      /* no-op */
    },
    operations: {} as LaserController['operations'],
  };
  ctrl.operations = {
    jog: async () => ({ ok: true }),
    home: async () => ({ ok: true }),
    unlockAlarm: async () => ({ ok: true }),
    setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
    resetWcsToMachineOrigin: async () => ({ ok: true }),
    testFire: async () => ({ ok: true }),
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
            ok: false,
            reason: 'command-blocked',
            message: err instanceof Error ? err.message : String(err),
            blockedAtLine: i,
          };
        }
        args.onCommand?.(line);
      }
      return { ok: true };
    },
    laserOff: async () => ({ ok: true }),
    pauseJob: async () => ({ ok: true }),
    resumeJob: async () => ({ ok: true }),
    stopJob: async () => ({ ok: true }),
    emergencyStop: async () => ({ ok: true }),
  };
  return ctrl;
}

function makeCoordinator(ctrl: MockController | null): ExecutionCoordinator {
  return new ExecutionCoordinator({
    controllerRef: { current: ctrl as unknown as LaserController | null },
    // T2-11: runFrame now acquires/releases the operation mutex. Provide
    // a permissive stub so existing frame-flow tests aren't blocked by
    // a missing mutex; tryAcquireOperation always returns true, releaseOperation no-ops.
    machineService: {
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

console.log('\n=== T1-103 runFrame fail-fast on blocked command ===\n');

async function main(): Promise<void> {
  {
  const ctrl = makeController(null);
  const coordinator = makeCoordinator(ctrl);
  const result = await coordinator.frameSafe({
    sceneBounds,
    transformOpts,
    idleTimeoutMs: 1000,
  });
  assertContract(
    result.ok === true && result.reason === undefined && ctrl.sentCommands.length > 0,
    'successful frame returns ok=true and sends commands',
  );
  }

  {
  const ctrl = makeController(0);
  const coordinator = makeCoordinator(ctrl);
  const result = await coordinator.frameSafe({
    sceneBounds,
    transformOpts,
    idleTimeoutMs: 1000,
  });
  assertContract(
    result.ok === false
      && result.reason === 'command-blocked'
      && result.blockedAtLine === 0
      && typeof result.blockedError === 'string'
      && result.blockedError.length > 0
      && ctrl.sentCommands.length === 0,
    'throw at index 0 returns command-blocked and sends zero commands',
  );
  }

  {
  const ctrl = makeController(1);
  const coordinator = makeCoordinator(ctrl);
  const result = await coordinator.frameSafe({
    sceneBounds,
    transformOpts,
    idleTimeoutMs: 1000,
  });
  assertContract(
    result.ok === false
      && result.reason === 'command-blocked'
      && result.blockedAtLine === 1
      && ctrl.sentCommands.length === 1,
    'throw at index 1 returns command-blocked after one sent command',
  );
  }

  {
  const ctrl = makeController(0);
  const coordinator = makeCoordinator(ctrl);
  const result = await coordinator.frameSafe({
    sceneBounds,
    transformOpts,
    idleTimeoutMs: 1000,
  });
  assertContract(
    result.ok === false && (result.blockedError ?? '').includes('rejected at index'),
    'blockedError preserves the thrown error message',
  );
  }

  {
  const coordinator = makeCoordinator(null);
  const result = await coordinator.frameSafe({
    sceneBounds,
    transformOpts,
    idleTimeoutMs: 1000,
  });
  assertContract(result.ok === false && result.reason === 'no-controller',
    'no controller -> reason="no-controller" (not command-blocked)');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
