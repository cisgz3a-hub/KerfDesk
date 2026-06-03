import { describe, expect, it } from 'vitest';
import { buildToolpath } from '../../core/job';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildPreviewToolpath } from './draw-preview';

// Two cuts whose natural order (far-from-origin first) the optimizer reorders
// (near-origin first). Before P1-C the preview used raw compileJob, so it showed
// the un-optimized order while Save/Start burned the optimized order.
function twoCutProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          { points: [{ x: 90, y: 90 }, { x: 95, y: 95 }], closed: false },
          { points: [{ x: 1, y: 1 }, { x: 5, y: 5 }], closed: false },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: '#000000', color: '#000000' })),
  };
}

describe('preview / output parity (P1-C)', () => {
  it('builds the preview from the SAME prepared (optimized) job that emit uses', () => {
    const project = twoCutProject();
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      // If buildPreviewToolpath ever reverts to raw compileJob, the optimized
      // order would diverge from this prepared job and the deep-equal fails.
      expect(buildPreviewToolpath(project)).toEqual(buildToolpath(prepared.job));
    }
  });
});
