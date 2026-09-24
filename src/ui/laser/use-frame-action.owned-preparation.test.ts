import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useStore } from '../state';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import { resetOutputPreparationWorkerForTests } from './output-preparation-worker-client';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import {
  preparedStartOf,
  resetSplitFrameStores,
  restoreSplitFrameStores,
} from './split-frame.test-support';
import { ownCurrentStartPreparation } from './start-preparation-owner';
import {
  HeldFrameWorker,
  reportFrameStatus,
  startHeldFrame,
} from './split-frame-owned-preparation.test-support';

vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: () => true,
}));

const originalFrame = useLaserStore.getState().frame;
const originalTraceFrame = useLaserStore.getState().traceFrame;

beforeEach(() => {
  resetOutputPreparationWorkerForTests();
  HeldFrameWorker.instances = [];
  vi.stubGlobal('Worker', HeldFrameWorker);
  resetSplitFrameStores();
});

afterEach(() => {
  resetOutputPreparationWorkerForTests();
  restoreSplitFrameStores(originalFrame, originalTraceFrame);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('split Frame keeps its own exact preparation through physical motion', () => {
  it.each([
    ['Run', false],
    ['Jog', false],
    ['Run', true],
    ['Jog', true],
    ['Idle', true],
  ] as const)('keeps an owned %s report (position changed: %s)', async (state, moved) => {
    const frame = await startHeldFrame();
    reportFrameStatus({
      ...frame.originalStatus,
      state,
      ...(moved ? { mPos: { x: 45, y: 53, z: 0 } } : {}),
    });
    const preparationSurvivedMotion = !frame.worker.terminated;
    const noPermitDuringMotion = useLaserStore.getState().framedRun === null;
    frame.complete();
    frame.worker.release();

    const accepted = await frame.outcome;
    expect(preparationSurvivedMotion).toBe(true);
    expect(noPermitDuringMotion).toBe(true);
    expect(accepted).toBe(true);
    const permit = useLaserStore.getState().framedRun;
    expect(permit).not.toBeNull();
    expect(permit?.candidate.executionSignature).toBe(frame.candidate.executionSignature);
    expect(permit?.candidate.preparedStart.gcode.length).toBeGreaterThan(0);
    const expected = preparedStartOf(frame.worker.response!);
    if (!expected.ok) throw new Error('The fixture exact program was refused.');
    expect(permit?.candidate.preparedStart.gcode).toBe(expected.gcode);
    expect(framedRunReadinessIssue(permit)).toBeNull();
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(useFramePreparationStore.getState().pending).toBe(false);
  });

  it('retains the captured Current Position origin while its Frame moves', async () => {
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    const frame = await startHeldFrame();
    reportFrameStatus({
      ...frame.originalStatus,
      state: 'Run',
      mPos: { x: 45, y: 53, z: 0 },
    });
    frame.complete();
    frame.worker.release();

    expect(await frame.outcome).toBe(true);
    expect(useLaserStore.getState().framedRun?.candidate.preparedStart.jobOrigin).toEqual({
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 31, y: 42 },
    });
  });

  it.each(['rounded return', 'equivalent WPos report'] as const)(
    'uses an accepted completion as its baseline: %s',
    async (kind) => {
      if (kind === 'rounded return') {
        reportFrameStatus({
          ...idleControllerStatusForFrameTest(),
          mPos: { x: 31.0004, y: 42, z: 0 },
        });
      }
      const frame = await startHeldFrame();
      const completed =
        kind === 'rounded return'
          ? idleControllerStatusForFrameTest()
          : { ...frame.originalStatus, mPos: null, wPos: { x: 31, y: 42, z: 0 } };
      // The helper checks the real Frame completion predicate before recording
      // a trace: this is existing completion semantics, not a new tolerance.
      frame.complete(completed);
      frame.worker.release();

      expect(await frame.outcome).toBe(true);
      expect(useLaserStore.getState().framedRun?.controller.statusReport).toEqual(completed);
    },
  );

  it.each(['different candidate', 'same candidate', 'unrelated jog'] as const)(
    'settles a replacement after dispatch while it remains non-null: %s',
    async (kind) => {
      const frame = await startHeldFrame();
      const original = useLaserStore.getState().motionOperation;
      if (original === null) throw new Error('The fixture has no Frame owner.');
      // startHeldFrame has yielded after the dispatch promise returned. This
      // replacement therefore occurs while waitForFrameOutcome awaits completion.
      const replacement =
        kind === 'unrelated jog'
          ? { ...original, kind: 'jog' as const, operationId: 2 }
          : {
              ...original,
              kind: 'frame' as const,
              operationId: 2,
              candidate: kind === 'same candidate' ? frame.candidate : { ...frame.candidate },
            };
      useLaserStore.setState({ motionOperation: replacement });
      const settledBeforeCleanup = await Promise.race([
        frame.outcome.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      // Before the repair, restore the old owner only to drain the broken waiter
      // so a failing regression does not leave global Frame ownership behind.
      if (!settledBeforeCleanup) {
        useLaserStore.setState({ motionOperation: { ...original, cancelRequested: true } });
      }
      frame.worker.release();
      const accepted = await frame.outcome;

      expect(settledBeforeCleanup).toBe(true);
      expect(accepted).toBe(false);
      expect(frame.worker.terminated).toBe(true);
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().motionOperation).toBe(replacement);
    },
  );

  it('aborts cancellation during owned motion and ignores its late exact result', async () => {
    const frame = await startHeldFrame();
    reportFrameStatus({ ...frame.originalStatus, state: 'Run', mPos: { x: 45, y: 53, z: 0 } });
    useLaserStore.setState((state) => ({
      motionOperation:
        state.motionOperation === null
          ? null
          : {
              ...state.motionOperation,
              cancelRequested: true,
            },
    }));
    frame.worker.release();
    expect(await frame.outcome).toBe(false);
    expect(frame.worker.terminated).toBe(true);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameTrace).toBeNull();
  });

  it('keeps source changes invalidating during owned motion even after an undo', async () => {
    const frame = await startHeldFrame();
    reportFrameStatus({ ...frame.originalStatus, state: 'Run', mPos: { x: 45, y: 53, z: 0 } });
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((layer) => ({ ...layer, power: 25 })),
        },
      },
    });
    const terminated = frame.worker.terminated;
    useStore.setState({ project });
    frame.complete();
    frame.worker.release();
    expect(await frame.outcome).toBe(false);
    expect(terminated).toBe(true);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it.each([
    ['session', (s) => ({ controllerSessionEpoch: s.controllerSessionEpoch + 1 })],
    ['WCO', () => ({ wcoCache: { x: 1, y: 0, z: 0 } })],
    ['origin', () => ({ workOriginActive: true })],
    ['Work Z', (s) => ({ workZReferenceEpoch: s.workZReferenceEpoch + 1 })],
    ['trusted position', (s) => ({ trustedPositionEpoch: (s.trustedPositionEpoch ?? 0) + 1 })],
    [
      'report units',
      (s) => ({ controllerSettings: { ...s.controllerSettings, reportInches: true } }),
    ],
    ['pending report units', () => ({ reportUnitsUnconfirmed: true })],
    ['suppressed position', () => ({ positionEvidenceSuppressed: true })],
    ['active WCS', () => ({ activeWcs: 'G55' })],
  ] satisfies ReadonlyArray<readonly [string, (s: LaserState) => Partial<LaserState>]>)(
    'keeps %s changes invalidating during owned motion',
    async (_name, patch) => {
      const frame = await startHeldFrame();
      const before = useLaserStore.getState();
      reportFrameStatus({ ...frame.originalStatus, state: 'Run', mPos: { x: 45, y: 53, z: 0 } });
      useLaserStore.setState(patch(before));
      const terminated = frame.worker.terminated;
      useLaserStore.setState(before);
      frame.complete();
      frame.worker.release();
      expect(await frame.outcome).toBe(false);
      expect(terminated).toBe(true);
      expect(useLaserStore.getState().framedRun).toBeNull();
    },
  );

  it('does not exempt motion before its operation is assigned', async () => {
    const frame = await startHeldFrame(() => {
      reportFrameStatus({ ...idleControllerStatusForFrameTest(), state: 'Run' });
    });
    frame.complete();
    frame.worker.release();
    expect(await frame.outcome).toBe(false);
    expect(frame.worker.terminated).toBe(true);
  });

  it.each(['Run', 'moved Idle', 'replaced trace'] as const)(
    'expires after clean completion on %s before the exact program arrives',
    async (kind) => {
      const frame = await startHeldFrame();
      frame.complete();
      if (kind === 'replaced trace') {
        const trace = useLaserStore.getState().frameTrace;
        if (trace === null || trace === undefined) throw new Error('No completed trace.');
        useLaserStore.setState({ frameTrace: { ...trace } });
      } else {
        reportFrameStatus({
          ...frame.originalStatus,
          ...(kind === 'Run' ? { state: 'Run' as const } : { mPos: { x: 45, y: 53, z: 0 } }),
        });
      }
      frame.worker.release();
      expect(await frame.outcome).toBe(false);
      expect(frame.worker.terminated).toBe(true);
      expect(useLaserStore.getState().framedRun).toBeNull();
    },
  );

  it('keeps a settled preparation usable while Frame still owns motion', async () => {
    const frame = await startHeldFrame();
    frame.worker.release();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    reportFrameStatus({ ...frame.originalStatus, state: 'Run', mPos: { x: 45, y: 53, z: 0 } });
    expect(useLaserStore.getState().framedRun).toBeNull();
    frame.complete();
    expect(await frame.outcome).toBe(true);
    expect(frame.worker.terminated).toBe(false);
  });

  it.each(['Run', 'Jog', 'moved Idle'] as const)(
    'keeps an ordinary preparation without Frame ownership invalidated by %s',
    (kind) => {
      const owner = ownCurrentStartPreparation(useStore.getState(), useLaserStore.getState());
      try {
        reportFrameStatus({
          ...idleControllerStatusForFrameTest(),
          ...(kind === 'moved Idle' ? { mPos: { x: 45, y: 53, z: 0 } } : { state: kind }),
        });
        expect(owner.signal.aborted).toBe(true);
        expect(owner.inputsChanged()).toBe(true);
      } finally {
        owner.dispose();
      }
    },
  );
});
