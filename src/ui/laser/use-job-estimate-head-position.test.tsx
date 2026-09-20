import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
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
import { startMotionOperation } from '../state/laser-motion-operation';
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

// Over the ADR-241/243 budgets, so the estimate always takes the background
// preparation path whose request key carries the head position.
function overBudgetRasterProject(): Project {
  const color = '#808080';
  const raster: SceneObject = {
    kind: 'raster-image',
    id: 'R1',
    color,
    source: 'x.png',
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

const STATUS_POLL_INTERVAL_MS = 250;

function reportAtX(x: number, state: StatusReport['state'] = 'Idle'): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  };
}

const probe: { current: LiveJobEstimate | null } = { current: null };

function Probe(): null {
  probe.current = useJobEstimate();
  return null;
}

async function renderProbe(): Promise<() => Promise<void>> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<Probe />);
  });
  return async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
}

async function settleDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(JOB_ESTIMATE_DEBOUNCE_MS + 1);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  probe.current = null;
  workerMocks.prepareJobEstimateOffThread.mockReset();
  workerMocks.prepareJobEstimateOffThread.mockImplementation(() =>
    Promise.resolve({
      estimate: {
        kind: 'estimated',
        label: '12m 0s',
        totalSeconds: 720,
        breakdown: { cutSeconds: 700, travelSeconds: 20 },
      } satisfies LiveJobEstimate,
    }),
  );
});

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({ statusReport: null, motionOperation: null, trustedPositionEpoch: 0 });
  vi.useRealTimers();
});

// A Frame moves the head for tens of seconds while the controller reports a
// fresh position four times a second. Keying the background preparation on
// each of those positions started a full compile per report and retained every
// finished route, which exhausted the renderer on a traced scanline fill.
describe('useJobEstimate head position', () => {
  it('holds the head position while an owned Frame moves it, then re-keys once it settles', async () => {
    useLaserStore.setState({ statusReport: reportAtX(0) });
    useStore.setState({ project: overBudgetRasterProject() });
    const unmount = await renderProbe();
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledOnce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenLastCalledWith(
      useStore.getState().project,
      expect.objectContaining({ initialPosition: { x: 0, y: 0, z: 0 } }),
    );

    // Frame owns the head: Run on each leg, Idle between them, a new position
    // on every poll. None of that may key another preparation.
    act(() => useLaserStore.setState({ motionOperation: startMotionOperation('frame') }));
    for (let poll = 1; poll <= 40; poll += 1) {
      await act(async () => {
        useLaserStore.setState({
          statusReport: reportAtX(poll * 5, poll % 4 === 0 ? 'Idle' : 'Run'),
        });
        await vi.advanceTimersByTimeAsync(STATUS_POLL_INTERVAL_MS);
      });
    }
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledOnce();

    // Frame returns the head to where it started: nothing to re-estimate.
    await act(async () => {
      useLaserStore.setState({ motionOperation: null, statusReport: reportAtX(0) });
    });
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledOnce();

    // A settled move to a genuinely new position re-keys exactly once.
    await act(async () => {
      useLaserStore.setState({ statusReport: reportAtX(25) });
    });
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledTimes(2);
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenLastCalledWith(
      useStore.getState().project,
      expect.objectContaining({ initialPosition: { x: 25, y: 0, z: 0 } }),
    );

    await unmount();
  });

  it('holds the last settled position through a streamed job, probe and MPG takeover', async () => {
    useLaserStore.setState({ statusReport: reportAtX(40) });
    useStore.setState({ project: overBudgetRasterProject() });
    const unmount = await renderProbe();
    await settleDebounce();
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledOnce();

    for (const busy of [
      { probeBusy: true },
      { autofocusBusy: true },
      { mpgActive: true },
    ] as const) {
      await act(async () => {
        useLaserStore.setState({ ...busy, statusReport: reportAtX(500, 'Run') });
      });
      await settleDebounce();
      await act(async () => {
        useLaserStore.setState({
          probeBusy: false,
          autofocusBusy: false,
          mpgActive: false,
          statusReport: reportAtX(40),
        });
      });
      await settleDebounce();
    }
    // The head never actually settled anywhere new, so the first request stands.
    expect(workerMocks.prepareJobEstimateOffThread).toHaveBeenCalledOnce();

    await unmount();
  });
});
