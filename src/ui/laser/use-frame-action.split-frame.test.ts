import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeJobMotionBounds, frameBoundsSignature } from '../../core/job';
import { useStore } from '../state';
import {
  useFramePreparationStore,
  type FramePreparationStage,
} from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import type { FrameBoundsPreview } from './frame-bounds-preview';
import { FRAME_COMPLETED_BUT_CHANGED_MESSAGE } from './frame-dispatch-support';
import {
  FRAME_TRACE_PROGRAM_MISMATCH_MESSAGE,
  FRAME_TRACE_PROGRAM_REFUSED_MESSAGE,
} from './frame-trace-flow';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { idleControllerStatusForFrameTest } from './framed-run-testing';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import {
  gateExactProgram,
  installCompletingTraceFrame,
  lastToast,
  preparedStartOf,
  prepareThroughFixture,
  resetSplitFrameStores,
  restoreSplitFrameStores,
} from './split-frame.test-support';
import { runFrameNow } from './use-frame-action';

// The split Frame (ADR-353): an off-thread preparation reports the compiled
// outline before its exact program; the Frame traces it at once and the permit
// is minted only when the program arrives, reproduces the outline, and nothing
// has drifted since the trace's clean completion.

const outputWorkerMocks = vi.hoisted(() => ({
  prepareStart: vi.fn<typeof OutputWorkerModule.prepareStartOutputOffThread>(),
}));

vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: () => true,
  prepareStartOutputOffThread: outputWorkerMocks.prepareStart,
}));

const originalFrame = useLaserStore.getState().frame;
const originalTraceFrame = useLaserStore.getState().traceFrame;
let events: string[];

beforeEach(() => {
  outputWorkerMocks.prepareStart
    .mockReset()
    .mockImplementation((request, _onProgress, _signal, onFrameBounds) =>
      prepareThroughFixture(request, onFrameBounds).then(preparedStartOf),
    );
  resetSplitFrameStores();
  events = [];
});

afterEach(() => {
  restoreSplitFrameStores(originalFrame, originalTraceFrame);
  vi.restoreAllMocks();
});

describe('runFrameNow split Frame (ADR-353)', () => {
  it('traces the compiled outline first and mints the permit only from the exact program', async () => {
    const traceFrame = installCompletingTraceFrame(events);
    const stages: FramePreparationStage[] = [];
    const unsubscribe = useFramePreparationStore.subscribe((state, previous) => {
      if (state.stage !== previous.stage) stages.push(state.stage);
    });

    await expect(runFrameNow()).resolves.toBe(true);
    unsubscribe();

    expect(traceFrame).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState().frame).not.toHaveBeenCalled();
    expect(events).toEqual(['trace']);
    // The outline was traced while the program was still being finished, and
    // the owned Frame's stage told the operator so at each step.
    expect(stages).toEqual(['tracing', 'finishing', 'preparing']);

    const permit = useLaserStore.getState().framedRun;
    if (permit === null) throw new Error('No permit was minted');
    const project = useStore.getState().project;
    const prepared = permit.candidate.preparedStart;
    expect(typeof prepared.gcode).toBe('string');
    expect(prepared.gcode.length).toBeGreaterThan(0);
    // The traced rectangle is the exact program's own motion envelope.
    expect(traceFrame.mock.calls[0]?.[0]).toEqual(
      computeJobMotionBounds(prepared.prepared.job, project.device),
    );
    expect(traceFrame.mock.calls[0]?.[1]).toBe(project.device.framingFeedMmPerMin);
    expect(permit.candidate.executionSignature).toBe(prepared.canvasPlan.retentionKey);
    expect(permit.candidate.frameVerification.boundsSignature).toBe(
      frameBoundsSignature(prepared.metrics.frameMotionBounds ?? prepared.metrics.frameJobBounds!),
    );
    expect(permit.candidate.project).toBe(project);
    expect(permit.candidate.review).toBeUndefined();
    expect('exactProgram' in permit.candidate).toBe(false);
    // The permit reads exactly like one minted at an ordinary Frame's clean Idle.
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBe(permit.candidate.frameVerification);
    expect(
      framedRunReadinessIssue(permit, useStore.getState(), useLaserStore.getState()),
    ).toBeNull();
    expect(lastToast()).toMatchObject({ variant: 'success' });
  });

  it('refuses to mint when the machine moves between the trace and the exact program', async () => {
    installCompletingTraceFrame(events);
    const releaseProgram = gateExactProgram(outputWorkerMocks.prepareStart);

    const outcome = runFrameNow();
    await vi.waitFor(() => expect(useLaserStore.getState().frameTrace).not.toBeNull());
    expect(useFramePreparationStore.getState().stage).toBe('finishing');
    // A fresh Idle report at a different position: the machine moved. The
    // trace expires at once, and the preparation owner cancels the compile it
    // was guarding for the same reason.
    useLaserStore.setState((state) => ({
      statusSequence: state.statusSequence + 1,
      statusReport: { ...idleControllerStatusForFrameTest(), mPos: { x: 99, y: 42, z: 0 } },
    }));
    expect(useLaserStore.getState().frameTrace).toBeNull();
    releaseProgram();

    await expect(outcome).resolves.toBe(false);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(lastToast()).toMatchObject({
      variant: 'error',
      message: FRAME_TRACE_PROGRAM_REFUSED_MESSAGE,
    });
  });

  it('refuses to mint when the trace expired before a sound exact program arrived', async () => {
    installCompletingTraceFrame(events);
    const releaseProgram = gateExactProgram(outputWorkerMocks.prepareStart);

    const outcome = runFrameNow();
    await vi.waitFor(() => expect(useLaserStore.getState().frameTrace).not.toBeNull());
    // Owned motion begins without a new status report yet: the permit rules
    // expire the trace, while the compile itself is still sound.
    useLaserStore.setState({
      motionOperation: {
        operationId: 7,
        kind: 'jog',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });
    expect(useLaserStore.getState().frameTrace).toBeNull();
    useLaserStore.setState({ motionOperation: null });
    releaseProgram();

    await expect(outcome).resolves.toBe(false);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(lastToast()).toMatchObject({
      variant: 'warning',
      message: FRAME_COMPLETED_BUT_CHANGED_MESSAGE,
    });
  });

  it('issues no permit when the exact program is refused after the trace', async () => {
    installCompletingTraceFrame(events);
    outputWorkerMocks.prepareStart.mockImplementation((request, _p, _s, onFrameBounds) =>
      prepareThroughFixture(request, onFrameBounds).then(() => ({
        ok: false as const,
        messages: ['The prepared job failed preflight in this test.'],
      })),
    );

    await expect(runFrameNow()).resolves.toBe(false);

    expect(events).toEqual(['trace']);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(lastToast()).toMatchObject({
      variant: 'error',
      message: FRAME_TRACE_PROGRAM_REFUSED_MESSAGE,
    });
  });

  it("issues no permit when the exact program's envelope differs from the traced outline", async () => {
    installCompletingTraceFrame(events);
    outputWorkerMocks.prepareStart.mockImplementation((request, _p, _s, onFrameBounds) =>
      prepareThroughFixture(request, (preview: FrameBoundsPreview) => {
        const bounds = preview.frameMotionBounds ?? preview.frameJobBounds;
        if (bounds === null) throw new Error('The fixture job has no outline');
        onFrameBounds?.({
          ...preview,
          frameMotionBounds: { ...bounds, maxX: bounds.maxX + 5 },
        });
      }).then(preparedStartOf),
    );

    await expect(runFrameNow()).resolves.toBe(false);

    expect(events).toEqual(['trace']);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(lastToast()).toMatchObject({
      variant: 'error',
      message: FRAME_TRACE_PROGRAM_MISMATCH_MESSAGE,
    });
  });
});
