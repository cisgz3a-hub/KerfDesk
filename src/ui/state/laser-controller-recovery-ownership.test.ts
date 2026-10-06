import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { makeConnection, connectWith } from './laser-store-motion-operation.test-support';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { useLaserStore, type LaserState } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { resetStore } from './test-helpers';
import { controllerOperationOwner } from './laser-controller-operation';
import { controllerRecoveryActions } from './laser-controller-recovery-actions';

const IDLE = '<Idle|MPos:50.000,60.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>';
const SLEEP = '<Sleep|MPos:50.000,60.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
});
afterEach(async () => {
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
  let reject!: (error: Error) => void;
  return {
    pending: new Promise<void>((resolve, refuse) => {
      release = resolve;
      reject = refuse;
    }),
    release: (failure = false) =>
      failure ? reject(new Error('Old reset write rejected.')) : release(),
  };
}

describe('Wake continuation belongs to its exact recovery owner', () => {
  it('checks ownership again between reset completion and its outer continuation', async () => {
    let state: LaserState = { ...useLaserStore.getState(), connection: { kind: 'connected' } };
    const set: Parameters<typeof controllerRecoveryActions>[0] = (patch) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    };
    const refs = {
      connection: {},
      controllerCommand: null,
      controllerIdleWait: null,
    } as Parameters<typeof controllerRecoveryActions>[2];
    const replacement = { kind: 'recovery', phase: 'awaiting-idle', idleReports: 0 } as const;
    let replacementState!: LaserState;
    const actions = controllerRecoveryActions(
      set,
      () => state,
      refs,
      () => {
        // The first microtask lets the reset helper resume. The second claims a
        // newer recovery before the awaiting outer action can mutate the store.
        queueMicrotask(() =>
          queueMicrotask(() => {
            state = {
              ...state,
              controllerOperation: replacement,
              controllerSessionEpoch: state.controllerSessionEpoch + 1,
            };
            replacementState = state;
          }),
        );
        return Promise.resolve();
      },
      () => grblDriver,
    );
    const late = outcome(actions.wakeController());
    await microtasks();
    expect(late.value).toContain('superseded');
    expect(state.controllerOperation).toBe(replacement);
    expect(state.trustedPositionEpoch).toBe(replacementState.trustedPositionEpoch);
    expect(state.log).toEqual(replacementState.log);
    expect(refs.controllerIdleWait).toBeNull();
  });

  it.each(['success', 'failure'])(
    'leaves a replacement Wake intact after an old transport %s',
    async (settlement) => {
      const held = deferredWrite();
      const oldWrites: string[] = [];
      const old = makeConnection(async (data) => {
        oldWrites.push(data);
        if (data === '\x18') await held.pending;
        if (data === '?') old.emitLine(IDLE);
      });
      await connectWith(old);
      await settleTestGrblHandshake();
      old.emitLine(SLEEP);
      const late = outcome(useLaserStore.getState().wakeController());
      await microtasks();
      expect(oldWrites).toContain('\x18');
      const disconnect = useLaserStore.getState().disconnect();
      await vi.advanceTimersByTimeAsync(2500);
      await disconnect;

      const replacementWrites: string[] = [];
      const replacement = makeConnection(async (data) => {
        replacementWrites.push(data);
        if (data === '?') replacement.emitLine(IDLE);
      });
      await connectWith(replacement);
      await settleTestGrblHandshake();
      replacement.emitLine(SLEEP);
      const current = outcome(useLaserStore.getState().wakeController());
      await microtasks();
      const before = useLaserStore.getState();
      const operation = before.controllerOperation;
      expect(operation?.kind).toBe('recovery');
      if (operation === null) throw new Error('Replacement Wake owner missing');
      held.release(settlement === 'failure');
      await microtasks();
      const after = useLaserStore.getState();
      expect(late.value).not.toBe('pending');
      expect(controllerOperationOwner(after.controllerOperation!)).toBe(
        controllerOperationOwner(operation),
      );
      expect(after.trustedPositionEpoch).toBe(before.trustedPositionEpoch);
      expect(after.lastWriteError).toBe(before.lastWriteError);
      expect(after.log).toEqual(before.log);
      expect(current.value).toBe('pending');
      expect(replacementWrites.filter((data) => data === '\x18')).toHaveLength(1);
      replacement.emitLine(IDLE);
      await microtasks();
      expect(current.value).toBe('idle');
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
  );

  it.each([
    ['success', false],
    ['failure', false],
    ['success', true],
    ['failure', true],
  ] as const)(
    'fences an older same-connection %s with replacement completed %s',
    async (settlement, completed) => {
      const held = deferredWrite();
      let resetCount = 0;
      const port = makeConnection(async (data) => {
        if (data === '?') port.emitLine(IDLE);
        if (data === '\x18' && ++resetCount === 1) await held.pending;
      });
      await connectWith(port);
      await settleTestGrblHandshake();
      port.emitLine(SLEEP);
      const late = outcome(useLaserStore.getState().wakeController());
      await microtasks();
      const current = outcome(useLaserStore.getState().wakeController());
      await microtasks();
      if (completed) {
        port.emitLine(IDLE);
        await microtasks();
        expect(current.value).toBe('idle');
      }
      const before = useLaserStore.getState();
      const pendingWrites = before.pendingTransportWrites ?? 0;
      expect(pendingWrites).toBe(1);
      held.release(settlement === 'failure');
      await microtasks();
      expect(late.value).toContain(
        settlement === 'failure' ? 'Old reset write rejected' : 'superseded',
      );
      expect(useLaserStore.getState().controllerOperation).toBe(before.controllerOperation);
      expect(useLaserStore.getState().lastWriteError).toBe(before.lastWriteError);
      expect(useLaserStore.getState().log).toEqual(before.log);
      expect(useLaserStore.getState().transcript).toEqual(before.transcript);
      expect(useLaserStore.getState().safetyNotice).toBe(before.safetyNotice);
      expect(useLaserStore.getState().trustedPositionEpoch).toBe(before.trustedPositionEpoch);
      expect(useLaserStore.getState().pendingTransportWrites).toBe(pendingWrites - 1);
      port.emitLine(IDLE);
      await microtasks();
      expect(current.value).toBe('idle');
    },
  );

  it('accepts its own reboot banner arriving before the soft-reset write resolves', async () => {
    const port = makeConnection(async (data) => {
      if (data === '?') port.emitLine(IDLE);
      if (data === '\x18') {
        port.emitLine("Grbl 1.1f ['$' for help]");
        setTimeout(() => port.emitLine(IDLE), 1);
      }
    });
    await connectWith(port);
    await settleTestGrblHandshake();
    port.emitLine(SLEEP);
    const wake = outcome(useLaserStore.getState().wakeController());
    await vi.advanceTimersByTimeAsync(5);
    expect(wake.value).toBe('idle');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(useLaserStore.getState().log).toContain(
      '[lf2] Controller recovery confirmed after fresh Idle.',
    );
  });

  it.each([true, false])(
    'accepts its own immediate numbered Alarm, before banner %s',
    async (beforeBanner) => {
      const port = makeConnection(async (data) => {
        if (data === '?') port.emitLine(IDLE);
        if (data === '\x18') {
          if (beforeBanner) port.emitLine('ALARM:3');
          port.emitLine("Grbl 1.1f ['$' for help]");
          if (!beforeBanner) port.emitLine('ALARM:3');
        }
      });
      await connectWith(port);
      await settleTestGrblHandshake();
      port.emitLine(SLEEP);
      const wake = outcome(useLaserStore.getState().wakeController());
      await microtasks();
      expect(wake.value).toBe('alarm');
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(useLaserStore.getState().lastWriteError).toBeNull();
      expect(useLaserStore.getState().alarmCode).toBe(3);
    },
  );

  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, true],
    [false, true, false],
  ])(
    'accepts pure Alarm status: before write %s, prior Alarm %s, banner %s',
    async (beforeWrite, priorAlarm, banner) => {
      const alarm = '<Alarm|MPos:50.000,60.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>';
      const port = makeConnection(async (data) => {
        if (data === '?') port.emitLine(IDLE);
        if (data === '\x18') {
          if (banner) port.emitLine("Grbl 1.1f ['$' for help]");
          if (beforeWrite) port.emitLine(alarm);
        }
      });
      await connectWith(port);
      await settleTestGrblHandshake();
      port.emitLine(priorAlarm ? 'ALARM:3' : SLEEP);
      const wake = outcome(useLaserStore.getState().wakeController());
      await microtasks();
      if (!beforeWrite) {
        expect(wake.value).toBe('pending');
        expect(useLaserStore.getState().controllerOperation).toMatchObject({
          kind: 'recovery',
          phase: 'awaiting-idle',
        });
        port.emitLine(alarm);
        await microtasks();
      }
      expect(wake.value).toBe('alarm');
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(useLaserStore.getState().lastWriteError).toBeNull();
      expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    },
  );
});
