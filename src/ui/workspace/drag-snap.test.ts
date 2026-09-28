import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { transformDragWithSnap } from './drag-snap';
import type { DragState } from './drag-state';
import { square } from './snap/snap-scene.test-support';
import { DEFAULT_SNAP_SETTINGS } from './snapping';

const event = { shiftKey: false, ctrlKey: false, metaKey: false };
// The default 8 px reach is 2 mm at this zoom.
const PX_TO_MM = 0.25;

describe('transformDragWithSnap', () => {
  it('applies snap offsets to move drags after regular drag math', () => {
    const moving = objectAt('moving', 0, 0);
    const target = objectAt('target', 30, 0);

    const result = transformDragWithSnap({
      drag: moveDrag(),
      object: moving,
      point: { x: 19.2, y: 0 },
      event,
      project: projectWithObjects([moving, target]),
      snapSettings: { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false },
      pxToMm: PX_TO_MM,
    });

    expect(result.transform.x).toBeCloseTo(20);
    expect(result.guides).toContainEqual({ axis: 'x', positionMm: 30, fromMm: 0, toMm: 10 });
  });

  it('bypasses snapping while Ctrl/Cmd is held (audit C4)', () => {
    const moving = objectAt('moving', 0, 0);
    const target = objectAt('target', 30, 0);

    const result = transformDragWithSnap({
      drag: moveDrag(),
      object: moving,
      point: { x: 19.2, y: 0 },
      event: { shiftKey: false, ctrlKey: true, metaKey: false },
      project: projectWithObjects([moving, target]),
      snapSettings: { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false },
      pxToMm: PX_TO_MM,
    });

    // Without the bypass this would snap to x=20; with Ctrl it stays raw.
    expect(result.transform.x).toBeCloseTo(19.2);
    expect(result.guides).toEqual([]);
  });

  it('snaps the grabbed corner onto a corner of other artwork before box alignment', () => {
    const result = moveSquareTowardTarget(event);

    expect(result.transform.x).toBeCloseTo(20);
    expect(result.transform.y).toBeCloseTo(0);
    expect(result.marker).toEqual({ kind: 'node', pointMm: { x: 30, y: 0 } });
    expect(result.guides).toEqual([]);
  });

  it('bypasses all move snapping while Alt is held', () => {
    const result = moveSquareTowardTarget({ ...event, altKey: true });

    expect(result.transform.x).toBeCloseTo(19.7);
    expect(result.transform.y).toBeCloseTo(0.3);
    expect(result.marker).toBeNull();
    expect(result.guides).toEqual([]);
  });

  it('leaves a Shift-constrained move to box alignment, without point snapping', () => {
    const result = moveSquareTowardTarget({ ...event, shiftKey: true });

    expect(result.marker).toBeNull();
    expect(result.transform.x).toBeCloseTo(20);
    expect(result.guides.length).toBeGreaterThan(0);
  });

  it('does not snap scale or rotate drags', () => {
    const moving = objectAt('moving', 0, 0);

    const result = transformDragWithSnap({
      drag: { kind: 'scale', objectId: 'moving', handle: 'se' },
      object: moving,
      point: { x: 20, y: 20 },
      event,
      project: projectWithObjects([moving]),
      snapSettings: DEFAULT_SNAP_SETTINGS,
      pxToMm: PX_TO_MM,
    });

    expect(result.guides).toEqual([]);
  });
});

// Grab the moving 10 mm square beside its corner (10, 0) and carry that corner
// to (29.7, 0.3), next to the target square's corner (30, 0).
function moveSquareTowardTarget(
  modifiers: Parameters<typeof transformDragWithSnap>[0]['event'],
): ReturnType<typeof transformDragWithSnap> {
  const moving = square('moving', 0, 0);
  return transformDragWithSnap({
    drag: { ...moveDrag(), startScenePoint: { x: 9.5, y: 0.4 } },
    object: moving,
    point: { x: 29.2, y: 0.7 },
    event: modifiers,
    project: projectWithObjects([moving, square('target', 30, 0)]),
    snapSettings: { ...DEFAULT_SNAP_SETTINGS, snapToGrid: false },
    pxToMm: PX_TO_MM,
  });
}

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
    transform: transformAt(x, y),
    paths: [],
  };
}

function transformAt(x: number, y: number): Transform {
  return { ...IDENTITY_TRANSFORM, x, y };
}

function moveDrag(): Extract<DragState, { kind: 'move' }> {
  return {
    kind: 'move',
    objectId: 'moving',
    startScenePoint: { x: 0, y: 0 },
    startTx: 0,
    startTy: 0,
  };
}
