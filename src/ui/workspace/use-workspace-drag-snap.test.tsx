// Snapping while drawing, through the real pointer pipeline (LBG-F06).

import { act, useCallback, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  transformedBBox,
  type Project,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { SNAP_SETTINGS_KEY } from '../state/snap-preferences';
import { resetStore } from '../state/test-helpers';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { DEFAULT_SNAP_SETTINGS } from './snap-settings';
import { useDragMove } from './use-workspace-drag';
import { computeView } from './view-transform';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A large canvas keeps the 8 px snap reach to a few millimetres.
const CANVAS_SIZE_PX = 1000;
const VIEW_STATE = { zoomFactor: 1, panX: 0, panY: 0 };
const POINTER_ID = 3;

const mountedRoots: Root[] = [];

beforeEach(() => {
  resetStore();
  useUiStore.setState({
    draftShape: null,
    snapGuides: [],
    snapMarker: null,
    snapSettings: DEFAULT_SNAP_SETTINGS,
    spaceDown: false,
    toolMode: { kind: 'select' },
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
  useStore.getState().setProject(projectWithSquare());
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.innerHTML = '';
  window.localStorage.removeItem(SNAP_SETTINGS_KEY);
});

describe('snapping while drawing', () => {
  it('shows the node marker under a hovering draw tool, then lands the shape on it', async () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    const canvas = await renderHarness();

    // (80, 80) is the square's corner; (140, 150) a grid crossing.
    await pointer(canvas, 'pointermove', { x: 81, y: 79 });
    expect(useUiStore.getState().snapMarker).toEqual({ kind: 'node', pointMm: { x: 80, y: 80 } });

    await pointer(canvas, 'pointerdown', { x: 81, y: 79 });
    await pointer(canvas, 'pointermove', { x: 140.3, y: 150.7 });
    expect(useUiStore.getState().snapMarker).toEqual({
      kind: 'grid',
      pointMm: { x: 140, y: 150 },
    });
    await pointer(canvas, 'pointerup', { x: 140.3, y: 150.7 });

    const drawn = useStore.getState().project.scene.objects[1];
    expect(drawn).toBeDefined();
    const box = transformedBBox(drawn!);
    expect(box.minX).toBeCloseTo(80, 6);
    expect(box.minY).toBeCloseTo(80, 6);
    expect(box.maxX).toBeCloseTo(140, 6);
    expect(box.maxY).toBeCloseTo(150, 6);
    expect(useUiStore.getState().snapMarker).toBeNull();
  });

  it('places the shape freely while Alt is held', async () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    const canvas = await renderHarness();

    await pointer(canvas, 'pointerdown', { x: 81, y: 79 }, { altKey: true });
    await pointer(canvas, 'pointermove', { x: 140.3, y: 150.7 }, { altKey: true });
    expect(useUiStore.getState().snapMarker).toBeNull();
    await pointer(canvas, 'pointerup', { x: 140.3, y: 150.7 }, { altKey: true });

    const box = transformedBBox(useStore.getState().project.scene.objects[1]!);
    expect(box.minX).toBeCloseTo(81, 1);
    expect(box.minY).toBeCloseTo(79, 1);
    expect(box.maxX).toBeCloseTo(140.3, 1);
    expect(box.maxY).toBeCloseTo(150.7, 1);
  });

  it('does not snap at all with the snap toggle off', async () => {
    useUiStore.getState().setSnapSettings({ enabled: false });
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    const canvas = await renderHarness();

    await pointer(canvas, 'pointerdown', { x: 81, y: 79 });
    await pointer(canvas, 'pointermove', { x: 140.3, y: 150.7 });
    await pointer(canvas, 'pointerup', { x: 140.3, y: 150.7 });

    const box = transformedBBox(useStore.getState().project.scene.objects[1]!);
    expect(box.minX).toBeCloseTo(81, 1);
    expect(box.maxY).toBeCloseTo(150.7, 1);
  });
});

function DragHarness(): JSX.Element {
  const project = useStore((state) => state.project);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    ref.current = node;
    if (node !== null) installCanvasRect(node);
  }, []);
  const { handlers } = useDragMove(ref, project, false, VIEW_STATE);
  return (
    <canvas
      ref={setCanvasRef}
      width={CANVAS_SIZE_PX}
      height={CANVAS_SIZE_PX}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      aria-label="snap test canvas"
    />
  );
}

async function renderHarness(): Promise<HTMLCanvasElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  await act(async () => {
    root.render(<DragHarness />);
  });
  const canvas = host.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('snap harness canvas missing');
  return canvas;
}

// jsdom has no PointerEvent, so dispatch a MouseEvent of the pointer type.
async function pointer(
  canvas: HTMLCanvasElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  sceneMm: Vec2,
  modifiers: { readonly altKey?: boolean } = {},
): Promise<void> {
  const project = useStore.getState().project;
  const view = computeView(
    CANVAS_SIZE_PX,
    CANVAS_SIZE_PX,
    project.device.bedWidth,
    project.device.bedHeight,
    VIEW_STATE,
  );
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: view.offsetX + sceneMm.x * view.scale,
    clientY: view.offsetY + sceneMm.y * view.scale,
    altKey: modifiers.altKey ?? false,
  });
  Object.defineProperty(event, 'pointerId', { value: POINTER_ID });
  await act(async () => {
    canvas.dispatchEvent(event);
  });
}

function installCanvasRect(canvas: HTMLCanvasElement): void {
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: CANVAS_SIZE_PX,
      bottom: CANVAS_SIZE_PX,
      width: CANVAS_SIZE_PX,
      height: CANVAS_SIZE_PX,
      toJSON: () => ({}),
    }) as DOMRect;
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  canvas.hasPointerCapture = () => false;
}

// A 60 mm square with corners at (20, 20) and (80, 80).
function projectWithSquare(): Project {
  const square = createRectangle({
    id: 'square',
    color: '#000000',
    spec: { widthMm: 60, heightMm: 60, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
  });
  return {
    ...createProject(),
    scene: {
      objects: [square],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
}
