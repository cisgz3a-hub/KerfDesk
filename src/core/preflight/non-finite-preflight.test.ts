// GCO-01 — runPreflight / runCncPreflight must reject a non-finite motion
// coordinate (XNaN, Z-Infinity). Lives in its own file because preflight.test.ts
// is at the counted-line cap. See non-finite-coords.ts for the mechanism.
import { describe, expect, it } from 'vitest';
import { compileJob } from '../job';
import { grblStrategy } from '../output';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../scene';
import { runPreflight } from './preflight';

const outputObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function projectWithOutput(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [outputObject],
      layers: [createLayer({ id: 'L1', color: '#ff0000' })],
    },
  };
}

describe('runPreflight — non-finite coordinate guard (GCO-01)', () => {
  it('rejects a motion line whose coordinate is NaN instead of approving it', () => {
    // The bounds scanner cannot see a NaN coordinate: parseGcodeWord returns
    // null for XNaN exactly as it does for an absent X, so out-of-bed never
    // fires. Without the dedicated guard, this well-formed-looking job is
    // approved safe-to-write and faults GRBL mid-job.
    const gcodeWithNaN = ['G21', 'G90', 'M3 S0', 'G0 X1 Y1 S0', 'G1 XNaN Y9 F100 S50', 'M5'].join(
      '\n',
    );

    const result = runPreflight(projectWithOutput(), gcodeWithNaN);

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'non-finite-coordinate')).toBe(true);
  });

  it('leaves a well-formed job untouched (no false positive)', () => {
    const project = projectWithOutput();
    const gcode = grblStrategy.emit(compileJob(project.scene, project.device), project.device);
    const result = runPreflight(project, gcode);
    expect(result.issues.every((i) => i.code !== 'non-finite-coordinate')).toBe(true);
  });
});
