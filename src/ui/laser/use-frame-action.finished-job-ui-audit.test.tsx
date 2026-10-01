import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import type { FramedRunCandidate } from '../state/framed-run';
import { completedRun } from './CompletedJobNotice.test-support';
import { JobActionControls } from './JobActionControls';
import type * as OutputWorkerModule from './output-preparation-worker-client';
import * as outputWorkerModule from './output-preparation-worker-client';
import { resetOutputPreparationWorkerForTests } from './output-preparation-worker-client';
import {
  resetSplitFrameStores,
  restoreSplitFrameStores,
  completeExactFrameForTest,
  dispatchedFrameOperation,
} from './split-frame.test-support';
import { HeldFrameWorker, startHeldFrame } from './split-frame-owned-preparation.test-support';
import { runFrameNow } from './use-frame-action';

vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputWorkerModule>()),
  outputPreparationShouldRunOffThread: () => true,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalFrame = useLaserStore.getState().frame;
const originalTraceFrame = useLaserStore.getState().traceFrame;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetOutputPreparationWorkerForTests();
  HeldFrameWorker.instances = [];
  vi.stubGlobal('Worker', HeldFrameWorker);
  useLaserStore.setState(initialLaserState());
  resetSplitFrameStores();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetOutputPreparationWorkerForTests();
  restoreSplitFrameStores(originalFrame, originalTraceFrame);
  useLaserStore.setState({ liveCanvasRun: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function offsetArtwork(x: number) {
  const previous = useStore.getState().project;
  return {
    ...previous,
    scene: {
      ...previous.scene,
      objects: previous.scene.objects.map((object) => ({
        ...object,
        id: `${object.id}-${x}`,
        transform: { ...object.transform, x },
      })),
    },
  };
}

function button(label: string): HTMLButtonElement {
  const element = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (element === undefined) throw new Error(`Missing ${label} button.`);
  return element;
}

describe('Frame ownership with a retained finished job display', () => {
  it('describes physical framing of an already prepared program accurately', async () => {
    vi.spyOn(outputWorkerModule, 'outputPreparationShouldRunOffThread').mockReturnValue(false);
    useLaserStore.setState({ liveCanvasRun: completedRun() });
    let candidate: FramedRunCandidate | undefined;
    const frame = vi.fn<typeof originalFrame>(async (_bounds, _feed, exact) => {
      if (exact === undefined) throw new Error('Frame needs its exact candidate.');
      candidate = exact;
      dispatchedFrameOperation(exact);
    });
    useLaserStore.setState({ frame });
    await act(async () => {
      root.render(<JobActionControls disabled={false} streaming={false} onStartJob={vi.fn()} />);
    });
    let outcome: Promise<boolean> | undefined;
    await act(async () => {
      outcome = runFrameNow();
      await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(1));
    });
    if (candidate === undefined || outcome === undefined) throw new Error('No exact Frame.');
    const exactCandidate = candidate;
    const duringMotion = host.querySelector('[role="status"]')?.textContent;
    await act(async () => {
      completeExactFrameForTest(exactCandidate);
      await expect(outcome).resolves.toBe(true);
    });
    expect(duringMotion).toBe('Framing exact job…');
  });

  it.each(['new canvas', 'opened project', 'edited artwork'] as const)(
    'prepares and frames current artwork after %s without requiring Done',
    async (change) => {
      const previousDisplay = completedRun();
      useLaserStore.setState({ liveCanvasRun: previousDisplay });
      const replacement = offsetArtwork(60);
      if (change === 'new canvas') useStore.getState().newProject();
      if (change === 'edited artwork') useStore.setState({ project: replacement });
      else useStore.getState().setProject(replacement);
      useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
      const currentProject = useStore.getState().project;
      await act(async () => {
        root.render(<JobActionControls disabled={false} streaming={false} onStartJob={vi.fn()} />);
      });
      expect(button('Frame job').disabled).toBe(false);
      expect(button('Start').disabled).toBe(true);
      let started: Awaited<ReturnType<typeof startHeldFrame>> | undefined;
      await act(async () => {
        started = await startHeldFrame();
      });
      if (started === undefined) throw new Error('Frame was not dispatched.');
      const frame = started;
      await act(async () => {
        frame.complete();
        frame.worker.release();
        await expect(frame.outcome).resolves.toBe(true);
      });
      expect(frame.candidate.project).toBe(currentProject);
      expect(frame.candidate.executionSignature).not.toBe(previousDisplay.plan.retentionKey);
      expect(useLaserStore.getState().traceFrame).toHaveBeenCalledWith(
        expect.objectContaining({ minX: 64, maxX: 84 }),
        expect.any(Number),
        frame.candidate,
      );
      expect(useLaserStore.getState().framedRun?.candidate.project).toBe(currentProject);
      expect(useFramePreparationStore.getState().pending).toBe(false);
      expect(button('Start').disabled).toBe(false);
      expect(button('Frame again').disabled).toBe(false);
      expect(host.textContent).toContain('Ready to start');
      expect(useLaserStore.getState().liveCanvasRun).toBeNull();
    },
  );

  it('keeps the next Frame permit and progress when an expired job returns its old worker result', async () => {
    useLaserStore.setState({ liveCanvasRun: completedRun() });
    const old = await startHeldFrame();
    await act(async () => old.complete());
    expect(useFramePreparationStore.getState().pending).toBe(true);
    useStore.getState().newProject();
    await expect(old.outcome).resolves.toBe(false);
    expect(old.worker.terminated).toBe(true);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    // Install a different real job after New cleared the old document.
    resetSplitFrameStores();
    useStore.setState({ project: offsetArtwork(120) });
    const next = await startHeldFrame();
    expect(runFrameNow()).toBe(next.outcome);
    old.worker.release();
    expect(useFramePreparationStore.getState()).toMatchObject({ pending: true, stage: 'tracing' });
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'frame',
      candidate: next.candidate,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
    next.complete();
    next.worker.release();
    await expect(next.outcome).resolves.toBe(true);
    const currentPermit = useLaserStore.getState().framedRun;
    old.worker.release();
    await Promise.resolve();
    expect(useLaserStore.getState().framedRun).toBe(currentPermit);
    expect(currentPermit?.candidate.project).toBe(useStore.getState().project);
    expect(useFramePreparationStore.getState().pending).toBe(false);
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('success');
  });
});
