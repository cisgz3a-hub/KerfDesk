/**
 * T3-73: FrameResult reason taxonomy.
 *
 * Run: npx tsx tests/frame-result-reasons.test.ts
 */
import { ExecutionCoordinator, type FrameResult } from '../src/app/ExecutionCoordinator';
import { describeFrameFailure } from '../src/app/FrameResultMessages';
import type { LaserController, MachineStatus } from '../src/controllers/ControllerInterface';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

const sceneBounds = { minX: 0, minY: 0, maxX: 40, maxY: 20 };
const transformOpts = {
  startMode: 'current' as const,
  savedOrigin: null,
  originCorner: 'front-left' as const,
  bedHeightMm: 300,
};

interface MockController {
  status: MachineStatus;
  frameCalls: number;
  requestCount: number;
  frameThrows?: boolean;
  afterFrameStatus?: MachineStatus;
  onRequestStatus?: () => void;
}

function makeController(config: Partial<MockController> = {}): MockController & LaserController {
  const mock: MockController = {
    status: config.status ?? 'idle',
    frameCalls: 0,
    requestCount: 0,
    frameThrows: config.frameThrows,
    afterFrameStatus: config.afterFrameStatus,
    onRequestStatus: config.onRequestStatus,
  };
  const ctrl = {
    protocolName: 'mock',
    get state() {
      return {
        status: mock.status,
        position: { x: 0, y: 0, z: 0 },
        feedRate: 0,
        spindleSpeed: 0,
        alarmCode: mock.status === 'alarm' ? 9 : null,
        errorCode: null,
      };
    },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    executeJob: async () => ({ id: 'job', startedAt: 0 }),
    sendJob: async () => {},
    pause: () => ({ ok: true }),
    resume: () => ({ ok: true }),
    stop: () => ({ ok: true }),
    emergencyStop: () => ({ ok: true }),
    safetyOff: async () => ({ stage: 'm5' as const }),
    sendCommand: () => {},
    requestStatusReport: () => {
      mock.requestCount++;
      mock.onRequestStatus?.();
    },
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
      frame: async () => {
        mock.frameCalls++;
        if (mock.frameThrows) throw new Error('frame operation exploded');
        if (mock.afterFrameStatus) mock.status = mock.afterFrameStatus;
        return { ok: true as const };
      },
      laserOff: async () => ({ ok: true as const }),
      pauseJob: async () => ({ ok: true as const }),
      resumeJob: async () => ({ ok: true as const }),
      stopJob: async () => ({ ok: true as const }),
      emergencyStop: async () => ({ ok: true as const }),
    },
  } as unknown as MockController & LaserController;
  Object.assign(ctrl, mock);
  return ctrl;
}

function makeCoordinator(ctrl: LaserController | null): ExecutionCoordinator {
  return new ExecutionCoordinator({
    controllerRef: { current: ctrl },
    // T2-11 / T1-222: runFrame acquires/releases the mutex via lease.
    machineService: {
      tryAcquireOperation: (kind: string) => ({ kind, sessionId: Date.now() }),
      releaseOperation: () => {},
    } as never,
    notifySimulatorRef: { current: () => {} },
  });
}

async function frameSafe(
  ctrl: LaserController | null,
  extra?: { signal?: AbortSignal; idleTimeoutMs?: number },
): Promise<FrameResult> {
  return makeCoordinator(ctrl).frameSafe({
    sceneBounds,
    transformOpts,
    idleTimeoutMs: extra?.idleTimeoutMs ?? 20,
    signal: extra?.signal,
  });
}

async function run(): Promise<void> {
  console.log('\n=== T3-73 frame result reasons ===\n');

  {
    const ctrl = makeController({ status: 'run', afterFrameStatus: 'alarm' });
    const result = await frameSafe(ctrl);
    assert(result.ok === false && result.reason === 'machine-alarm', 'alarm during idle wait returns machine-alarm');
  }

  {
    const ctrl = makeController({ status: 'run', afterFrameStatus: 'disconnected' });
    const result = await frameSafe(ctrl);
    assert(result.ok === false && result.reason === 'disconnected', 'disconnect during idle wait returns disconnected');
  }

  {
    const abort = new AbortController();
    const ctrl = makeController({ status: 'idle' });
    abort.abort();
    const result = await frameSafe(ctrl, { signal: abort.signal });
    assert(result.ok === false && result.reason === 'cancelled' && ctrl.frameCalls === 0, 'cancelled frame returns before command emission');
  }

  {
    const ctrl = makeController({ frameThrows: true });
    const result = await frameSafe(ctrl);
    assert(
      result.ok === false && result.reason === 'unknown' && result.error?.includes('frame operation exploded') === true,
      'unexpected frame operation throw returns unknown with diagnostics',
    );
  }

  {
    const messages = [
      describeFrameFailure({ ok: false, reason: 'machine-alarm' }, 'Frame'),
      describeFrameFailure({ ok: false, reason: 'disconnected' }, 'Frame'),
      describeFrameFailure({ ok: false, reason: 'cancelled' }, 'Frame'),
      describeFrameFailure({ ok: false, reason: 'unknown', error: 'boom' }, 'Frame'),
    ];
    assert(
      messages[0].message.includes('alarm') &&
        messages[1].message.includes('Connection') &&
        messages[2].message.includes('cancelled') &&
        messages[3].details?.includes('boom') === true,
      'frame failure messages are reason-specific and preserve diagnostics',
    );
  }

  {
    const src = await import('node:fs').then(fs => fs.readFileSync('src/app/ExecutionCoordinator.ts', 'utf-8'));
    for (const reason of ['machine-alarm', 'disconnected', 'cancelled', 'unknown']) {
      assert(src.includes(`'${reason}'`), `FrameResult.reason union includes ${reason}`);
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
