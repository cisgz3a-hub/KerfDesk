import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';

const traced: SceneObject = {
  kind: 'traced-image',
  id: 'trace-1',
  source: 'logo.png',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
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
};

function projectWith(object: SceneObject, mode: 'line' | 'fill' | 'image'): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), mode }],
    },
  };
}

describe('detectJobIntentWarnings', () => {
  it('warns when output layers still use uncalibrated first-run power and speed defaults', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'line'))).toContain(
      'Layer L1 is still using uncalibrated defaults: 30% power, 1500 mm/min, 1 pass. Run a material test on scrap before burning final material.',
    );
  });

  it('warns when a traced image will run as vector Line output, not raster engraving', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'line'))).toContain(
      'Trace "logo.png" is vector Line output, not raster image engraving. It will run with M3 constant-power moves and can cut if power/speed are too aggressive.',
    );
  });

  it('warns when a traced image will run as vector Fill output, not raster engraving', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'fill'))).toContain(
      'Trace "logo.png" is vector Fill output, not raster image engraving. It will run with M3 constant-power moves and can cut if power/speed are too aggressive.',
    );
  });

  it('does not emit a vector-trace warning for image-mode layers', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'image'))).not.toContain(
      'Trace "logo.png" is vector Line output, not raster image engraving. It will run with M3 constant-power moves and can cut if power/speed are too aggressive.',
    );
  });

  it('does not warn about calibration after the operator changes the default layer recipe', () => {
    const project = {
      ...projectWith(traced, 'line'),
      scene: {
        ...projectWith(traced, 'line').scene,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      },
    };

    expect(detectJobIntentWarnings(project)).not.toContain(
      'Layer L1 is still using uncalibrated defaults: 30% power, 1500 mm/min, 1 pass. Run a material test on scrap before burning final material.',
    );
  });
});
