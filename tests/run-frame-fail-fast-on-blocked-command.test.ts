/**
 * T1-103: runFrame must fail with reason='command-blocked' if any
 * ctrl.sendCommand() call throws during corner streaming.
 *
 * Run: npx tsx tests/run-frame-fail-fast-on-blocked-command.test.ts
 */
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import type { LaserController } from '../src/controllers/ControllerInterface';

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
  };
  return ctrl;
}

function makeCoordinator(ctrl: MockController | null): ExecutionCoordinator {
  return new ExecutionCoordinator({
    controllerRef: { current: ctrl as unknown as LaserController | null },
    // runFrame only needs the coordinator deps below for construction and
    // simulator notification; MachineService methods are not called.
    machineService: {} as never,
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
