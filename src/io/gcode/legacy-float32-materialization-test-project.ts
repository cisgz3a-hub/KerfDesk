import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';

/** Build a persistable legacy relief whose finite stored Z overflows Float32 during CAM. */
export function legacyFloat32OverflowProject(): Project {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'overflow-z-relief',
    source: 'overflow-z.stl',
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
      layers: [createLayer({ id: 'overflow-relief-op', color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
}
