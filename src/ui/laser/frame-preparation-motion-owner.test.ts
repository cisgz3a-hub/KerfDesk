import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentOutputScope, useStore } from '../state';
import {
  createFrameTrace,
  framedRunControllerSnapshot,
  type FrameTraceCandidate,
} from '../state/framed-run';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { ownFramePreparationMotion } from './frame-preparation-motion-owner';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { ownCurrentStartPreparation } from './start-preparation-owner';
import {
  completeTraceForTest,
  dispatchedFrameOperation,
  resetSplitFrameStores,
  restoreSplitFrameStores,
} from './split-frame.test-support';

const originalFrame = useLaserStore.getState().frame;
const originalTrace = useLaserStore.getState().traceFrame;
const disposals: Array<() => void> = [];

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  resetSplitFrameStores();
});
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  restoreSplitFrameStores(originalFrame, originalTrace);
});

function preparation() {
  const app = useStore.getState();
  const before = useLaserStore.getState();
  const candidate: FrameTraceCandidate = {
    exactProgram: 'deferred',
    project: app.project,
    outputScope: currentOutputScope(app),
    executionSignature: currentReplayExecutionSignature(app),
    controllerBeforeFrame: framedRunControllerSnapshot(before),
    frameVerification: { boundsSignature: 'owned-outline', wco: null, workOriginActive: false },
    returnToWorkPosition: { x: 0, y: 0 },
  };
  const motion = ownFramePreparationMotion(before);
  const owner = ownCurrentStartPreparation(app, before, undefined, {}, motion);
  disposals.push(owner.dispose);
  motion.claim(candidate);
  dispatchedFrameOperation(candidate);
  return { owner, candidate, before };
}

describe('exact Frame preparation motion ownership', () => {
  it('survives every owned motion leg and retains the clean trace while the program finishes', () => {
    const { owner, candidate, before } = preparation();
    for (const state of ['Jog', 'Run', 'Idle'] as const) {
      useLaserStore.setState({
        statusReport: { ...before.statusReport!, state, mPos: { x: 24, y: 16, z: 0 } },
      });
      expect(owner.signal.aborted).toBe(false);
    }
    useLaserStore.setState({ statusReport: before.statusReport });
    completeTraceForTest(candidate);
    useLaserStore.setState((laser) => ({ statusSequence: laser.statusSequence + 1 }));
    expect(owner.signal.aborted).toBe(false);
  });

  it('keeps Current Position placement anchored to the pre-Frame position during owned motion', () => {
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    const { owner, candidate, before } = preparation();
    useLaserStore.setState({
      statusReport: { ...before.statusReport!, state: 'Jog', mPos: { x: 24, y: 16, z: 0 } },
    });
    expect(owner.signal.aborted).toBe(false);
    useLaserStore.setState({ statusReport: before.statusReport });
    completeTraceForTest(candidate);
    expect(owner.signal.aborted).toBe(false);
  });

  it('still allows advisory settings refreshes during an owned Frame', () => {
    const { owner } = preparation();
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: false, maxPowerS: 250 } });
    expect(owner.signal.aborted).toBe(false);
  });

  const changes: Array<[string, (before: LaserState) => Partial<LaserState>]> = [
    ['session', (before) => ({ controllerSessionEpoch: before.controllerSessionEpoch + 1 })],
    ['WCO', () => ({ wcoCache: { x: 2, y: 0, z: 0 } })],
    ['work origin', () => ({ workOriginActive: true })],
    [
      'trusted position',
      (before) => ({ trustedPositionEpoch: (before.trustedPositionEpoch ?? 0) + 1 }),
    ],
    ['CNC Z reference', (before) => ({ workZReferenceEpoch: before.workZReferenceEpoch + 1 })],
    ['WCS', () => ({ activeWcs: 'G55' })],
    ['report units', () => ({ controllerSettings: { reportInches: true } })],
    ['unconfirmed report units', () => ({ reportUnitsUnconfirmed: true })],
    ['suppressed position evidence', () => ({ positionEvidenceSuppressed: true })],
    ['alarm', () => ({ alarmCode: 1 })],
    ['MPG takeover', () => ({ mpgActive: true })],
    ['autofocus', () => ({ autofocusBusy: true })],
    ...(['Alarm', 'Hold', 'Door', 'Sleep'] as const).map(
      (state): [string, (before: LaserState) => Partial<LaserState>] => [
        state,
        (before) => ({ statusReport: { ...before.statusReport!, state } }),
      ],
    ),
  ];
  it.each(changes)('still aborts on %s during its owned Frame', (_label, change) => {
    const { owner, before } = preparation();
    useLaserStore.setState(change(before));
    expect(owner.signal.aborted).toBe(true);
    expect(owner.inputsChanged()).toBe(true);
  });

  it.each(['jog', 'other-candidate', 'other-operation', 'cancel', 'mpg'] as const)(
    'rejects %s replacing or retiring the owned operation',
    (replacement) => {
      const { owner, candidate } = preparation();
      const operation = useLaserStore.getState().motionOperation!;
      useLaserStore.setState({
        motionOperation:
          replacement === 'jog'
            ? { ...operation, kind: 'jog' }
            : {
                ...operation,
                kind: 'frame',
                candidate: replacement === 'other-candidate' ? { ...candidate } : candidate,
                ...(replacement === 'other-operation' ? { operationId: 2 } : {}),
                ...(replacement === 'cancel' ? { cancelRequested: true } : {}),
                ...(replacement === 'mpg' ? { mpgInterruptionId: Symbol('mpg') } : {}),
              },
      });
      expect(owner.signal.aborted).toBe(true);
    },
  );

  it('retires an operation that disappears without a clean trace', () => {
    const { owner } = preparation();
    useLaserStore.setState({ motionOperation: null });
    expect(owner.signal.aborted).toBe(true);
  });

  it('cannot regain ownership when unrelated motion returns to the original position', () => {
    const { owner, candidate, before } = preparation();
    completeTraceForTest(candidate);
    const trace = useLaserStore.getState().frameTrace ?? null;
    useLaserStore.setState({
      statusReport: { ...before.statusReport!, state: 'Jog', mPos: { x: 3, y: 7, z: 0 } },
    });
    useLaserStore.setState({ statusReport: before.statusReport, frameTrace: trace });
    expect(owner.signal.aborted).toBe(true);
  });

  it('cannot borrow a different trace after completion', () => {
    const { owner, candidate } = preparation();
    completeTraceForTest(candidate);
    useLaserStore.setState((laser) => ({ frameTrace: createFrameTrace({ ...candidate }, laser) }));
    expect(owner.signal.aborted).toBe(true);
  });

  it('cannot restart the same candidate after completion', () => {
    const { owner, candidate } = preparation();
    completeTraceForTest(candidate);
    dispatchedFrameOperation(candidate);
    expect(owner.signal.aborted).toBe(true);
  });

  it('invalidates a changed Idle position after the clean return', () => {
    const { owner, candidate, before } = preparation();
    completeTraceForTest(candidate);
    useLaserStore.setState({
      statusReport: { ...before.statusReport!, mPos: { x: 1, y: 0, z: 0 } },
    });
    expect(owner.signal.aborted).toBe(true);
  });

  it('still retires on artwork changes during owned motion', () => {
    const { owner } = preparation();
    useStore.getState().newProject();
    expect(owner.signal.aborted).toBe(true);
  });

  it('leaves an ordinary preparation strict about unowned position changes', () => {
    const before = useLaserStore.getState();
    const owner = ownCurrentStartPreparation(useStore.getState(), before);
    disposals.push(owner.dispose);
    useLaserStore.setState({
      statusReport: { ...before.statusReport!, mPos: { x: 5, y: 0, z: 0 } },
    });
    expect(owner.signal.aborted).toBe(true);
  });
});
