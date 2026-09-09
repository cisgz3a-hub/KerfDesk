import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_JOB } from '../../core/job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type * as Gcode from '../../io/gcode';
import type * as IdlePlan from './idle-canvas-motion-plan';
import type * as IdleWorker from './idle-canvas-motion-worker-client';
import type * as PreparationWorker from './preparation-worker-client';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useCanvasViewStore } from '../state/canvas-view-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { useJobEstimate, JOB_ESTIMATE_DEBOUNCE_MS } from '../laser/use-job-estimate';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { useCanvasMotionOverlay } from './use-canvas-motion-overlay';
import type { CanvasMotionOverlay } from './draw-canvas-motion';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  idleDirect: vi.fn(),
  idleWorker: vi.fn(),
  idleCancel: vi.fn(),
  estimateWorker: vi.fn(),
}));

// Only actual compilation/worker transport are replaced. The real hooks,
// scope resolution, raster classification and estimate gate must all agree.
vi.mock('../../io/gcode', async (original) => ({
  ...(await original<typeof Gcode>()),
  prepareOutput: mocks.prepare,
}));
vi.mock('./idle-canvas-motion-plan', async (original) => ({
  ...(await original<typeof IdlePlan>()),
  buildIdleCanvasMotionPlanFromRequest: mocks.idleDirect,
}));
vi.mock('./idle-canvas-motion-worker-client', async (original) => ({
  ...(await original<typeof IdleWorker>()),
  prepareIdleCanvasMotionPlanOffThread: mocks.idleWorker,
  cancelIdleCanvasMotionPlanOffThread: mocks.idleCancel,
}));
vi.mock('./preparation-worker-client', async (original) => ({
  ...(await original<typeof PreparationWorker>()),
  prepareJobEstimateOffThread: mocks.estimateWorker,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null;
let host: HTMLDivElement;
const observed: { overlay: CanvasMotionOverlay | null; estimate: LiveJobEstimate | null } = {
  overlay: null,
  estimate: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useCanvasViewStore.setState({ showGcode: false });
  useExperimentalLaserFeatures.getState().resetFeatures();
  usePrintCutSessionStore.getState().clear();
  mocks.prepare.mockReset().mockImplementation((project: Project) => ({
    ok: true,
    project,
    job: EMPTY_JOB,
    jobOriginOffset: { x: 0, y: 0 },
  }));
  mocks.idleDirect.mockReset().mockResolvedValue(null);
  mocks.idleWorker.mockReset().mockReturnValue(null);
  mocks.idleCancel.mockReset();
  mocks.estimateWorker.mockReset().mockReturnValue(null);
  observed.overlay = null;
  observed.estimate = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('ordinary raster canvas background preparation', () => {
  it('settles a saved raster ETA after development StrictMode effect replay', async () => {
    const estimate = {
      kind: 'estimated',
      label: '12s',
      totalSeconds: 12,
      breakdown: { cutSeconds: 10, travelSeconds: 2 },
    } as const;
    mocks.estimateWorker.mockResolvedValue({ estimate });
    await render(rasterProject(1254), true);
    await settle();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.estimateWorker).toHaveBeenCalledOnce();
    expect(observed.estimate).toEqual(estimate);
  });

  it('ignores a worker estimate that arrives after the StrictMode consumer unmounts', async () => {
    let resolve: ((value: { readonly estimate: LiveJobEstimate }) => void) | undefined;
    mocks.estimateWorker.mockReturnValue(
      new Promise((complete) => {
        resolve = complete;
      }),
    );
    await render(rasterProject(1254), true);
    await settle();
    expect(mocks.estimateWorker).toHaveBeenCalledOnce();
    await act(async () => root?.unmount());
    root = null;
    const readEstimate = vi.fn(() => ({ kind: 'empty' as const }));
    await act(async () =>
      resolve?.({
        get estimate() {
          return readEstimate();
        },
      }),
    );
    expect(readEstimate).not.toHaveBeenCalled();
  });

  it('routes both initial saved-project ETA and idle markers to workers and settles their results', async () => {
    const marker = {
      retentionKey: 'large-raster',
      jobStart: { x: 1, y: 2 },
    } as CanvasMotionOverlay['plan'];
    const estimate = {
      kind: 'estimated',
      label: '12s',
      totalSeconds: 12,
      breakdown: { cutSeconds: 10, travelSeconds: 2 },
    } as const;
    mocks.idleWorker.mockResolvedValue(marker);
    mocks.estimateWorker.mockResolvedValue({ estimate });
    const project = rasterProject(1254);
    await render(project);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(observed.estimate).toEqual({ kind: 'too-large' });
    await settle();
    expect(mocks.idleDirect).not.toHaveBeenCalled();
    expect(mocks.idleWorker).toHaveBeenCalledOnce();
    expect(mocks.idleWorker.mock.calls[0]?.[0].project).toBe(project);
    expect(mocks.estimateWorker).toHaveBeenCalledOnce();
    expect(mocks.estimateWorker.mock.calls[0]?.[0]).toBe(project);
    expect(observed.overlay?.plan).toBe(marker);
    expect(observed.estimate).toEqual(estimate);
  });

  it('does not fall back to the browser compiler when workers are unavailable', async () => {
    await render(rasterProject(4096));
    await settle();
    expect(mocks.idleWorker).toHaveBeenCalledOnce();
    expect(mocks.estimateWorker).toHaveBeenCalledOnce();
    expect(mocks.idleDirect).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(observed.overlay).toBeNull();
    expect(observed.estimate).toEqual({ kind: 'too-large' });
  });

  it('keeps a small raster estimate and marker plan on their direct paths', async () => {
    await render(rasterProject(8));
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(observed.estimate).toEqual({ kind: 'empty' });
    await settle();
    expect(mocks.idleDirect).toHaveBeenCalledOnce();
    expect(mocks.idleWorker).not.toHaveBeenCalled();
    expect(mocks.estimateWorker).not.toHaveBeenCalled();
  });
});

async function render(project: Project, strictMode = false): Promise<void> {
  useStore.setState({ project });
  await act(async () =>
    root?.render(
      strictMode ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    ),
  );
}

async function settle(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(JOB_ESTIMATE_DEBOUNCE_MS + 1));
}

function Harness(): null {
  const project = useStore((state) => state.project);
  observed.overlay = useCanvasMotionOverlay(project, false);
  observed.estimate = useJobEstimate();
  return null;
}

function rasterProject(side: number): Project {
  return {
    ...createProject(),
    scene: {
      objects: [
        {
          kind: 'raster-image',
          id: 'raster',
          source: 'saved.png',
          color: '#808080',
          dataUrl: 'data:image/png;base64,metadata-only',
          pixelWidth: side,
          pixelHeight: side,
          bounds: { minX: 0, minY: 0, maxX: side / 10, maxY: side / 10 },
          transform: IDENTITY_TRANSFORM,
          operationIds: ['image'],
          dither: 'floyd-steinberg',
          linesPerMm: 10,
        },
      ],
      layers: [
        { ...createLayer({ id: 'image', color: '#808080', mode: 'image' }), linesPerMm: 10 },
      ],
    },
  };
}
