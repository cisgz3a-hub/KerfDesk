import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject } from '../../core/scene';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { recoveryRepository } from '../state/recovery';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { useStore } from '../state/store';
import { resetStore, svgObj } from '../state/test-helpers';
import { JobControls } from './JobControls';
import {
  idleControllerStatusForFrameTest,
  installReviewPendingFramedRunPermitForCurrentState,
  reviewPendingFramedRunPermitForCurrentState,
} from './framed-run-testing';

// Replace only persistence plumbing. Both rendered surfaces use the real
// repository and current spatial Frame readiness subscriptions.
vi.mock('../state/recovery/default-recovery-repository', async () => {
  const { RecoveryRepository } = await import('../state/recovery/recovery-repository');
  const { MemoryRecoveryStorageBackend } = await import('../state/recovery/recovery-backend');
  const { MemoryRecoveryGenerationStore } = await import('../state/recovery/recovery-generation');
  return {
    recoveryRepository: new RecoveryRepository({
      backend: new MemoryRecoveryStorageBackend(),
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
    }),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let runSequence = 0;

beforeEach(async () => {
  resetStore();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: idleControllerStatusForFrameTest(),
  });
  usePrintCutSessionStore.getState().clear();
  useExperimentalLaserFeatures.getState().resetFeatures();
  const base = createProject();
  useStore.setState({
    project: {
      ...base,
      scene: {
        ...base.scene,
        objects: [svgObj('completed-design', ['#ff0000'])],
        layers: [createLayer({ id: 'completed-layer', color: '#ff0000' })],
      },
    },
  });
  await recoveryRepository.initialize();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  const receipt = recoveryRepository.getSnapshot().lastCompletedReceipt;
  if (receipt !== null) await recoveryRepository.discardCompletedReceipt(receipt.runId);
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.restoreAllMocks();
});

async function installCompletedReplay(): Promise<string> {
  const permit = await reviewPendingFramedRunPermitForCurrentState();
  const prepared = permit.candidate.preparedStart;
  runSequence += 1;
  const runId = 'completed-copy-' + runSequence;
  const artifact = await createCurrentTestExecutionArtifact({
    runId,
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    outputScope: permit.candidate.outputScope,
    canvasPlan: prepared.canvasPlan,
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
  });
  expect((await recoveryRepository.stageArtifact(artifact)).ok).toBe(true);
  expect((await recoveryRepository.activateFreshRun(runId)).ok).toBe(true);
  expect((await recoveryRepository.completeRun(runId)).ok).toBe(true);
  // Ordinary Start already consumed its one-use authorisation. Replay keeps
  // the completed Frame proof, as the controller-simulator regression verifies.
  useLaserStore.setState({
    framedRun: null,
    completedFrame: permit,
    frameVerification: permit.candidate.frameVerification,
  });
  return runId;
}

async function renderControls(): Promise<ReturnType<typeof vi.fn>> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const onStartJob = vi.fn();
  await act(async () => {
    root?.render(<JobControls disabled={false} onStartJob={onStartJob} />);
  });
  return onStartJob;
}

function button(label: string): HTMLButtonElement | null {
  return (
    [...(host?.querySelectorAll('button') ?? [])].find((item) => item.textContent === label) ?? null
  );
}

function status(label: string): HTMLElement | null {
  return (
    [...(host?.querySelectorAll<HTMLElement>('[role="status"]') ?? [])].find(
      (item) => item.textContent === label,
    ) ?? null
  );
}

describe('completed-job guidance in the machine rail', () => {
  it('keeps Start and repeat ready after the exact execution claim is consumed', async () => {
    await installCompletedReplay();
    const onStartJob = await renderControls();
    expect(status('Ready to start — framed placement unchanged')).not.toBeNull();
    expect(button('Run same job again from start')?.disabled).toBe(false);
    expect(button('Start')?.disabled).toBe(false);
    act(() => button('Start')?.click());
    expect(onStartJob).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().completedFrame).not.toBeNull();
  });

  it.each([
    ['Frame proof', () => useLaserStore.setState({ completedFrame: null, framedRun: null })],
    [
      'origin',
      () => useLaserStore.setState({ wcoCache: { x: 5, y: 0, z: 0 }, workOriginActive: true }),
    ],
  ])('disables Start and repeat immediately after %s changes', async (_name, change) => {
    const runId = await installCompletedReplay();
    await renderControls();
    expect(button('Run same job again from start')?.disabled).toBe(false);
    await act(async () => change());
    expect(status('Ready to start — framed placement unchanged')).toBeNull();
    expect(button('Run same job again from start')?.disabled).toBe(true);
    expect(button('Run same job again from start')?.title).toContain('Frame');
    expect(button('Start')?.disabled).toBe(true);
    expect(recoveryRepository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId);
  });

  it.each([
    [
      'output scope',
      () => useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true }),
    ],
    ['document', () => useStore.getState().newProject()],
  ])('removes exact repeat after %s changes', async (_name, change) => {
    const runId = await installCompletedReplay();
    await renderControls();
    await act(async () => change());
    expect(button('Run same job again from start')).toBeNull();
    expect(button('Start')?.disabled).toBe(true);
    expect(recoveryRepository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId);
  });

  it('keeps the ordinary ready caption after another completed Frame', async () => {
    await installCompletedReplay();
    await renderControls();
    await act(async () => {
      await installReviewPendingFramedRunPermitForCurrentState();
    });
    expect(status('Ready to start — framed placement unchanged')).not.toBeNull();
    expect(button('Start')?.disabled).toBe(false);
  });
});
