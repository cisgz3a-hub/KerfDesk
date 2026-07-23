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
import { useStore } from '../state';
import type { LiveJobEstimate } from './live-job-estimate';
import { JOB_ESTIMATE_DEBOUNCE_MS, useJobEstimate } from './use-job-estimate';

const workerMocks = vi.hoisted(() => ({ prepareLargeJobOffThread: vi.fn() }));

vi.mock('../workspace/preparation-worker-client', () => workerMocks);

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

beforeEach(() => {
  vi.useFakeTimers();
  probe.current = null;
  workerMocks.prepareLargeJobOffThread.mockReset();
  workerMocks.prepareLargeJobOffThread.mockReturnValue(null);
});

afterEach(() => {
  useStore.getState().newProject();
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
