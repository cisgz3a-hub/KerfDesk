import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';

const DEFAULT_WARNING =
  'Layer L1 is still using uncalibrated defaults: 30% power, 1500 mm/min, 1 pass. Run a material test on scrap before burning final material.';

function artwork(id: string, power?: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
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
    ...(power === undefined ? {} : { operationOverride: { power } }),
  };
}

function projectWith(objects: ReadonlyArray<SceneObject>): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      objects,
      layers: [createLayer({ id: 'L1', color: '#000000' })],
    },
  };
}

describe('job-intent warnings for artwork overrides', () => {
  it('does not report the layer default when every emitted group overrides it', () => {
    expect(detectJobIntentWarnings(projectWith([artwork('selected', 5)]))).not.toContain(
      DEFAULT_WARNING,
    );
  });

  it('still warns when another emitted group uses the uncalibrated defaults', () => {
    expect(
      detectJobIntentWarnings(projectWith([artwork('selected', 5), artwork('default')])),
    ).toContain(DEFAULT_WARNING);
  });
});
