import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import type { LaserMotionOperationId } from '../state/laser-motion-operation';
import { HOLD_DEADMAN_MS, HoldDeadman, releaseHeldMotion } from './machine-hold';
import type { OwnedMachineOperation } from './machine-operation-state';
import { cancelMachineOperation } from './machine-owned-operation';

const MOTION = 'motion-1' as unknown as LaserMotionOperationId;
type Overrides = Omit<Partial<OwnedMachineOperation>, 'motionId'> & {
  motionId?: LaserMotionOperationId | null;
};

function holdOperation(overrides: Overrides = {}): OwnedMachineOperation {
  const { motionId = MOTION, ...rest } = overrides;
  return {
    kind: 'hold',
    state: 'running',
    committed: true,
    controller: new AbortController(),
    controllerEpoch: useLaserStore.getState().controllerSessionEpoch,
    cleanup: () => undefined,
    ...(motionId === null ? {} : { motionId }),
    ...rest,
  } as OwnedMachineOperation;
}

let cancelJog: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  cancelJog = vi.fn(async () => undefined);
  useLaserStore.setState({
    cancelJog,
    motionOperation: { operationId: MOTION, kind: 'jog' },
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ADR-585 PC-side hold-to-jog dead-man', () => {
  it('stops the owned jog when heartbeats stop', () => {
    const deadman = new HoldDeadman();
    const operation = holdOperation();
    deadman.arm('hold-1', 'client-a', operation);
    vi.advanceTimersByTime(HOLD_DEADMAN_MS - 50);
    expect(cancelJog).not.toHaveBeenCalled();
    expect(deadman.beat('client-a', 'hold-1')).toBe(true);
    vi.advanceTimersByTime(HOLD_DEADMAN_MS - 50);
    expect(cancelJog).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(cancelJog).toHaveBeenCalledTimes(1);
    expect(operation.holdReleased).toBe(true);
    expect(deadman.active()).toBe(false);
  });

  it('ignores heartbeats from another client and releases only that client’s holds', () => {
    const deadman = new HoldDeadman();
    deadman.arm('hold-1', 'client-a', holdOperation());
    expect(deadman.beat('client-b', 'hold-1')).toBe(false);
    deadman.releaseClient('client-b');
    expect(cancelJog).not.toHaveBeenCalled();
    deadman.releaseClient('client-a');
    expect(cancelJog).toHaveBeenCalledTimes(1);
  });

  it('never cancels motion owned by someone else or by a replaced controller session', () => {
    releaseHeldMotion(
      holdOperation({ motionId: 'other-motion' as unknown as LaserMotionOperationId }),
    );
    releaseHeldMotion(holdOperation({ controllerEpoch: -1 }));
    expect(cancelJog).not.toHaveBeenCalled();
  });

  it('aborts a hold that has not dispatched yet instead of cancelling motion', () => {
    const operation = holdOperation({ motionId: null, committed: false });
    releaseHeldMotion(operation);
    expect(operation.controller.signal.aborted).toBe(true);
    expect(cancelJog).not.toHaveBeenCalled();
  });

  it('does nothing for a hold that already finished', () => {
    releaseHeldMotion(holdOperation({ state: 'completed' }));
    expect(cancelJog).not.toHaveBeenCalled();
  });

  // ADR-585 Amendment 1 (rolling audit v2 01-P2-6): one release, one Cancel.
  it('sends one Cancel however many stop paths release the same hold', () => {
    const deadman = new HoldDeadman();
    const operation = holdOperation();
    deadman.arm('hold-1', 'client-a', operation);
    deadman.releaseClient('client-a');
    deadman.release('hold-1');
    releaseHeldMotion(operation);
    cancelMachineOperation(operation);
    expect(cancelJog).toHaveBeenCalledTimes(1);
  });

  it('keeps the receipt running when another Cancel replaced this one', async () => {
    cancelJog.mockImplementation(async () => {
      useLaserStore.setState({
        motionOperation: {
          operationId: MOTION,
          kind: 'jog',
          cancelRequested: true,
          cancelAttemptId: Symbol('desktop-cancel'),
        },
      } as never);
      throw new Error('Motion cancellation was replaced before its confirmation completed.');
    });
    const operation = holdOperation();
    releaseHeldMotion(operation);
    await vi.waitFor(() => expect(cancelJog).toHaveBeenCalled());
    await Promise.resolve();
    expect(operation.state).toBe('running');
    expect(operation.message).toBeUndefined();
  });

  it('still reports an unconfirmed stop when the one Cancel fails', async () => {
    cancelJog.mockRejectedValue(new Error('write failed'));
    const operation = holdOperation();
    releaseHeldMotion(operation);
    await vi.waitFor(() => expect(operation.state).toBe('unknown'));
    expect(operation.message).toBe(
      'The held jog stop could not be confirmed. Check the machine on the PC.',
    );
  });
});
