import { describe, expect, it } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayerSubLayer,
  createLayer,
  createProject,
  type ImportedSvg,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { classifyCanvasPreparation } from './canvas-preparation-policy';

const COLOR = '#ff0000';

describe('canvas preparation classification', () => {
  it('keeps low-cost laser scanline and CNC profile work direct', () => {
    expect(classifyCanvasPreparation(vectorProject('laser', 'line'))).toBe('direct');
    expect(classifyCanvasPreparation(vectorProject('cnc', 'profile-on-path'))).toBe('direct');
  });

  it.each(['pocket', 'v-carve', 'inlay-pair'] as const)(
    'routes the amplifying CNC %s operation to the background worker',
    (cutType) => {
      expect(classifyCanvasPreparation(vectorProject('cnc', cutType))).toBe('background-worker');
    },
  );

  it.each(['offset', 'island'] as const)(
    'routes %s fill geometry to the background worker',
    (fillStyle) => {
      const project = vectorProject('laser', 'fill');
      expect(
        classifyCanvasPreparation({
          ...project,
          scene: {
            ...project.scene,
            layers: project.scene.layers.map((layer) => ({ ...layer, fillStyle })),
          },
        }),
      ).toBe('background-worker');
    },
  );

  it('classifies enabled sublayer amplification but ignores disabled and scanline sublayers', () => {
    const project = vectorProject('laser', 'line');
    expect(classifyCanvasPreparation(withFillSubLayer(project, 'offset', true))).toBe(
      'background-worker',
    );
    expect(classifyCanvasPreparation(withFillSubLayer(project, 'island', false))).toBe('direct');
    expect(classifyCanvasPreparation(withFillSubLayer(project, 'scanline', true))).toBe('direct');
  });

  it('routes relief and pass-amplified profiles while preserving scoped cheap work', () => {
    expect(classifyCanvasPreparation(reliefProject())).toBe('background-worker');
    const amplified = vectorProject('cnc', 'profile-on-path');
    expect(
      classifyCanvasPreparation({
        ...amplified,
        scene: {
          ...amplified.scene,
          layers: amplified.scene.layers.map((layer) => ({
            ...layer,
            cnc: {
              ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
              depthMm: 50_000,
              depthPerPassMm: 1,
            },
          })),
        },
      }),
    ).toBe('background-worker');
  });

  it('routes the representative eight-drawing, six-operation viewer project off-thread', () => {
    const project = mixedCanvasCompilationProject();
    expect(project.scene.objects).toHaveLength(8);
    expect(project.scene.layers).toHaveLength(6);
    expect(classifyCanvasPreparation(project)).toBe('background-worker');
  });
});

function vectorProject(
  machine: 'laser' | 'cnc',
  operation: 'line' | 'fill' | 'profile-on-path' | 'pocket' | 'v-carve' | 'inlay-pair',
): Project {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'vector',
    source: 'classifier-fixture',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  const layer = createLayer({ id: 'operation', color: COLOR });
  const isCnc = machine === 'cnc';
  return {
    ...createProject(),
    ...(isCnc ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    scene: {
      objects: [object],
      layers: [
        {
          ...layer,
          mode: isCnc ? 'line' : (operation as 'line' | 'fill'),
          ...(isCnc
            ? {
                cnc: {
                  ...DEFAULT_CNC_LAYER_SETTINGS,
                  cutType: operation as Exclude<typeof operation, 'line' | 'fill'>,
                },
              }
            : {}),
        },
      ],
    },
  };
}

function reliefProject(): Project {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'relief',
    source: 'relief.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 1],
    targetWidthMm: 10,
    reliefDepthMm: 2,
    emptyCells: 'top',
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [relief],
      layers: [{ ...createLayer({ id: 'relief-layer', color: COLOR }), output: true }],
    },
  };
}

function withFillSubLayer(
  project: Project,
  fillStyle: 'scanline' | 'offset' | 'island',
  enabled: boolean,
): Project {
  const layer = project.scene.layers[0];
  if (layer === undefined) throw new Error('fixture operation is missing');
  const settings = { ...layer, mode: 'fill' as const, fillStyle };
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: [
        {
          ...layer,
          subLayers: [
            createLayerSubLayer(settings, {
              id: `fill-${fillStyle}`,
              label: `Fill ${fillStyle}`,
              enabled,
            }),
          ],
        },
      ],
    },
  };
}
