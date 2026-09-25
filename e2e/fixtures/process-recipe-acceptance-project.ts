import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type ImportedSvg,
  type Project,
} from '../../src/core/scene';

export const RECIPE_CUTTER: CncTool = {
  id: 'recipe-acceptance-cutter',
  name: 'Recipe 2.4 mm end mill',
  kind: 'end-mill',
  diameterMm: 2.4,
  fluteCount: 2,
};

const existingCutter: CncTool = {
  ...RECIPE_CUTTER,
  name: 'Destination 4.2 mm end mill',
  diameterMm: 4.2,
};

export function recipeAcceptanceSource(cnc: boolean): Project {
  const layers = [
    {
      ...createLayer({ id: 'engrave', name: 'Engrave', color: '#111111', mode: 'fill' }),
      power: 30,
      speed: 600,
      passes: 1,
      hatchSpacingMm: 0.3,
    },
    {
      ...createLayer({ id: 'score', name: 'Optional score', color: '#ff0000' }),
      power: 20,
      speed: 1200,
      passes: 3,
      output: false,
      visible: false,
    },
    {
      ...createLayer({ id: 'cut', name: 'Cut', color: '#0000ff' }),
      power: 60,
      speed: 900,
      passes: 2,
    },
  ].map((layer, index) => ({
    ...layer,
    ...(cnc
      ? {
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            toolId: RECIPE_CUTTER.id,
            cutType: index === 0 ? ('engrave' as const) : ('profile-on-path' as const),
            depthMm: index === 0 ? 0.5 : index === 1 ? 0.8 : 1.2,
            depthPerPassMm: 0.4,
            feedMmPerMin: index === 0 ? 500 : index === 1 ? 750 : 300,
            tabsEnabled: false,
          },
        }
      : {}),
  }));
  const source = artwork('source', 30, ['cut', 'engrave', 'score']);
  return {
    ...createProject(),
    ...(cnc
      ? {
          machine: {
            ...DEFAULT_CNC_MACHINE_CONFIG,
            tools: [RECIPE_CUTTER],
            toolId: RECIPE_CUTTER.id,
          },
        }
      : {}),
    scene: {
      layers,
      objects: [
        { ...source, powerScale: 50, operationOverride: { byOperation: { cut: { power: 80 } } } },
      ],
    },
  };
}

export function recipeAcceptanceTargets(cnc: boolean): Project {
  const operation = createLayer({
    id: 'old-operation',
    name: 'Destination settings',
    color: '#006600',
  });
  return {
    ...createProject(),
    notes: 'Destination stock, machine settings and geometry must survive recipe application.',
    ...(cnc
      ? {
          machine: {
            ...DEFAULT_CNC_MACHINE_CONFIG,
            stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 17 },
            tools: [existingCutter],
            toolId: existingCutter.id,
          },
        }
      : {}),
    scene: {
      layers: [operation],
      objects: [artwork('fresh-a', 25, [operation.id]), artwork('fresh-b', 65, [operation.id])],
    },
  };
}

function artwork(id: string, x: number, operationIds: readonly string[]): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds,
    transform: { ...IDENTITY_TRANSFORM, x, y: 30 },
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 15 },
    paths: [
      {
        color: '#111111',
        curves: [
          {
            start: { x: 0, y: 0 },
            closed: true,
            segments: [
              { kind: 'line', to: { x: 20, y: 0 } },
              { kind: 'line', to: { x: 20, y: 15 } },
              { kind: 'line', to: { x: 0, y: 15 } },
            ],
          },
        ],
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 15 },
              { x: 0, y: 15 },
            ],
          },
        ],
      },
    ],
  };
}
