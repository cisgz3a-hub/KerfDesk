import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { applyTransformDrag } from './apply-transform-drag';
import type { DragState } from './drag-state';
import type { SnapGuide } from './snapping';

const event = { shiftKey: false, ctrlKey: false, metaKey: false };
const snapSettings = {
  enabled: true,
  snapToGrid: false,
  snapToObjects: true,
  distanceMm: 2,
  gridMm: 10,
};

describe('applyTransformDrag', () => {
  it('does not snap a multi-selected move to another selected object stale position', () => {
    const first = objectAt('first', 0, 0);
    const second = objectAt('second', 30, 0);
    const updates: Array<{ readonly id: string; readonly transform: Transform }> = [];
    let guides: ReadonlyArray<SnapGuide> = [];

    applyTransformDrag({
      drag: multiMoveDrag(),
      point: { x: -19.2, y: 0 },
      e: event,
      project: projectWithObjects([first, second]),
      selectionAnchor: 'c',
      snapSettings,
      setObjectTransform: (id, transform) => updates.push({ id, transform }),
      setSnapGuides: (next) => {
        guides = next;
      },
    });

    expect(updates).toEqual([
      { id: 'first', transform: transformAt(-19.2, 0) },
      { id: 'second', transform: transformAt(10.8, 0) },
    ]);
    expect(guides).toEqual([]);
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

function multiMoveDrag(): Extract<DragState, { kind: 'move' }> {
  return {
    kind: 'move',
    objectId: 'second',
    startScenePoint: { x: 0, y: 0 },
    startTx: 30,
    startTy: 0,
    selectionStartTransforms: [
      { id: 'first', transform: transformAt(0, 0) },
      { id: 'second', transform: transformAt(30, 0) },
    ],
  };
}
