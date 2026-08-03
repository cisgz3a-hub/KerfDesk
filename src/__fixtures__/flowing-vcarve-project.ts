import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
} from '../core/scene';

export function flowingVCarveProject(stockThicknessMm = 0.5): Project {
  const color = '#7c3aed';
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'flowing-v-square',
    source: 'flowing-v-square.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 20 },
              { x: 10, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockThicknessMm },
    },
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'flowing-v-layer', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'v-carve',
            toolId: 'vb-60',
            vCarveFlatDepthEnabled: false,
            depthPerPassMm: 10,
          },
        },
      ],
    },
  };
}
