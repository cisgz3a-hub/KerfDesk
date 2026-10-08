import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeConnection,
  connectWith,
  framedRunCandidate,
} from './laser-store-motion-operation.test-support';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { resetStore } from './test-helpers';
import { controllerOperationOwner } from './laser-controller-operation';

const IDLE = '<Idle|MPos:50.000,60.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>';
const SLEEP = '<Sleep|MPos:50.000,60.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
});
afterEach(async () => {
  await vi.advanceTimersByTimeAsync(1_000);
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
});
async function microtasks(): Promise<void> {
  for (let index = 0; index < 50; index++) await Promise.resolve();
}
function outcome(promise: Promise<unknown>): { value: string } {
  const status = { value: 'pending' };
  void promise.then(
    (value) => {
      status.value = String(value);
    },
    (error: unknown) => {
      status.value = String(error);
    },
  );
  return status;
}
function deferredWrite() {
  let release!: () => void;
  return {
    pending: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}

function replyToRuntimeQuery(data: string, emit: (line: string) => void): void {
  const handshake = useLaserStore.getState().controllerOperation?.kind === 'connection-handshake';
  if (data === '$I\n' && !handshake) {
    emit('[VER:1.1h.20190830:test]');
    emit('[OPT:VM,15,128]');
    emit('ok');
  }
  if (data === '$G\n' && !handshake) {
    emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    emit('ok');
  }
  if (data === '$$\n') {
    emit('$30=1000');
    emit('$31=0');
    emit('$32=1');
    emit('ok');
  }
}

describe('canonical Wake relinquishes only its failed completion lease', () => {
  it('relinquishes failed canonical Wake completion while retaining cleanup through Sleep', async () => {
    const cleanup = deferredWrite();
    let resetCount = 0;
    const port = makeConnection(async (data) => {
      if (data === '?') port.emitLine(IDLE);
      replyToRuntimeQuery(data, port.emitLine);
      if (data === '\x18') resetCount++;
      if (data === 'M5\n' && resetCount === 2) await cleanup.pending;
      if (data === 'M5\n' || data === 'M9\n') port.emitLine('ok');
    });
    await connectWith(port);
    await settleTestGrblHandshake();
    port.emitLine(SLEEP);
    const wake = outcome(useLaserStore.getState().wakeController());
    await microtasks();
    await useLaserStore.getState().stopJob('app-closing');
    const owner = useLaserStore.getState().controllerOperation;
    port.emitLine(SLEEP);
    await microtasks();
    expect(wake.value).toContain('Controller entered Sleep');
    port.emitLine("Grbl 1.1f ['$' for help]");
    port.emitLine(IDLE);
    await microtasks();
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    await expect(
      useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate()),
    ).rejects.toThrow('controller operation is active');
    cleanup.release();
    await microtasks();
    port.emitLine(IDLE);
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(resetCount).toBe(2);
  });
  it('publishes the failed old Wake atomically before a subscriber starts a fresh Wake', async () => {
    let resetCount = 0;
    let report = IDLE;
    const port = makeConnection(async (data) => {
      if (data === '?') port.emitLine(report);
      replyToRuntimeQuery(data, port.emitLine);
      if (data === '\x18') resetCount++;
      if (data === 'M5\n' || data === 'M9\n') port.emitLine('ok');
    });
    await connectWith(port);
    await settleTestGrblHandshake();
    port.emitLine(SLEEP);
    report = '<Run|MPos:50.000,60.000,0.000|FS:0,0>';
    const oldWake = outcome(useLaserStore.getState().wakeController());
    await microtasks();
    await useLaserStore.getState().stopJob('app-closing');
    const oldOwner = useLaserStore.getState().controllerOperation;
    port.emitLine("Grbl 1.1f ['$' for help]");
    await microtasks();
    expect(useLaserStore.getState().controllerOperation).toBe(oldOwner);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    let freshWake: ReturnType<typeof outcome> | null = null;
    let freshOwner: ReturnType<typeof useLaserStore.getState>['controllerOperation'] = null;
    const unsubscribe = useLaserStore.subscribe((state, previous) => {
      if (
        freshWake !== null ||
        previous.controllerOperation !== oldOwner ||
        state.controllerOperation !== null
      )
        return;
      freshWake = outcome(state.wakeController());
      freshOwner = useLaserStore.getState().controllerOperation;
    });
    port.emitLine(SLEEP);
    await microtasks();
    unsubscribe();
    expect(oldWake.value).toContain('Controller entered Sleep');
    expect(resetCount).toBe(3);
    expect(freshOwner).not.toBeNull();
    const currentOwner = useLaserStore.getState().controllerOperation;
    expect(currentOwner).not.toBeNull();
    expect(controllerOperationOwner(currentOwner!)).toBe(controllerOperationOwner(freshOwner!));
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(freshWake).toEqual({ value: 'pending' });
    port.emitLine(IDLE);
    await microtasks();
    expect(freshWake).toEqual({ value: 'idle' });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});
