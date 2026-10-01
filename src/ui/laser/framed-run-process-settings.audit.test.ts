import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { consumeClaimedFramedRun } from '../state/framed-run-start-consumption';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import { frameOnceRepository, installFrameOnceProject } from './frame-once.test-support';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import { runStartJobFlow } from './start-job-flow';
import { prepareCurrentStartJob } from './start-job-source';
import { useCameraStore } from '../state/camera-store';
import { frameVerificationBounds } from './frame-dispatch-support';
import { frameBoundsSignature } from '../../core/job';
import * as startJobSource from './start-job-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
let uninstallReview: () => void = () => undefined;

beforeEach(() => {
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useJobReviewStore.getState().close();
  useToastStore.setState({ toasts: [] });
  useLaserStore.setState({
    startJob: vi.fn(async (_gcode, options = {}) => {
      options.assertFinalStartAuthorized?.();
      consumeClaimedFramedRun(
        useLaserStore.setState,
        useLaserStore.getState,
        options.framedRunPermit,
      );
    }),
  });
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(() => {
  uninstallReview();
  useJobReviewStore.getState().close();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

function editProject(edit: (project: Project) => Project): void {
  useStore.setState((state) => ({ project: edit(state.project) }));
}

function setProcess(power: number, speed: number): void {
  useStore.getState().setLayerParam('red', { power, speed });
}

describe('ordinary Frame once, current exact settings on every Start', () => {
  it('retains Frame across power/speed edits and archives only the freshly reviewed S/F', async () => {
    const framed = await installReviewPendingFramedRunPermitForCurrentState();
    setProcess(37, 2300);
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    const repository = frameOnceRepository();

    await runStartJobFlow(repository);

    const call = vi.mocked(useLaserStore.getState().startJob).mock.calls[0];
    expect(call?.[0]).toMatch(/F2300/);
    expect(call?.[0]).toMatch(/S370(?:\s|$)/);
    expect(call?.[0]).not.toBe(framed.candidate.preparedStart.gcode);
    expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe(call?.[0]);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().completedFrame).not.toBeNull();
  });

  it('keeps reusable proof after consuming Start and obtains a new claim for changed settings', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    await runStartJobFlow(frameOnceRepository());
    expect(useLaserStore.getState().framedRun).toBeNull();
    setProcess(61, 1100);
    await runStartJobFlow(frameOnceRepository());

    const calls = vi.mocked(useLaserStore.getState().startJob).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toMatch(/F1100/);
    expect(calls[1]?.[0]).toMatch(/S610(?:\s|$)/);
    expect(calls[1]?.[1]?.framedRunPermit).not.toBe(calls[0]?.[1]?.framedRunPermit);
    expect(useLaserStore.getState().framedRunStartClaim).toBeNull();
  });

  it('rebuilds a power/speed edit in review and requires affirmative approval of new bytes', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    uninstallReview();
    let clicks = 0;
    uninstallReview = installAutoJobReview(() => {
      clicks += 1;
      if (clicks === 1) setProcess(52, 1700);
      return 'confirm';
    });
    await runStartJobFlow(frameOnceRepository());

    expect(clicks).toBe(2);
    const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[0];
    expect(gcode).toMatch(/S520(?:\s|$)/);
    expect(gcode).toMatch(/F1700/);
  });

  it('retains artwork power overrides and uses their latest effective settings', async () => {
    const framed = await installReviewPendingFramedRunPermitForCurrentState();
    editProject((project) => ({
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) => ({
          ...object,
          powerScale: 50,
          operationOverride: { byOperation: { red: { power: 64, speed: 900 } } },
        })),
      },
    }));
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    await runStartJobFlow(frameOnceRepository());
    const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[0];
    expect(gcode).toMatch(/S320(?:\s|$)/);
    expect(gcode).toMatch(/F900/);
  });

  it('does not restore completed Frame after coordinates change away and back', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    const original = useStore.getState().project;
    editProject((project) => ({
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) => ({
          ...object,
          transform: { ...object.transform, x: object.transform.x + 1 },
        })),
      },
    }));
    useStore.setState({ project: original });
    await runStartJobFlow(frameOnceRepository());
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(vi.mocked(useLaserStore.getState().startJob)).not.toHaveBeenCalled();
  });

  it('revokes Frame when a speed edit changes the actual scan-offset motion envelope', async () => {
    useStore.getState().setLayerParam('red', { mode: 'fill', fillOverscanMm: 0, speed: 600 });
    editProject((project) => ({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [
          { speedMmPerMin: 600, offsetMm: 0 },
          { speedMmPerMin: 1200, offsetMm: 2 },
        ],
      },
    }));
    const framed = await installReviewPendingFramedRunPermitForCurrentState();
    useStore.getState().setLayerParam('red', { speed: 1200 });
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    const updated = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
      framed.candidate.preparedStart.jobOrigin,
      false,
    );
    if (!updated.ok || updated.metrics.frameJobBounds === null)
      throw new Error('Expected scan job.');
    const newBounds = frameVerificationBounds(
      'laser',
      updated.metrics.frameJobBounds,
      updated.metrics.frameMotionBounds ?? updated.metrics.frameJobBounds,
    );
    expect(frameBoundsSignature(newBounds)).not.toBe(
      framed.candidate.frameVerification.boundsSignature,
    );
    await runStartJobFlow(frameOnceRepository());
    expect(vi.mocked(useLaserStore.getState().startJob).mock.calls).toHaveLength(0);
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/motion coordinates/);
  });

  it('cannot mint two exact Start claims from concurrent clicks', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    await Promise.all([
      runStartJobFlow(frameOnceRepository()),
      runStartJobFlow(frameOnceRepository()),
    ]);
    expect(vi.mocked(useLaserStore.getState().startJob)).toHaveBeenCalledTimes(1);
  });

  it('refuses settings edited after approval before wire, then reuses Frame for freshly approved bytes', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    const repository = frameOnceRepository();
    const originalArm = repository.armFreshStartIntent.bind(repository);
    const arm = vi.spyOn(repository, 'armFreshStartIntent');
    arm.mockImplementationOnce(async (...args) => {
      setProcess(68, 1250);
      return originalArm(...args);
    });

    await runStartJobFlow(repository);
    expect(vi.mocked(useLaserStore.getState().startJob).mock.calls).toHaveLength(0);
    expect(useLaserStore.getState().completedFrame === null).toBe(false);
    expect(repository.getSnapshot().pendingStart).toBeNull();
    expect(useLaserStore.getState().framedRunStartClaim).toBeNull();

    await runStartJobFlow(repository);
    const calls = vi.mocked(useLaserStore.getState().startJob).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatch(/S680(?:\s|$)/);
    expect(calls[0]?.[0]).toMatch(/F1250/);
  });

  it('refuses a second review while the first exact Start claim waits for durable handoff', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    const repository = frameOnceRepository();
    const originalArm = repository.armFreshStartIntent.bind(repository);
    let reviews = 0;
    uninstallReview();
    uninstallReview = installAutoJobReview(() => {
      reviews += 1;
      return 'confirm';
    });
    vi.spyOn(repository, 'armFreshStartIntent').mockImplementationOnce(async (...args) => {
      await runStartJobFlow(frameOnceRepository());
      return originalArm(...args);
    });

    await runStartJobFlow(repository);
    expect(reviews).toBe(1);
    expect(vi.mocked(useLaserStore.getState().startJob)).toHaveBeenCalledTimes(1);
  });

  it('silently releases a cancelled fresh preparation while keeping its unchanged Frame', async () => {
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    vi.spyOn(startJobSource, 'prepareCurrentStartJob').mockRejectedValueOnce(
      new DOMException('Superseded output preparation.', 'AbortError'),
    );
    await runStartJobFlow(frameOnceRepository());
    expect(vi.mocked(useLaserStore.getState().startJob).mock.calls).toHaveLength(0);
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    expect(useLaserStore.getState().framedRunStartClaim).toBeNull();
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
  });

  it('uses the latest profile S scale without reframing its unchanged coordinates', async () => {
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    editProject((project) => ({ ...project, device: { ...project.device, maxPowerS: 2000 } }));
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    const repository = frameOnceRepository();
    await runStartJobFlow(repository);
    const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[0];
    expect(gcode).toMatch(/S600(?:\s|$)/);
    expect(gcode).not.toMatch(/S300(?:\s|$)/);
    expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe(gcode);
  });

  it('reviews and archives the latest air and controlled tool-off words at the framed endpoints', async () => {
    useStore.getState().setLayerParam('red', { airAssist: true });
    editProject((project) => ({
      ...project,
      device: { ...project.device, airAssistCommand: 'M7' },
    }));
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    expect(frame.candidate.preparedStart.gcode).toMatch(/^M7$/m);
    editProject((project) => ({
      ...project,
      device: {
        ...project.device,
        airAssistCommand: 'M8',
        airAssistRestartUnreliable: true,
        controlledLaserOffTravelFeedMmPerMin: 800,
      },
    }));
    expect(useLaserStore.getState().completedFrame).toBe(frame);

    const repository = frameOnceRepository();
    await runStartJobFlow(repository);
    const gcode = vi.mocked(useLaserStore.getState().startJob).mock.calls[0]?.[0];
    expect(gcode).toMatch(/^M8$/m);
    expect(gcode).not.toMatch(/^M7$/m);
    // The 400 mm rear-origin bed maps authored (1, 1) to controller (1, 399).
    expect(gcode).toMatch(/^G1 X1\.000 Y399\.000 F800 S0/m);
    expect(repository.getSnapshot().activeRun?.artifact.gcode).toBe(gcode);
  });
});
