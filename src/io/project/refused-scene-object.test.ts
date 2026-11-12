import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { nameRefusedSceneObject } from './refused-scene-object';

function withObject(object: SceneObject): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects: [object] } };
}

function artwork(x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.dxf',
    bounds: { minX: 0, minY: 0, maxX: Number.isFinite(x) ? Math.abs(x) : 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

const REASON = 'missing or invalid `scene.objects[0].paths`';

// Oracle audit O8-P3-4: a NaN vertex was refused with "has coordinates past
// the 1,000,000 mm a project file can hold", sending the operator looking for
// a far-away object.
describe('nameRefusedSceneObject', () => {
  it('says a NaN coordinate is not a number', () => {
    const reason = nameRefusedSceneObject(withObject(artwork(Number.NaN)), REASON);
    expect(reason).toContain('has a coordinate that is not a number');
    expect(reason).not.toContain('past the');
  });

  it('still says a far coordinate is past the limit', () => {
    const reason = nameRefusedSceneObject(withObject(artwork(2_000_000)), REASON);
    expect(reason).toContain('has coordinates past the 1,000,000 mm');
  });
});
