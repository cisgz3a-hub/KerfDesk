import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { snapMoveTransform, type SnapSettings } from './snapping';

const BASE_SETTINGS: SnapSettings = {
  enabled: true,
  snapToGrid: false,
  snapToObjects: true,
  distanceMm: 2,
  gridMm: 10,
};

describe('snapMoveTransform', () => {
  it('snaps a moving object edge to a nearby object edge', () => {
    const moving = objectAt('moving', 0, 0);
    const target = objectAt('target', 30, 0);
    const proposed = transformAt(19.2, 0);

    const result = snapMoveTransform({
      project: projectWithObjects([moving, target]),
      movingObjectId: 'moving',
      proposedTransform: proposed,
      settings: BASE_SETTINGS,
    });

    expect(result.transform.x).toBeCloseTo(20);
    expect(result.transform.y).toBeCloseTo(0);
    expect(result.guides).toContainEqual({ axis: 'x', positionMm: 30, fromMm: 0, toMm: 10 });
  });

  it('snaps to the nearest grid line when grid snapping is enabled', () => {
    const moving = objectAt('moving', 0, 0);

    const result = snapMoveTransform({
      project: projectWithObjects([moving]),
      movingObjectId: 'moving',
      proposedTransform: transformAt(19.4, 4.2),
      settings: { ...BASE_SETTINGS, snapToGrid: true, snapToObjects: false },
    });

    expect(result.transform.x).toBeCloseTo(20);
    expect(result.transform.y).toBeCloseTo(5);
    expect(result.guides).toContainEqual({ axis: 'x', positionMm: 20, fromMm: 4.2, toMm: 14.2 });
    expect(result.guides).toContainEqual({ axis: 'y', positionMm: 10, fromMm: 19.4, toMm: 29.4 });
  });

  it('does not move the object when snapping is disabled or outside tolerance', () => {
    const moving = objectAt('moving', 0, 0);
    const target = objectAt('target', 30, 40);
    const proposed = transformAt(16.5, 0);
    const project = projectWithObjects([moving, target]);

    expect(
      snapMoveTransform({
        project,
        movingObjectId: 'moving',
        proposedTransform: proposed,
        settings: BASE_SETTINGS,
      }),
    ).toEqual({ transform: proposed, guides: [] });

    expect(
      snapMoveTransform({
        project,
        movingObjectId: 'moving',
        proposedTransform: transformAt(19.2, 0),
        settings: { ...BASE_SETTINGS, enabled: false },
      }),
    ).toEqual({ transform: transformAt(19.2, 0), guides: [] });
  });

  it('skips locked objects as snap targets', () => {
    const moving = objectAt('moving', 0, 0);
    const lockedTarget = { ...objectAt('locked', 30, 0), locked: true };

    const result = snapMoveTransform({
      project: projectWithObjects([moving, lockedTarget]),
      movingObjectId: 'moving',
      proposedTransform: transformAt(19.2, 0),
      settings: BASE_SETTINGS,
    });

    expect(result.transform.x).toBeCloseTo(19.2);
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
