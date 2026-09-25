import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type RasterImage,
} from '../scene';
import { captureProcessRecipe } from './capture-process-recipe';
import type { ProcessRecipe } from './process-recipe';

export function recipeProject(cnc = false): Project {
  const layers = [
    {
      ...createLayer({ id: 'fill', name: 'Engrave', color: '#000000', mode: 'fill' }),
      power: 30,
      speed: 600,
      hatchSpacingMm: 1,
      ...(cnc
        ? {
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'engrave' as const,
              depthMm: 0.5,
              depthPerPassMm: 0.5,
              feedMmPerMin: 500,
              tabsEnabled: false,
            },
          }
        : {}),
    },
    {
      ...createLayer({ id: 'disabled', name: 'Optional score', color: '#ff0000' }),
      output: false,
      passes: 3,
    },
    {
      ...createLayer({ id: 'cut', name: 'Cut', color: '#0000ff' }),
      power: 60,
      speed: 900,
      passes: 2,
      ...(cnc
        ? {
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'profile-on-path' as const,
              depthMm: 1,
              depthPerPassMm: 0.5,
              feedMmPerMin: 300,
              tabsEnabled: false,
            },
          }
        : {}),
    },
  ];
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'source',
    source: 'square.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    operationIds: ['cut', 'fill', 'disabled'],
    powerScale: 50,
    operationOverride: { byOperation: { cut: { power: 80 } } },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    ...(cnc ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    scene: { layers, objects: [object] },
  };
}

export function capturedRecipe(project = recipeProject()): ProcessRecipe {
  const result = captureProcessRecipe(project, 'source', {
    id: 'process-1',
    name: 'Engrave then cut',
    description: 'Reusable sequence',
    revision: '1',
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.value;
}

export function imageRecipeProject(passThrough: boolean): Project {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'source',
    source: 'grey-ramp.png',
    dataUrl: 'data:image/png;base64,unused',
    lumaBase64: 'AECAwP8=',
    pixelWidth: 5,
    pixelHeight: 1,
    bounds: { minX: 10, minY: 10, maxX: 15, maxY: 11 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    dither: 'threshold',
    linesPerMm: 1,
    brightness: 5,
    contrast: 10,
    gamma: 1.2,
    operationIds: ['cut', 'fill', 'disabled'],
    powerScale: 50,
    operationOverride: { byOperation: { fill: { power: 60 } } },
  };
  const project = recipeProject();
  return {
    ...project,
    scene: {
      objects: [image],
      layers: project.scene.layers.map((layer) => ({
        ...layer,
        mode: 'image',
        minPower: 10,
        ditherAlgorithm: 'grayscale',
        linesPerMm: 2,
        passThrough,
        negativeImage: true,
        imageBidirectional: false,
        dotWidthCorrectionMm: 0.05,
      })),
    },
  };
}

export function freshRecipeProject(source = recipeProject()): Project {
  const original = source.scene.objects[0];
  if (original === undefined) throw new Error('fixture artwork missing');
  const { operationOverride: _override, ...object } = original;
  return {
    ...source,
    scene: {
      layers: [createLayer({ id: 'fresh-op', color: '#000000' })],
      objects: [{ ...object, id: 'fresh', operationIds: ['fresh-op'], powerScale: 100 }],
    },
  };
}
