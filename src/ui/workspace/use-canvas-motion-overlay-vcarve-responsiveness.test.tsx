import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Polyline,
  type Project,
  type TextObject,
} from '../../core/scene';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { startLiveCanvasRun } from '../state/canvas-motion-plan';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useCanvasViewStore } from '../state/canvas-view-store';
import type { CanvasMotionOverlay } from './draw-canvas-motion';
import type * as IdlePlanModule from './idle-canvas-motion-plan';
import type * as IdleWorkerClient from './idle-canvas-motion-worker-client';

const planMocks = vi.hoisted(() => ({
  buildIdleCanvasMotionPlanFromRequest: vi.fn(),
}));

vi.mock('./idle-canvas-motion-plan', async (importOriginal) => ({
  ...(await importOriginal<typeof IdlePlanModule>()),
  buildIdleCanvasMotionPlanFromRequest: planMocks.buildIdleCanvasMotionPlanFromRequest,
}));

const workerMocks = vi.hoisted(() => ({
  prepareIdleCanvasMotionPlanOffThread: vi.fn(),
  cancelIdleCanvasMotionPlanOffThread: vi.fn(),
}));

vi.mock('./idle-canvas-motion-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof IdleWorkerClient>()),
  prepareIdleCanvasMotionPlanOffThread: workerMocks.prepareIdleCanvasMotionPlanOffThread,
  cancelIdleCanvasMotionPlanOffThread: workerMocks.cancelIdleCanvasMotionPlanOffThread,
}));

import { IDLE_CANVAS_PLAN_DELAY_MS, useCanvasMotionOverlay } from './use-canvas-motion-overlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null;
let observedOverlay: CanvasMotionOverlay | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
  planMocks.buildIdleCanvasMotionPlanFromRequest.mockReset();
  planMocks.buildIdleCanvasMotionPlanFromRequest.mockResolvedValue(null);
  workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReset();
  workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReturnValue(null);
  workerMocks.cancelIdleCanvasMotionPlanOffThread.mockReset();
  useCanvasViewStore.setState({ showGcode: false });
  useFramePreparationStore.setState({ pending: false, progress: null });
  observedOverlay = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
  vi.useRealTimers();
  useCanvasViewStore.setState({ showGcode: false });
});

describe('idle canvas V-carve responsiveness', () => {
  it('never falls back to full browser-thread planning after complex text or settings edits', async () => {
    const first = complexScriptProject();
    await render(first);
    await settleIdleDelay();

    const changed: Project = {
      ...first,
      scene: {
        ...first.scene,
        objects: first.scene.objects.map((object) =>
          object.kind === 'text' ? { ...object, content: `${object.content}!` } : object,
        ),
        layers: first.scene.layers.map((layer) => ({
          ...layer,
          cnc: {
            ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
            depthPerPassMm: 0.25,
          },
        })),
      },
    };
    await render(changed);
    await settleIdleDelay();

    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(2);
    expect(planMocks.buildIdleCanvasMotionPlanFromRequest).not.toHaveBeenCalled();
  });

  it('keeps ordinary idle-marker preparation on its established direct path', async () => {
    const project = complexScriptProject();
    const ordinary: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({
          ...layer,
          cnc: { ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS), cutType: 'profile-on-path' },
        })),
      },
    };

    await render(ordinary);
    await settleIdleDelay();

    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).not.toHaveBeenCalled();
    expect(planMocks.buildIdleCanvasMotionPlanFromRequest).toHaveBeenCalledTimes(1);
  });

  it('cancels and suppresses a delayed idle plan while G-code owns the canvas', async () => {
    let finish: ((plan: CanvasMotionOverlay['plan']) => void) | null = null;
    workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReturnValueOnce(
      new Promise<CanvasMotionOverlay['plan']>((resolve) => {
        finish = resolve;
      }),
    );
    await render(complexScriptProject());
    await settleIdleDelay();
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledOnce();

    await act(async () => useCanvasViewStore.getState().setShowGcode(true));
    expect(workerMocks.cancelIdleCanvasMotionPlanOffThread).toHaveBeenCalledOnce();
    await act(async () => finish?.({} as CanvasMotionOverlay['plan']));

    expect(observedOverlay).toBeNull();
  });

  it('marks retained terminal markers as updating and never republishes an older async result', async () => {
    const project = complexScriptProject();
    const initial = markerPlan(project, 'initial');
    const older = markerPlan(project, 'older');
    const newest = markerPlan(project, 'newest');
    let finishOlder: ((plan: CanvasMotionOverlay['plan']) => void) | undefined;
    let finishNewest: ((plan: CanvasMotionOverlay['plan']) => void) | undefined;
    workerMocks.prepareIdleCanvasMotionPlanOffThread
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(
        new Promise<CanvasMotionOverlay['plan']>((resolve) => {
          finishOlder = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<CanvasMotionOverlay['plan']>((resolve) => {
          finishNewest = resolve;
        }),
      );
    await render(project);
    await settleIdleDelay();
    expect(observedOverlay?.plan).toBe(initial);
    expect(observedOverlay?.planIsCurrent).toBe(true);
    await act(async () =>
      useLaserStore.setState({
        liveCanvasRun: { ...startLiveCanvasRun(initial), lifecycle: 'stopped' },
      }),
    );
    await render({ ...project, scene: { ...project.scene } });
    expect(observedOverlay?.plan).toBe(initial);
    expect(observedOverlay?.planIsCurrent).toBe(false);
    await settleIdleDelay();
    await render({ ...project, scene: { ...project.scene } });
    await settleIdleDelay();
    await act(async () => finishNewest?.(newest));
    expect(observedOverlay?.plan).toBe(newest);
    expect(observedOverlay?.planIsCurrent).toBe(true);
    expect(observedOverlay?.run).toBeNull();
    await act(async () => finishOlder?.(older));
    expect(observedOverlay?.plan).toBe(newest);
    expect(observedOverlay?.planIsCurrent).toBe(true);
  });

  it.each(['placement', 'output scope', 'machine context'] as const)(
    'does not describe terminal markers as current after %s changes without a replacement plan',
    async (changedContext) => {
      const project = complexScriptProject();
      const initial = markerPlan(project, 'initial');
      workerMocks.prepareIdleCanvasMotionPlanOffThread.mockResolvedValueOnce(initial);
      await render(project);
      await settleIdleDelay();
      await act(async () =>
        useLaserStore.setState({
          liveCanvasRun: { ...startLiveCanvasRun(initial), lifecycle: 'stopped' },
        }),
      );
      expect(observedOverlay?.planIsCurrent).toBe(true);

      await act(async () => {
        if (changedContext === 'placement') {
          useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } });
        } else if (changedContext === 'output scope') {
          useStore.setState({
            outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
            selectedObjectId: 'dancing-script-like',
          });
        } else {
          useLaserStore.setState({ trustedPositionEpoch: 1 });
        }
      });

      expect(observedOverlay?.plan).toBe(initial);
      expect(observedOverlay?.run?.lifecycle).toBe('stopped');
      expect(observedOverlay?.planIsCurrent).toBe(false);
      await settleIdleDelay();
      expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(2);
      expect(observedOverlay?.plan).toBe(initial);
      expect(observedOverlay?.planIsCurrent).toBe(false);
    },
  );

  it.each(['running', 'paused', 'tool-change'] as const)(
    'keeps the active %s plan current without requiring an idle replacement',
    async (lifecycle) => {
      const project = complexScriptProject();
      const active = markerPlan(project, 'active');
      useLaserStore.setState({ liveCanvasRun: { ...startLiveCanvasRun(active), lifecycle } });
      await render(project);
      await act(async () =>
        useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } }),
      );
      await settleIdleDelay();

      expect(observedOverlay?.plan).toBe(active);
      expect(observedOverlay?.run?.lifecycle).toBe(lifecycle);
      expect(observedOverlay?.planIsCurrent).toBe(true);
      expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).not.toHaveBeenCalled();
    },
  );
});

describe('idle canvas plan during a Frame trace', () => {
  it('plans once after the Frame, not at every Idle corner it reports on the way', async () => {
    const pending = new Promise<CanvasMotionOverlay['plan']>(() => undefined);
    workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReturnValue(pending);
    useLaserStore.setState({ statusReport: idleAt(0, 0) });
    await render(complexScriptProject());
    await settleIdleDelay();
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(1);

    await act(async () =>
      useLaserStore.setState({ motionOperation: startMotionOperation('frame') }),
    );
    for (const [x, y] of [
      [10, 10],
      [60, 10],
      [60, 40],
      [10, 40],
    ] as const) {
      await act(async () => useLaserStore.setState({ statusReport: idleAt(x, y) }));
      await settleIdleDelay();
    }
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(1);

    await act(async () => useLaserStore.setState({ motionOperation: null }));
    await settleIdleDelay();
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(2);
  });

  it('waits while a Frame is still preparing the job, cancelling a plan in flight', async () => {
    const pending = new Promise<CanvasMotionOverlay['plan']>(() => undefined);
    workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReturnValue(pending);
    useLaserStore.setState({ statusReport: idleAt(0, 0) });
    await render(complexScriptProject());
    await settleIdleDelay();
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(1);

    await act(async () => useFramePreparationStore.setState({ pending: true }));
    expect(workerMocks.cancelIdleCanvasMotionPlanOffThread).toHaveBeenCalledOnce();
    await act(async () => useLaserStore.setState({ statusReport: idleAt(20, 20) }));
    await settleIdleDelay();
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(1);

    await act(async () => useFramePreparationStore.setState({ pending: false }));
    await settleIdleDelay();
    expect(workerMocks.prepareIdleCanvasMotionPlanOffThread).toHaveBeenCalledTimes(2);
  });
});

function idleAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

function markerPlan(project: Project, key: string): CanvasMotionOverlay['plan'] {
  const gcode = 'G21\nG90\nM5\nG0 X0 Y0\nG1 X10 F1000';
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'cnc' }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: key,
    machineKind: 'cnc',
    device: project.device,
    coordinateFrame: { kind: 'relative', jobOriginOffset: { x: 0, y: 0 } },
    framePerimeter: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    jobStart: { x: 0, y: 0 },
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

async function render(project: Project): Promise<void> {
  useStore.setState({ project });
  await act(async () => root?.render(<Harness project={project} />));
}

async function settleIdleDelay(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(IDLE_CANVAS_PLAN_DELAY_MS + 1));
}

function Harness(props: { readonly project: Project }): JSX.Element | null {
  observedOverlay = useCanvasMotionOverlay(props.project, false);
  return null;
}

function complexScriptProject(): Project {
  const color = '#7c3aed';
  const text: TextObject = {
    kind: 'text',
    id: 'dancing-script-like',
    content: 'Dancing Script responsiveness fixture',
    fontKey: 'dancing-script-regular',
    sizeMm: 12,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color,
    bounds: { minX: 0, minY: 0, maxX: 120, maxY: 8 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: thinContours(120) }],
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [text],
      layers: [
        {
          ...createLayer({ id: 'script-vcarve', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            vCarveFlatDepthEnabled: false,
          },
        },
      ],
    },
  };
}

function thinContours(count: number): ReadonlyArray<Polyline> {
  return Array.from({ length: count }, (_, index) => {
    const x = index;
    return {
      closed: true,
      points: [
        { x, y: 0 },
        { x: x + 0.8, y: 0 },
        { x: x + 0.8, y: 0.08 },
        { x, y: 0.08 },
      ],
    };
  });
}
