import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  curveNodePoint,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useNodeEditStore } from './node-edit-store';
import { clearNodeEditPointer, nodeEditPointerHandlers } from './node-edit-pointer';
import { computeView } from './view-transform';
import { handleCanvasDoubleClick } from './workspace-text-interaction';

const VIEW = { zoomFactor: 2, panX: 0, panY: 0 };

beforeEach(() => {
  resetStore();
  useUiStore.setState({ toolMode: { kind: 'node' }, modalDepth: 0, spaceDown: false });
  useNodeEditStore.setState({ pointer: null, selectedSegment: null, feedback: null });
});

describe('node tool pointer tracking', () => {
  it('follows the pointer over the canvas in the node tool only', () => {
    const project = load();
    const canvas = canvasFor();
    const inner = { ...noHandlers(), onPointerMove: vi.fn() };
    const handlers = nodeEditPointerHandlers(inner, {
      canvasRef: { current: canvas },
      project,
      previewMode: false,
      viewState: VIEW,
    });

    handlers.onPointerMove(eventAt(project, canvas, { x: 4, y: 0.2 }));
    expect(inner.onPointerMove).toHaveBeenCalledTimes(1);
    const pointer = useNodeEditStore.getState().pointer;
    expect(pointer?.scenePoint.x).toBeCloseTo(4, 6);
    expect(pointer?.pxToMm).toBeGreaterThan(0);

    useUiStore.setState({ toolMode: { kind: 'select' } });
    handlers.onPointerMove(eventAt(project, canvas, { x: 5, y: 0 }));
    expect(useNodeEditStore.getState().pointer).toBeNull();
  });

  it('forgets the pointer when it leaves the canvas', () => {
    useNodeEditStore.getState().setPointer({ scenePoint: { x: 1, y: 1 }, pxToMm: 0.1 });
    clearNodeEditPointer();
    expect(useNodeEditStore.getState().pointer).toBeNull();
  });
});

describe('node tool double-click', () => {
  it('adds a node where a segment of the edited artwork is double-clicked', () => {
    const before = load();
    const canvas = canvasFor();

    handleCanvasDoubleClick(eventAt(before, canvas, { x: 4, y: 0.1 }));

    const object = useStore.getState().project.scene.objects[0] as ImportedSvg;
    const curve = object.paths[0]?.curves?.[0];
    const added = curve === undefined ? null : curveNodePoint(curve, 1);
    expect(added?.x).toBeCloseTo(4, 9);
    expect(added?.y).toBe(0);
    expect(curve?.segments).toHaveLength(2);
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('does nothing away from the artwork', () => {
    const before = load();
    handleCanvasDoubleClick(eventAt(before, canvasFor(), { x: 40, y: 40 }));
    expect(useStore.getState().project).toBe(before);
  });
});

function load(): Project {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [art],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
  useStore.setState({ project, selectedObjectId: 'art' });
  useUiStore.setState(VIEW);
  return project;
}

function canvasFor(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 800;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 }) as DOMRect;
  return canvas;
}

function eventAt(
  project: Project,
  canvas: HTMLCanvasElement,
  point: Vec2,
): React.PointerEvent<HTMLCanvasElement> {
  const view = computeView(1000, 800, project.device.bedWidth, project.device.bedHeight, VIEW);
  return {
    button: 0,
    clientX: view.offsetX + point.x * view.scale,
    clientY: view.offsetY + point.y * view.scale,
    currentTarget: canvas,
    defaultPrevented: false,
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

function noHandlers() {
  return {
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onLostPointerCapture: vi.fn(),
  };
}
