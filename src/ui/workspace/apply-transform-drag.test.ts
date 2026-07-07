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

  it('resizes a whole selection about the pinned corner via a combined-box handle (C5)', () => {
    const a = objectAt('a', 0, 0);
    const b = objectAt('b', 30, 0);
    const updates: Array<{ readonly id: string; readonly transform: Transform }> = [];

    // Combined box is 0..40; drag the SE handle to (80,20) doubles it about NW.
    applyTransformDrag({
      drag: { kind: 'selection-scale', handle: 'se', selectionIds: ['a', 'b'] },
      point: { x: 80, y: 20 },
      e: event,
      project: projectWithObjects([a, b]),
      selectionAnchor: 'c',
      snapSettings,
      setObjectTransform: (id, transform) => updates.push({ id, transform }),
      setSnapGuides: () => undefined,
    });

    const byId = new Map(updates.map((u) => [u.id, u.transform]));
    expect(byId.get('a')?.scaleX).toBeCloseTo(2);
    expect(byId.get('a')?.scaleY).toBeCloseTo(2);
    expect(byId.get('a')?.x).toBeCloseTo(0); // NW corner pinned
    expect(byId.get('a')?.y).toBeCloseTo(0);
    expect(byId.get('b')?.x).toBeCloseTo(60);
    expect(byId.get('b')?.scaleX).toBeCloseTo(2);
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
