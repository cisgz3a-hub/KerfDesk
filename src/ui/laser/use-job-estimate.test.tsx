import { act } from 'react';
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
import type { StatusReport } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import type * as PreparationWorkerClient from '../workspace/preparation-worker-client';
import { PreparationSupersededError } from '../workspace/preparation-worker-client';
import { PRINT_CUT_REGISTRATION_INVALID_MESSAGE } from '../../io/gcode/prepare-output-snapshot';
import type { LiveJobEstimate } from './live-job-estimate';
import type * as LiveJobEstimateModule from './live-job-estimate';
import { JOB_ESTIMATE_DEBOUNCE_MS, useJobEstimate } from './use-job-estimate';

const workerMocks = vi.hoisted(() => ({ prepareLargeJobOffThread: vi.fn() }));
const estimateMocks = vi.hoisted(() => ({ estimateLiveJob: vi.fn() }));

// Only dispatch is stubbed: the supersede error type and its guard must be the
// REAL ones, or the hook's "ignore an internal supersede" branch would be
// tested against a lookalike that instanceof can never match.
vi.mock('../workspace/preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof PreparationWorkerClient>()),
  prepareLargeJobOffThread: workerMocks.prepareLargeJobOffThread,
}));

vi.mock('./live-job-estimate', async (importOriginal) => {
  const actual = await importOriginal<typeof LiveJobEstimateModule>();
  estimateMocks.estimateLiveJob.mockImplementation(actual.estimateLiveJob);
  return { ...actual, estimateLiveJob: estimateMocks.estimateLiveJob };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function lineProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 50, y: 10 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: '#000000', color: '#000000' })),
  };
}

const probe: { current: LiveJobEstimate | null } = { current: null };
// Every distinct estimate identity the hook has handed out. A settle is the
// only way that identity changes, so its growth counts recomputes.
const settles: LiveJobEstimate[] = [];

function Probe(): null {
  const estimate = useJobEstimate();
  if (settles[settles.length - 1] !== estimate) settles.push(estimate);
  probe.current = estimate;
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

// A connected controller polls `?` at this cadence and stores the parsed
// report, so anything keyed on the report's identity re-keys this often.
const STATUS_POLL_INTERVAL_MS = 100;
const STATUS_POLLS_PER_SETTLE = 10;

function idleReportAtX(x: number): StatusReport {
  // wco null + no custom origin is the disconnected-origin case that sends
  // User Origin through the resolveExportJobPlacement fallback.
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  probe.current = null;
  settles.length = 0;
  workerMocks.prepareLargeJobOffThread.mockReset();
  workerMocks.prepareLargeJobOffThread.mockReturnValue(null);
  estimateMocks.estimateLiveJob.mockClear();
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
});

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({ statusReport: null, trustedPositionEpoch: 0 });
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  vi.useRealTimers();
});

describe('useJobEstimate debounce (H16)', () => {
  it('computes the first estimate synchronously on mount', async () => {
    useStore.setState({ project: lineProject() });
    const unmount = await renderProbe();

    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('does not recompute during rapid project mutations (drag), then settles after the quiet period', async () => {
    useStore.setState({ project: lineProject() });
    const unmount = await renderProbe();
    const initial = probe.current;

    // Simulate a drag: many project identity changes in quick succession.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        useStore.setState({ project: { ...useStore.getState().project } });
        vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS / 2);
      });
    }
    // Mid-drag: the settled estimate object is unchanged (no recompute).
    expect(probe.current).toBe(initial);

    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });
    // After the quiet period the estimate re-settles on the latest project.
    expect(probe.current).not.toBe(initial);
    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('reflects a meaningful scene change after the debounce window', async () => {
    const unmount = await renderProbe();
    expect(probe.current?.kind).toBe('empty');

    await act(async () => {
      useStore.setState({ project: lineProject() });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });

    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('does not reset the estimate debounce on an unrelated store update', async () => {
    useStore.setState({ project: lineProject() });
    const unmount = await renderProbe();
    const initial = probe.current;

    await act(async () => {
      useStore.setState({ project: { ...useStore.getState().project } });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS / 2);
    });
    // A hover writes cursorMm — unrelated to the estimate. Subscribing via
    // currentOutputScope(s) returned a fresh object per store update, which
    // re-armed the debounce on every such update and starved the recompute.
    await act(async () => {
      useStore.getState().setCursorMm({ x: 5, y: 5 });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS / 2 + 1);
    });

    // The full window elapsed since the edit: the hover must not have reset it.
    expect(probe.current).not.toBe(initial);
    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('resolves User Origin placement with the export fallback so the worker key matches the preview', async () => {
    workerMocks.prepareLargeJobOffThread.mockReturnValue(new Promise(() => undefined));
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
    const unmount = await renderProbe();

    await act(async () => {
      useStore.setState({ project: overBudgetRasterProject() });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });

    // Disconnected machine: live resolution fails, but the preview keys its
    // worker request on the export fallback placement — the estimate must
    // pass the SAME jobOrigin or the project prepares twice, serially.
    expect(workerMocks.prepareLargeJobOffThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
      }),
    );

    await unmount();
  });

  it('settles while a connected controller polls and the resolved placement is unchanged', async () => {
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
    useLaserStore.setState({ statusReport: idleReportAtX(0) });
    const unmount = await renderProbe();
    expect(probe.current?.kind).toBe('empty');
    const settlesBeforeEdit = settles.length;

    await act(async () => {
      useStore.setState({ project: lineProject() });
    });

    // Ten polls spanning four debounce windows. Each stores a FRESH report
    // object, but the resolved User Origin placement is byte-identical across
    // all of them, so the debounce must not re-arm: tracking the placement's
    // per-call jobOrigin object by reference starved the estimate forever on
    // any connected machine.
    for (let poll = 1; poll <= STATUS_POLLS_PER_SETTLE; poll += 1) {
      await act(async () => {
        useLaserStore.setState({ statusReport: idleReportAtX(poll) });
        vi.advanceTimersByTime(STATUS_POLL_INTERVAL_MS);
      });
    }

    expect(probe.current?.kind).toBe('estimated');
    // Exactly one recompute for the edit — polls must not add their own.
    expect(settles.length - settlesBeforeEdit).toBe(1);

    await unmount();
  });

  it('replaces a too-large estimate with the worker result (ADR-244)', async () => {
    let resolveWorker: (value: { toolpath: unknown; estimate: LiveJobEstimate }) => void = () =>
      undefined;
    workerMocks.prepareLargeJobOffThread.mockReturnValue(
      new Promise((resolve) => {
        resolveWorker = resolve;
      }),
    );
    const unmount = await renderProbe();

    await act(async () => {
      useStore.setState({ project: overBudgetRasterProject() });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });
    expect(probe.current?.kind).toBe('too-large');

    await act(async () => {
      resolveWorker({
        toolpath: { steps: [], totalLength: 0 },
        estimate: {
          kind: 'estimated',
          label: '12m 0s',
          totalSeconds: 720,
          breakdown: { cutSeconds: 700, travelSeconds: 20 },
        },
      });
    });
    expect(probe.current?.kind).toBe('estimated');

    await unmount();
  });

  it('surfaces invalid Print-and-Cut trust without waiting on background compilation', async () => {
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    useLaserStore.setState({ trustedPositionEpoch: 4 });
    usePrintCutSessionStore.getState().capture('first', { x: 20, y: 20 }, 3);
    usePrintCutSessionStore.getState().capture('second', { x: 120, y: 20 }, 3);
    useStore.setState({
      project: {
        ...lineProject(),
        printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 100, y: 0 } },
      },
    });
    const unmount = await renderProbe();

    expect(probe.current).toEqual({
      kind: 'preparation-failed',
      message: PRINT_CUT_REGISTRATION_INVALID_MESSAGE,
    });
    expect(estimateMocks.estimateLiveJob).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });

    expect(probe.current).toEqual({
      kind: 'preparation-failed',
      message: PRINT_CUT_REGISTRATION_INVALID_MESSAGE,
    });
    expect(workerMocks.prepareLargeJobOffThread).not.toHaveBeenCalled();
    expect(estimateMocks.estimateLiveJob).not.toHaveBeenCalled();

    await unmount();
  });

  it('never compiles a valid Print-and-Cut snapshot synchronously on mount', async () => {
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    useLaserStore.setState({ trustedPositionEpoch: 3 });
    usePrintCutSessionStore.getState().capture('first', { x: 20, y: 20 }, 3);
    usePrintCutSessionStore.getState().capture('second', { x: 120, y: 20 }, 3);
    useStore.setState({
      project: {
        ...lineProject(),
        printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 100, y: 0 } },
      },
    });
    workerMocks.prepareLargeJobOffThread.mockReturnValue(new Promise(() => undefined));
    const unmount = await renderProbe();

    expect(probe.current).toEqual({ kind: 'too-large' });
    expect(estimateMocks.estimateLiveJob).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });

    expect(workerMocks.prepareLargeJobOffThread).toHaveBeenCalledTimes(1);
    expect(estimateMocks.estimateLiveJob).not.toHaveBeenCalled();

    await unmount();
  });

  it.each([['newer-request'], ['newer-project']] as const)(
    'keeps the previous estimate when the background request is superseded (%s)',
    async (reason) => {
      // Rejected on demand, not up front, so the paused badge is observed
      // BEFORE the supersede lands — that is the value the fix must preserve.
      let supersede: () => void = () => undefined;
      workerMocks.prepareLargeJobOffThread.mockReturnValue(
        new Promise((_resolve, reject) => {
          supersede = () => reject(new PreparationSupersededError(reason));
        }),
      );
      const unmount = await renderProbe();

      await act(async () => {
        useStore.setState({ project: overBudgetRasterProject() });
      });
      await act(async () => {
        vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
      });
      const paused = probe.current;
      expect(paused?.kind).toBe('too-large');

      await act(async () => {
        supersede();
        await Promise.resolve();
      });

      // A supersede is this client's own coalescing decision — while jogging
      // with Preview open it fires inside every debounce window, so rendering
      // it as a failure pinned "ETA unavailable" for the whole jog.
      expect(probe.current).toBe(paused);
      expect(probe.current?.kind).not.toBe('preparation-failed');

      await unmount();
    },
  );

  it('reports a worker failure instead of leaving the estimate paused forever', async () => {
    workerMocks.prepareLargeJobOffThread.mockRejectedValue(new Error('worker crashed'));
    const unmount = await renderProbe();

    await act(async () => {
      useStore.setState({ project: overBudgetRasterProject() });
    });
    await act(async () => {
      vi.advanceTimersByTime(JOB_ESTIMATE_DEBOUNCE_MS + 1);
    });
    await act(async () => Promise.resolve());

    expect(probe.current).toEqual({
      kind: 'preparation-failed',
      message: 'Background estimate failed: worker crashed. Edit the job to retry.',
    });

    await unmount();
  });
});
