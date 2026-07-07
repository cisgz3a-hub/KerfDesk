import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { ROTATE_HANDLE_OFFSET_MM, rotateHandlePosition } from './rotate-handle';
import {
  computeMouseDownDrag,
  nextTransformForDrag,
  transformUpdatesForMoveDrag,
  type DragState,
} from './drag-state';

const SE_SCALE: Exclude<DragState, { kind: 'pan' | 'draw' | 'marquee' }> = {
  kind: 'scale',
  objectId: 'O1',
  handle: 'se',
};

const E_SCALE: Exclude<DragState, { kind: 'pan' | 'draw' | 'marquee' }> = {
  kind: 'scale',
  objectId: 'O1',
  handle: 'e',
};

function resizeEvent(args: {
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}): {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
} {
  return {
    shiftKey: args.shiftKey ?? false,
    altKey: false,
    ctrlKey: args.ctrlKey ?? false,
    metaKey: args.metaKey ?? false,
  };
}

function objectWithBounds(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'shape.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

describe('nextTransformForDrag move modifiers (audit C4)', () => {
  const moveDrag: Extract<DragState, { kind: 'move' }> = {
    kind: 'move',
    objectId: 'O1',
    startScenePoint: { x: 0, y: 0 },
    startTx: 0,
    startTy: 0,
  };

  it('moves freely without Shift', () => {
    const next = nextTransformForDrag(
      moveDrag,
      objectWithBounds(),
      { x: 100, y: 10 },
      resizeEvent({}),
    );
    expect(next.x).toBeCloseTo(100);
    expect(next.y).toBeCloseTo(10);
  });

  it('Shift locks a mostly-horizontal move to the X axis', () => {
    const next = nextTransformForDrag(
      moveDrag,
      objectWithBounds(),
      { x: 100, y: 10 },
      resizeEvent({ shiftKey: true }),
    );
    expect(next.y).toBeCloseTo(0);
    expect(next.x).toBeGreaterThan(99);
  });

  it('Shift locks a mostly-vertical move to the Y axis', () => {
    const next = nextTransformForDrag(
      moveDrag,
      objectWithBounds(),
      { x: 10, y: 100 },
      resizeEvent({ shiftKey: true }),
    );
    expect(next.x).toBeCloseTo(0);
    expect(next.y).toBeGreaterThan(99);
  });
});

describe('nextTransformForDrag scale modifiers', () => {
  it('keeps aspect ratio by default when a corner handle is dragged', () => {
    const next = nextTransformForDrag(
      SE_SCALE,
      objectWithBounds(),
      { x: 30, y: 30 },
      resizeEvent({}),
    );

    expect(next.scaleX).toBeCloseTo(1.5);
    expect(next.scaleY).toBeCloseTo(1.5);
  });

  it('lets Shift override aspect ratio on a corner resize', () => {
    const next = nextTransformForDrag(
      SE_SCALE,
      objectWithBounds(),
      { x: 30, y: 30 },
      resizeEvent({ shiftKey: true }),
    );

    expect(next.scaleX).toBeCloseTo(3);
    expect(next.scaleY).toBeCloseTo(1.5);
  });

  it('uses Ctrl/Cmd to resize symmetrically from the object center', () => {
    const object = objectWithBounds();
    const next: Transform = nextTransformForDrag(
      SE_SCALE,
      object,
      { x: 20, y: 40 },
      resizeEvent({ ctrlKey: true }),
    );
    const before = transformedBBox(object);
    const after = transformedBBox({ ...object, transform: next });

    expect(centerOf(after)).toEqual(centerOf(before));
    expect(next.scaleX).toBeCloseTo(3);
    expect(next.scaleY).toBeCloseTo(3);
  });

  it('stretches only width from an east side handle and keeps the opposite edge pinned', () => {
    const object = objectWithBounds();
    const before = transformedBBox(object);
    const next = nextTransformForDrag(E_SCALE, object, { x: 30, y: 999 }, resizeEvent({}));
    const after = transformedBBox({ ...object, transform: next });

    expect(after.minX).toBeCloseTo(before.minX);
    expect(after.minY).toBeCloseTo(before.minY);
    expect(after.maxY).toBeCloseTo(before.maxY);
    expect(after.maxX).toBeCloseTo(30);
  });

  it('uses the selected anchor as the resize pivot when it is valid for the dragged handle', () => {
    const object = objectWithBounds();
    const before = transformedBBox(object);
    const next = nextTransformForDrag(SE_SCALE, object, { x: 20, y: 40 }, resizeEvent({}), 'c');
    const after = transformedBBox({ ...object, transform: next });

    expect(centerOf(after)).toEqual(centerOf(before));
    expect(next.scaleX).toBeCloseTo(3);
    expect(next.scaleY).toBeCloseTo(3);
  });
});

describe('computeMouseDownDrag multi-selection', () => {
  it('keeps the current multi-selection when dragging an already selected object', () => {
    const plainClick = vi.fn();
    const shiftClick = vi.fn();
    const drag = computeMouseDownDrag({
      e: mouseEventAtScenePoint({ x: 25, y: 5 }),
      ref: canvasRef(),
      project: projectWithObjects([objectAt('A', 0, 0), objectAt('B', 20, 0)]),
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      viewState: VIEW_STATE,
      onShiftClick: shiftClick,
      onPlainClick: plainClick,
    });

    expect(plainClick).not.toHaveBeenCalled();
    expect(shiftClick).not.toHaveBeenCalled();
    expect(drag).toMatchObject({ kind: 'move', objectId: 'B' });
    expect(moveDragSelectionStarts(drag)).toEqual([
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: 20, y: 0 },
    ]);
  });

  it('starts a shared rotate drag from the multi-selection rotate handle', () => {
    const plainClick = vi.fn();
    const shiftClick = vi.fn();
    const drag = computeMouseDownDrag({
      e: mouseEventAtScenePoint({ x: 20, y: -ROTATE_HANDLE_OFFSET_MM }),
      ref: canvasRef(),
      project: projectWithObjects([objectAt('A', 0, 0), objectAt('B', 30, 0)]),
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      viewState: VIEW_STATE,
      onShiftClick: shiftClick,
      onPlainClick: plainClick,
    });

    expect(plainClick).not.toHaveBeenCalled();
    expect(shiftClick).not.toHaveBeenCalled();
    expect(drag).toMatchObject({
      kind: 'rotate',
      objectId: 'A',
      rotateAnchor: { x: 20, y: 5 },
      startPointerAngleDeg: -90,
    });
    expect(rotateDragSelectionStarts(drag)).toEqual([
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: 30, y: 0 },
    ]);
  });

  it('rotate drag on a pre-rotated single object does not jump (audit C2)', () => {
    const rotated: SceneObject = {
      kind: 'imported-svg',
      id: 'R',
      source: 'r.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, x: 40, y: 40, rotationDeg: 30 },
      paths: [],
    };
    const handle = rotateHandlePosition(rotated);
    const drag = computeMouseDownDrag({
      e: mouseEventAtScenePoint(handle),
      ref: canvasRef(),
      project: projectWithObjects([rotated]),
      selectedObjectId: 'R',
      additionalSelectedIds: new Set(),
      viewState: VIEW_STATE,
      onShiftClick: vi.fn(),
      onPlainClick: vi.fn(),
      selectionAnchor: 'c',
    });
    expect(drag?.kind).toBe('rotate');
    // Applying with dragTo == the grab point must keep rotation at 30°, not
    // snap it toward the pointer direction (~0°, the old absolute bug).
    const next = nextTransformForDrag(
      drag as Extract<DragState, { kind: 'rotate' }>,
      rotated,
      handle,
      { shiftKey: false, ctrlKey: false, metaKey: false },
      'c',
    );
    expect(next.rotationDeg).toBeCloseTo(30, 3);
  });

  it('starts a selection-scale drag from a combined-box corner handle (C5)', () => {
    // Combined box of A(0..10) + B(20..30) is 0..30; its SE corner is (30,10).
    const drag = computeMouseDownDrag({
      e: mouseEventAtScenePoint({ x: 30, y: 10 }),
      ref: canvasRef(),
      project: projectWithObjects([objectAt('A', 0, 0), objectAt('B', 20, 0)]),
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      viewState: VIEW_STATE,
      onShiftClick: vi.fn(),
      onPlainClick: vi.fn(),
    });

    expect(drag).toMatchObject({ kind: 'selection-scale', handle: 'se', selectionIds: ['A', 'B'] });
  });

  it('applies the dragged-object delta to every selected move start transform', () => {
    const drag: Extract<DragState, { kind: 'move' }> = {
      kind: 'move',
      objectId: 'B',
      startScenePoint: { x: 0, y: 0 },
      startTx: 20,
      startTy: 10,
      selectionStartTransforms: [
        { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 0, y: 5, scaleX: 2 } },
        { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 20, y: 10 } },
      ],
    };

    expect(transformUpdatesForMoveDrag(drag, { ...IDENTITY_TRANSFORM, x: 25, y: 12 })).toEqual([
      { id: 'A', transform: { ...IDENTITY_TRANSFORM, x: 5, y: 7, scaleX: 2 } },
      { id: 'B', transform: { ...IDENTITY_TRANSFORM, x: 25, y: 12 } },
    ]);
  });
});

function centerOf(bbox: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): { readonly x: number; readonly y: number } {
  return {
    x: (bbox.minX + bbox.maxX) / 2,
    y: (bbox.minY + bbox.maxY) / 2,
  };
}

const VIEW_STATE = { zoomFactor: 1, panX: 0, panY: 0 };
const CANVAS_SIZE = 448;
const CANVAS_RECT = {
  left: 0,
  top: 0,
  width: CANVAS_SIZE,
  height: CANVAS_SIZE,
};

function projectWithObjects(objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects } };
}

function objectAt(id: string, x: number, y: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [],
  };
}

function canvasRef(): React.RefObject<HTMLCanvasElement> {
  return {
    current: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      getBoundingClientRect: () => CANVAS_RECT,
    } as HTMLCanvasElement,
  };
}

function mouseEventAtScenePoint(point: {
  readonly x: number;
  readonly y: number;
}): React.MouseEvent<HTMLCanvasElement> {
  return {
    button: 0,
    clientX: 24 + point.x,
    clientY: 24 + point.y,
    shiftKey: false,
  } as React.MouseEvent<HTMLCanvasElement>;
}

function moveDragSelectionStarts(
  drag: DragState | null,
): ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> {
  if (drag?.kind !== 'move') return [];
  return (drag.selectionStartTransforms ?? []).map((entry) => ({
    id: entry.id,
    x: entry.transform.x,
    y: entry.transform.y,
  }));
}

function rotateDragSelectionStarts(
  drag: DragState | null,
): ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> {
  if (drag?.kind !== 'rotate') return [];
  return (drag.selectionStartTransforms ?? []).map((entry) => ({
    id: entry.id,
    x: entry.transform.x,
    y: entry.transform.y,
  }));
}
