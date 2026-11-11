// ADR-565 Amendment 1: a Frame held through a jog comes back only from a clean
// end. These pin every way a jog can end badly; the kept case, and the drift
// cases, run against the simulator in ui/laser/jog-keeps-frame.simulator.test.ts.
import { describe, expect, it } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { jogMpgInterruptionPatch } from './frame-status-failure';
import type { FramedRunPermit } from './framed-run';
import { heldFrameThroughCancel, heldJogFrameCompletionPatch } from './jog-held-frame';
import { handleErrorLine, handleResendLine } from './laser-error-line';
import type { HandlerRefs, SetFn } from './laser-line-shared';
import { publishCancelFailure, type CancelContext } from './laser-motion-cancel-context';
import {
  startMotionOperation,
  takeNextMotionLine,
  withoutHeldJogFrame,
  type LaserMotionOperation,
} from './laser-motion-operation';
import { quickStopPatch } from './laser-quick-stop';
import type { LaserState } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

const frame = { kind: 'ready' } as FramedRunPermit;
const SETTLE = 'G4 P0.01\n';

function heldJog(patch: Partial<LaserMotionOperation> = {}): LaserMotionOperation {
  return {
    ...startMotionOperation('jog', [SETTLE], undefined, 0, 0, 7, SETTLE),
    heldFrame: { frame, armed: true },
    ...patch,
  } as LaserMotionOperation;
}

function stateWith(operation: LaserMotionOperation | null): LaserState {
  return {
    ...initialLaserState(),
    connection: { kind: 'connected' },
    activeControllerKind: grblDriver.kind,
    motionOperation: operation,
  } as unknown as LaserState;
}

function harness(operation: LaserMotionOperation) {
  let state = stateWith(operation);
  const set: SetFn = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch } as LaserState;
  };
  return { set, get: () => state, refs: { driver: grblDriver } as unknown as HandlerRefs };
}

const settled = (operation: LaserMotionOperation) =>
  heldJogFrameCompletionPatch({
    operation,
    observedOperation: null,
    queuedFrameDispatch: null,
    state: stateWith(operation),
    positionPatch: {},
  });

describe('withoutHeldJogFrame', () => {
  it('drops only the held Frame and keeps an operation without one as it is', () => {
    const operation = heldJog();
    const dropped = withoutHeldJogFrame(operation);
    expect(dropped.heldFrame).toBeUndefined();
    expect(dropped.operationId).toBe(7);
    expect(withoutHeldJogFrame(dropped)).toBe(dropped);
    expect(withoutHeldJogFrame(null)).toBeNull();
  });

  it('carries the held Frame to the next line of the same healthy jog', () => {
    const next = takeNextMotionLine(heldJog());
    expect(next?.line).toBe(SETTLE);
    expect(next?.operation.heldFrame?.frame).toBe(frame);
  });
});

describe('a Cancel and the Frame held through the jog', () => {
  const attempt = Symbol('cancel');

  it('an operator Cancel of a healthy jog binds the Frame to its own attempt', () => {
    expect(heldFrameThroughCancel(heldJog(), attempt, false)).toEqual({
      frame,
      armed: true,
      releaseAttemptId: attempt,
    });
  });

  it('a second operator Cancel of the same release keeps it under the new attempt', () => {
    const first = Symbol('first');
    const cancelling = heldJog({
      cancelRequested: true,
      cancelAttemptId: first,
      heldFrame: { frame, armed: true, releaseAttemptId: first },
    });
    expect(heldFrameThroughCancel(cancelling, attempt, false)?.releaseAttemptId).toBe(attempt);
  });

  it.each([
    ['a jog a failure already cancelled', heldJog({ cancelRequested: true }), false],
    ['an automatic release', heldJog(), true],
    [
      'a release whose own attempt ended',
      heldJog({
        cancelRequested: true,
        heldFrame: { frame, armed: true, releaseAttemptId: attempt },
      }),
      false,
    ],
    [
      'a release that needed an automatic settlement',
      heldJog({
        cancelRequested: true,
        cancelAttemptId: attempt,
        automaticReleaseAttempts: 1,
        heldFrame: { frame, armed: true, releaseAttemptId: attempt },
      }),
      false,
    ],
  ])('%s loses the Frame', (_name, operation, automatic) => {
    expect(heldFrameThroughCancel(operation, Symbol('next'), automatic)).toBeUndefined();
  });

  it('a Cancel that fails drops the Frame with its attempt', () => {
    const operation = heldJog({
      cancelRequested: true,
      cancelAttemptId: attempt,
      heldFrame: { frame, armed: true, releaseAttemptId: attempt },
    });
    const { set, get, refs } = harness(operation);
    const context = {
      set,
      get,
      refs,
      safeWrite: async () => undefined,
      operationId: operation.operationId,
      attemptId: attempt,
      sessionEpoch: get().controllerSessionEpoch,
      positionEpoch: get().trustedPositionEpoch ?? 0,
      writeEpoch: 0,
      failureHeading: 'Motion cancellation needs attention',
    } as unknown as CancelContext;
    publishCancelFailure(context, new Error('Timed out waiting for motion to stop after Cancel.'));
    expect(get().motionOperation).toMatchObject({ operationId: 7, cancelRequested: true });
    expect(get().motionOperation?.heldFrame).toBeUndefined();
    expect(get().motionOperation?.cancelAttemptId).toBeUndefined();
  });
});

describe('a jog that does not end cleanly never returns its Frame', () => {
  it.each([
    ['cancelled by a failure', heldJog({ cancelRequested: true })],
    [
      'cancelled, then released by an attempt that is not its operator release',
      heldJog({
        cancelRequested: true,
        cancelAttemptId: Symbol('other'),
        heldFrame: { frame, armed: true, releaseAttemptId: Symbol('release') },
      }),
    ],
    ['interrupted by the pendant', heldJog({ interruptedByMpg: true })],
    ['taken over by the pendant', heldJog({ mpgInterruptionId: Symbol('mpg') })],
  ])('%s', (_name, operation) => {
    expect(settled(operation)).toEqual({});
  });

  it('still running, or with a line still to send', () => {
    const operation = heldJog();
    const args = { operation, state: stateWith(operation), positionPatch: {} };
    expect(
      heldJogFrameCompletionPatch({
        ...args,
        observedOperation: operation,
        queuedFrameDispatch: null,
      }),
    ).toEqual({});
    expect(
      heldJogFrameCompletionPatch({
        ...args,
        observedOperation: null,
        queuedFrameDispatch: takeNextMotionLine(operation),
      }),
    ).toEqual({});
  });

  it('a pendant takeover drops the Frame from the interrupted jog', () => {
    const patch = jogMpgInterruptionPatch(stateWith(heldJog()), true);
    expect(patch.motionOperation).toMatchObject({ interruptedByMpg: true, cancelRequested: true });
    expect(patch.motionOperation?.heldFrame).toBeUndefined();
  });

  it('a quickstop drops the Frame from the cancelled jog', () => {
    const patch = quickStopPatch(stateWith(heldJog()));
    expect(patch.motionOperation).toMatchObject({ cancelRequested: true });
    expect(patch.motionOperation?.heldFrame).toBeUndefined();
  });

  it('a rejected line of the jog itself cancels it and drops the Frame', () => {
    const { set, get, refs } = harness(heldJog());
    handleErrorLine(
      set,
      get,
      refs,
      async () => undefined,
      { code: 15, raw: 'error:15' },
      { owner: 'untracked', motionOperationId: 7 },
    );
    expect(get().motionOperation).toMatchObject({ cancelRequested: true });
    expect(get().motionOperation?.heldFrame).toBeUndefined();
  });

  it('a rejected line that is not the jog still drops the Frame, as it voids live proof', () => {
    const { set, get, refs } = harness(heldJog());
    handleErrorLine(
      set,
      get,
      refs,
      async () => undefined,
      { code: 20, raw: 'error:20' },
      { owner: 'untracked', motionOperationId: null },
    );
    expect(get().motionOperation?.operationId).toBe(7);
    expect(get().motionOperation?.cancelRequested).toBeUndefined();
    expect(get().motionOperation?.heldFrame).toBeUndefined();
  });

  it('a Resend drops the Frame', () => {
    const { set, get, refs } = harness(heldJog());
    handleResendLine(set, get, refs, async () => undefined, 12);
    expect(get().motionOperation).toMatchObject({ cancelRequested: true });
    expect(get().motionOperation?.heldFrame).toBeUndefined();
  });
});
