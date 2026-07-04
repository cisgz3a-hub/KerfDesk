import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { ROTATE_HANDLE_OFFSET_MM } from './rotate-handle';
import {
  computeMouseDownDrag,
  isRightButtonDoubleClick,
  isStationaryRightPanClick,
  nextTransformForDrag,
  panOffsetForDrag,
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

describe('panOffsetForDrag', () => {
  it('falls back to the drag start when the canvas CSS scale is not usable', () => {
    const drag: Extract<DragState, { kind: 'pan' }> = {
      kind: 'pan',
      trigger: 'space-left-button',
      startClientX: 20,
      startClientY: 30,
      startPanX: 4,
      startPanY: -2,
    };

    expect(
      panOffsetForDrag({
        drag,
        e: { clientX: 120, clientY: 130 },
        canvas: fakePanCanvas({ width: 100, height: 100, rectWidth: 0 }),
        project: createProject(),
        viewState: { zoomFactor: 1, panX: 0, panY: 0 },
      }),
    ).toEqual({ panX: 4, panY: -2 });
  });
});

describe('isStationaryRightPanClick', () => {
  it('treats a stationary right-button pan candidate as a context click', () => {
    const drag = panDrag('right-button');

    expect(isStationaryRightPanClick(drag, { clientX: 104, clientY: 100 })).toBe(true);
  });

  it('keeps right-button drags as panning after the movement threshold', () => {
    const drag = panDrag('right-button');

    expect(isStationaryRightPanClick(drag, { clientX: 105, clientY: 100 })).toBe(false);
  });

  it('never opens the context bar for middle-button or Space panning', () => {
    expect(
      isStationaryRightPanClick(panDrag('middle-button'), { clientX: 100, clientY: 100 }),
    ).toBe(false);
    expect(
      isStationaryRightPanClick(panDrag('space-left-button'), { clientX: 100, clientY: 100 }),
    ).toBe(false);
  });
});

describe('isRightButtonDoubleClick', () => {
  it('recognizes the second click of a right-button double-click', () => {
    expect(isRightButtonDoubleClick({ button: 2, detail: 2 })).toBe(true);
  });

  it('ignores single right-clicks and non-right double-clicks', () => {
    expect(isRightButtonDoubleClick({ button: 2, detail: 1 })).toBe(false);
    expect(isRightButtonDoubleClick({ button: 0, detail: 2 })).toBe(false);
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

function fakePanCanvas(args: {
  readonly width: number;
  readonly height: number;
  readonly rectWidth: number;
}): HTMLCanvasElement {
  return {
    width: args.width,
    height: args.height,
    getBoundingClientRect: () =>
      ({
        left: 0,
        top: 0,
        width: args.rectWidth,
        height: args.height,
      }) as DOMRect,
  } as HTMLCanvasElement;
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

function panDrag(
  trigger: 'middle-button' | 'right-button' | 'space-left-button',
): Extract<DragState, { kind: 'pan' }> {
  return {
    kind: 'pan',
    trigger,
    startClientX: 100,
    startClientY: 100,
    startPanX: 0,
    startPanY: 0,
  };
}
