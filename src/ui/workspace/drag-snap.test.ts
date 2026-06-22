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
import { DEFAULT_SNAP_SETTINGS } from './snapping';

const event = { shiftKey: false, ctrlKey: false, metaKey: false };

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
    });

    expect(result.transform.x).toBeCloseTo(20);
    expect(result.guides).toContainEqual({ axis: 'x', positionMm: 30, fromMm: 0, toMm: 10 });
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
    });

    expect(result.guides).toEqual([]);
  });
});

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
