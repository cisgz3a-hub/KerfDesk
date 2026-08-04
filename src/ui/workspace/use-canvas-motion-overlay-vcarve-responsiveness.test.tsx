import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
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

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
  planMocks.buildIdleCanvasMotionPlanFromRequest.mockReset();
  planMocks.buildIdleCanvasMotionPlanFromRequest.mockResolvedValue(null);
  workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReset();
  workerMocks.prepareIdleCanvasMotionPlanOffThread.mockReturnValue(null);
  workerMocks.cancelIdleCanvasMotionPlanOffThread.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host.remove();
  vi.useRealTimers();
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
});

async function render(project: Project): Promise<void> {
  useStore.setState({ project });
  await act(async () => root?.render(<Harness project={project} />));
}

async function settleIdleDelay(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(IDLE_CANVAS_PLAN_DELAY_MS + 1));
}

function Harness(props: { readonly project: Project }): JSX.Element | null {
  useCanvasMotionOverlay(props.project, false);
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
