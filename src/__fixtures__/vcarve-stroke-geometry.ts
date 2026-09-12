import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../core/scene';

/** Finite, persisted pen metadata whose inverse cannot represent the source coordinates. */
export function unrepresentableStrokeObject(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'extreme-pen',
    source: 'stroke.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 1, minY: 1, maxX: 2, maxY: 2 },
    paths: [
      {
        color: '#000000',
        strokeWidthMm: 0.5,
        strokeTransform: { a: 1e-308, b: 0, c: 0, d: 1 },
        polylines: [
          {
            closed: true,
            points: [
              { x: 1, y: 1 },
              { x: 2, y: 1 },
              { x: 2, y: 2 },
              { x: 1, y: 2 },
            ],
          },
        ],
      },
    ],
  };
}

export function unrepresentableStrokeProject(): Project {
  const tool = { id: 'v90', name: 'V90', kind: 'v-bit' as const, diameterMm: 6, tipAngleDeg: 90 };
  return {
    ...createProject(),
    machine: { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id },
    scene: {
      objects: [unrepresentableStrokeObject()],
      layers: [
        {
          ...createLayer({ id: 'carve', color: '#000000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve', toolId: tool.id },
        },
      ],
    },
  };
}
