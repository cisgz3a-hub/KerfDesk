// The rotate handle must spin artwork in place. Regression cover for the
// pivot-source bug: the handle used to rotate about the numeric bar's shared
// 9-dot anchor, which DEFAULTS to 'nw' (ui-store.ts), so a default rotate swung
// the object around its top-left bbox corner instead of its centre. Every other
// rotate test passes selectionAnchor:'c' explicitly, which hid it — these cases
// deliberately drive the real-world default.

import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { rotateHandlePosition } from './rotate-handle';
import { computeMouseDownDrag, nextTransformForDrag, type DragState } from './drag-state';

const VIEW_STATE = { zoomFactor: 1, panX: 0, panY: 0 };
const CANVAS_SIZE = 448;

function canvasRef(): React.RefObject<HTMLCanvasElement> {
  return {
    current: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }),
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
    altKey: false,
  } as React.MouseEvent<HTMLCanvasElement>;
}

function projectWithObjects(objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects } };
}

function objectAt(x: number, y: number, rotationDeg = 0): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'R',
    source: 'r.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y, rotationDeg },
    paths: [],
  };
}

function rotateDragFor(object: SceneObject, anchor: 'nw' | 'c' | 'se'): DragState | null {
  return computeMouseDownDrag({
    e: mouseEventAtScenePoint(rotateHandlePosition(object)),
    ref: canvasRef(),
    project: projectWithObjects([object]),
    selectedObjectId: 'R',
    additionalSelectedIds: new Set(),
    viewState: VIEW_STATE,
    onShiftClick: vi.fn(),
    onPlainClick: vi.fn(),
    selectionAnchor: anchor,
  });
}

function centerOf(object: SceneObject): { readonly x: number; readonly y: number } {
  const b = transformedBBox(object);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

describe('rotate handle pivot', () => {
  it('pivots at the bbox centre even when the 9-dot anchor is nw', () => {
    const object = objectAt(40, 40);
    // Centre of the 40..50 box is (45,45); the top-left corner is (40,40).
    expect(rotateDragFor(object, 'nw')).toMatchObject({
      kind: 'rotate',
      rotateAnchor: { x: 45, y: 45 },
    });
  });

  it('keeps the visual centre pinned through a quarter turn under a nw anchor', () => {
    const object = objectAt(40, 40);
    const drag = rotateDragFor(object, 'nw');
    const before = centerOf(object);
    const next = nextTransformForDrag(
      drag as Extract<DragState, { kind: 'rotate' }>,
      object,
      { x: 45 + 30, y: 45 },
      { shiftKey: false, ctrlKey: false, metaKey: false },
      'nw',
    );
    const after = centerOf({ ...object, transform: next });
    expect(next.rotationDeg).toBeCloseTo(90, 3);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('ignores every anchor choice — the handle is always centre-pivoted', () => {
    const object = objectAt(40, 40);
    for (const anchor of ['nw', 'c', 'se'] as const) {
      expect(rotateDragFor(object, anchor)).toMatchObject({
        rotateAnchor: { x: 45, y: 45 },
      });
    }
  });

  it('still does not jump when re-grabbing a pre-rotated object (audit C2)', () => {
    const object = objectAt(40, 40, 30);
    const handle = rotateHandlePosition(object);
    const drag = rotateDragFor(object, 'nw');
    const next = nextTransformForDrag(
      drag as Extract<DragState, { kind: 'rotate' }>,
      object,
      handle,
      { shiftKey: false, ctrlKey: false, metaKey: false },
      'nw',
    );
    expect(next.rotationDeg).toBeCloseTo(30, 3);
  });
});
