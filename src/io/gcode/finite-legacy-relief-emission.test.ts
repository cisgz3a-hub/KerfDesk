import { expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { prepareProjectForPersistence } from '../project';
import { emitGcode } from './emit-gcode';

it('emits finite G-code for a persisted finite Z beyond Float32', () => {
  const project = finiteOverflowReliefProject();

  expect(prepareProjectForPersistence(project)).toMatchObject({ kind: 'ok' });
  const emitted = emitGcode(project);

  expect(emitted.gcode.length).toBeGreaterThan(0);
  expect(emitted.gcode).not.toMatch(/NaN|Infinity/);
  expect(emitted.preflight.issues).not.toContainEqual(
    expect.objectContaining({ code: 'relief-materialization-failed' }),
  );
});

function finiteOverflowReliefProject(): Project {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'finite-overflow-relief',
    source: 'finite-overflow.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: [0, 0, 0, 2, 0, Number.MAX_VALUE, 0, 1.5, 0],
      emptyCells: 'floor',
    },
    targetWidthMm: 20,
    reliefDepthMm: 3,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 15 },
    transform: IDENTITY_TRANSFORM,
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [relief],
      layers: [
        {
          ...createLayer({ id: 'finite-overflow-op', color: DEFAULT_RELIEF_LAYER_COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1 },
        },
      ],
    },
  };
}
