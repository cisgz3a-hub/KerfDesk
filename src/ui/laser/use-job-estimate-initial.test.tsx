import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import type * as PreparationWorkerClient from '../workspace/preparation-worker-client';
import type { LiveJobEstimate } from './live-job-estimate';
import { JOB_ESTIMATE_DEBOUNCE_MS, useJobEstimate } from './use-job-estimate';

const workerMocks = vi.hoisted(() => ({ prepareJobEstimateOffThread: vi.fn() }));
vi.mock('../workspace/preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof PreparationWorkerClient>()),
  prepareJobEstimateOffThread: workerMocks.prepareJobEstimateOffThread,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function largeRasterProject(): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color,
    source: 'audit.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 25,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, raster), {
      ...createLayer({ id: color, color, mode: 'image' }),
      linesPerMm: 25,
    }),
  };
}

function workerResult(totalSeconds = 720) {
  return {
    toolpath: { steps: [], totalLength: 0 },
    estimate: {
      kind: 'estimated',
      label: '12m 0s',
      totalSeconds,
      breakdown: { cutSeconds: totalSeconds - 20, travelSeconds: 20 },
    } satisfies LiveJobEstimate,
  };
}

function pendingWorker() {
  let resolve: (value: ReturnType<typeof workerResult>) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<ReturnType<typeof workerResult>>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const probe: { estimate: LiveJobEstimate | null } = { estimate: null };
const roots = new Set<Root>();
function Probe(): null {
  probe.estimate = useJobEstimate();
  return null;
}

async function renderProbe(strictMode = false) {
  const host = document.createElement('div');
  const root = createRoot(host);
  roots.add(root);
  await act(async () =>
    root.render(
      strictMode ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      ),
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    roots.delete(root);
  };
}

async function settleDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(JOB_ESTIMATE_DEBOUNCE_MS + 1);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  workerMocks.prepareJobEstimateOffThread.mockReset();
  workerMocks.prepareJobEstimateOffThread.mockReturnValue(null);
  useStore.getState().newProject();
  useLaserStore.setState({ statusReport: null, workOriginActive: false, wcoCache: null });
  probe.estimate = null;
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  useStore.getState().newProject();
  useLaserStore.setState({ statusReport: null, workOriginActive: false, wcoCache: null });
  vi.useRealTimers();
});

describe('initial large-job estimate (TIME-08)', () => {
  it('uses and invalidates the known physical head position in User Origin mode', async () => {
    const oldRequest = pendingWorker();
    const latest = workerResult(900);
    workerMocks.prepareJobEstimateOffThread
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(latest);
    useStore.setState({
      project: largeRasterProject(),
      jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
    });
    const report = {
      state: 'Idle' as const,
      subState: null,
      mPos: { x: 350, y: 20, z: 7 },
      wPos: null,
      feed: 0,
      spindle: 0,
      wco: { x: 50, y: 20, z: 3 },
    };
    useLaserStore.setState({ statusReport: report, workOriginActive: true });
    const unmount = await renderProbe();
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenNthCalledWith(
      1,
      useStore.getState().project,
      expect.objectContaining({
        jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
        initialPosition: { x: 300, y: 0, z: 4 },
      }),
    );
    const pendingEstimate = probe.estimate;
    await act(async () => {
      useLaserStore.setState({
        statusReport: { ...report, mPos: { ...report.mPos, x: 650 } },
      });
    });
    await act(async () => oldRequest.resolve(workerResult()));
    expect(probe.estimate).toBe(pendingEstimate);
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenNthCalledWith(
      2,
      useStore.getState().project,
      expect.objectContaining({ initialPosition: { x: 600, y: 0, z: 4 } }),
    );
    expect(probe.estimate).toBe(latest.estimate);
    await unmount();
  });

  it.each([false, true])(
    'requests the background estimate for an already-loaded project on mount and remount (StrictMode: %s)',
    async (strictMode) => {
      const prepared = workerResult();
      workerMocks.prepareJobEstimateOffThread.mockResolvedValue(prepared);
      useStore.setState({ project: largeRasterProject() });

      for (let mount = 1; mount <= 2; mount += 1) {
        const unmount = await renderProbe(strictMode);
        expect(probe.estimate?.kind).toBe('too-large');
        await settleDebounce();

        expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledTimes(mount);
        expect(probe.estimate).toBe(prepared.estimate);
        await unmount();
      }
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'ignores a late worker %s as soon as the project changes, including during its debounce',
    async (outcome) => {
      const oldRequest = pendingWorker();
      const newRequest = pendingWorker();
      workerMocks.prepareJobEstimateOffThread
        .mockReturnValueOnce(oldRequest.promise)
        .mockReturnValueOnce(newRequest.promise);
      useStore.setState({ project: largeRasterProject() });
      const unmount = await renderProbe();
      await settleDebounce();
      expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledOnce();
      const pendingEstimate = probe.estimate;

      await act(async () => {
        useStore.setState({ project: { ...useStore.getState().project } });
      });
      await act(async () => {
        if (outcome === 'resolve') oldRequest.resolve(workerResult());
        else oldRequest.reject(new Error('stale worker failure'));
      });
      expect(probe.estimate).toBe(pendingEstimate);

      await settleDebounce();
      expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledTimes(2);
      const latest = workerResult(900);
      await act(async () => newRequest.resolve(latest));
      expect(probe.estimate).toBe(latest.estimate);
      await unmount();
    },
  );

  it('cancels the initial request when unmounted before the debounce fires', async () => {
    workerMocks.prepareJobEstimateOffThread.mockResolvedValue(workerResult());
    useStore.setState({ project: largeRasterProject() });
    const unmount = await renderProbe();
    await unmount();
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).not.toHaveBeenCalled();
  });

  it('keeps a remounted estimate when the previous mount finishes its worker request later', async () => {
    const oldRequest = pendingWorker();
    const latest = workerResult(900);
    workerMocks.prepareJobEstimateOffThread
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(latest);
    useStore.setState({ project: largeRasterProject() });
    const unmount = await renderProbe();
    await settleDebounce();
    await unmount();

    const unmountAgain = await renderProbe();
    await settleDebounce();
    expect(probe.estimate).toBe(latest.estimate);
    await act(async () => oldRequest.resolve(workerResult()));
    expect(probe.estimate).toBe(latest.estimate);
    await unmountAgain();
  });
});
