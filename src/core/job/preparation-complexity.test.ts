import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type Scene,
  type SceneObject,
} from '../scene';
import {
  countEstimatedFillSegments,
  countOutputVectorSegments,
  estimateFillPreparation,
  outputVectorPreparationTooComplex,
  scenePreparationSize,
  scenePreparationTooComplex,
} from './preparation-complexity';

it('routes the combined primary and independent CNC stage depth work without changing the scene', () => {
  const contours = [{ closed: true, points: [...square().points, { x: 0, y: 0 }] }];
  const settings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'profile-outside' as const,
    depthMm: 10,
    depthPerPassMm: 0.5,
    finishAllowanceMm: 0.2,
  };
  const project = {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: fillScene({ contours, layer: { mode: 'line', cnc: settings } }),
  };
  expect(outputVectorPreparationTooComplex(project, 450)).toBe(false);
  const withFinish = {
    ...project,
    scene: fillScene({
      contours,
      layer: {
        mode: 'line',
        cnc: {
          ...settings,
          stageRecipes: {
            'profile-finish': {
              toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
              feedMmPerMin: 321,
              plungeMmPerMin: 123,
              spindleRpm: 9000,
              depthPerPassMm: 0.1,
            },
          },
        },
      },
    }),
  };
  const before = JSON.stringify(withFinish);
  // 4 edges * (20 primary + 100 finishing) crosses 450; neither stage does alone.
  expect(outputVectorPreparationTooComplex(withFinish, 450)).toBe(true);
  expect(JSON.stringify(withFinish)).toBe(before);
});

describe('fill preparation estimate', () => {
  it('estimates native curved paths even when no legacy display polyline is present', () => {
    const scene = fillScene({ contours: [] });
    const object = scene.objects[0];
    if (object?.kind !== 'shape') throw new Error('shape fixture missing');
    const native = {
      ...scene,
      objects: [
        {
          ...object,
          paths: [
            {
              color: '#000000',
              polylines: [],
              curves: [
                {
                  start: { x: 0, y: 0 },
                  closed: true,
                  segments: [
                    { kind: 'line' as const, to: { x: 10, y: 0 } },
                    { kind: 'line' as const, to: { x: 10, y: 10 } },
                    { kind: 'line' as const, to: { x: 0, y: 10 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(estimateFillPreparation(native)).toEqual(
      estimateFillPreparation(fillScene({ contours: [square()] })),
    );
    expect(countEstimatedFillSegments(native)).toBeGreaterThan(0);
  });

  it('bounds dense contour classification without claiming an invented hatch count', () => {
    const points = Array.from({ length: 90_000 }, (_, index) => {
      const angle = (index / 90_000) * Math.PI * 2;
      return { x: 200 + 200 * Math.cos(angle), y: 200 + 200 * Math.sin(angle) };
    });
    const scene = fillScene({
      contours: [{ closed: true, points }],
      layer: { hatchSpacingMm: 0.05 },
    });

    expect(estimateFillPreparation(scene)).toEqual({ kind: 'work-budget-exceeded' });
    expect(countEstimatedFillSegments(scene)).toBe(Number.POSITIVE_INFINITY);
    // An exhausted estimate is unknown, never 'too large' (ADR-459 Amd 1).
    expect(scenePreparationSize(scene)).toBe('unknown');
    expect(scenePreparationTooComplex(scene)).toBe(false);
    expect(
      scene.objects[0]?.kind === 'shape' && scene.objects[0].paths[0]?.polylines[0]?.points,
    ).toBe(points);
  });

  it('shares its work bound across many coincident paths that produce no spans', () => {
    const scene = fillScene({ contours: [square(), square()], layer: { hatchSpacingMm: 0.05 } });
    const object = scene.objects[0];
    if (object?.kind !== 'shape') throw new Error('shape fixture missing');
    const path = object.paths[0];
    if (path === undefined) throw new Error('path fixture missing');
    expect(
      estimateFillPreparation({
        ...scene,
        objects: [{ ...object, paths: Array.from({ length: 1_000 }, () => path) }],
      }),
    ).toEqual({ kind: 'work-budget-exceeded' });
  });

  it('distinguishes invalid input from an expensive valid estimate', () => {
    const contour = square();
    expect(
      estimateFillPreparation(
        fillScene({
          contours: [{ ...contour, points: [...contour.points, { x: Number.NaN, y: 5 }] }],
        }),
      ),
    ).toEqual({ kind: 'invalid-input' });
  });

  it('combines contours so coincident even-odd contours do not create phantom hatch rows', () => {
    expect(countEstimatedFillSegments(fillScene({ contours: [square(), square()] }))).toBe(0);
  });

  it('measures both hatch directions when cross-hatch is enabled', () => {
    const single = countEstimatedFillSegments(fillScene({ contours: [square()] }));
    const crossed = countEstimatedFillSegments(
      fillScene({ contours: [square()], layer: { fillCrossHatch: true } }),
    );

    expect(single).toBeGreaterThan(0);
    expect(crossed).toBe(single * 2);
  });

  it('does not apply the scanline estimator to offset fill', () => {
    expect(
      countEstimatedFillSegments(
        fillScene({ contours: [square()], layer: { fillStyle: 'offset' } }),
      ),
    ).toBe(0);
  });

  it('uses an object fill override when the assigned layer is line mode', () => {
    expect(
      countEstimatedFillSegments(
        fillScene({
          contours: [square()],
          layer: { mode: 'line' },
          operationOverride: { mode: 'fill' },
        }),
      ),
    ).toBeGreaterThan(0);
  });

  it('does not estimate fill when an object override routes it to line mode', () => {
    expect(
      countEstimatedFillSegments(
        fillScene({ contours: [square()], operationOverride: { mode: 'line' } }),
      ),
    ).toBe(0);
  });

  it('includes enabled fill sublayers in the preparation estimate', () => {
    const scene = fillScene({ contours: [square()], layer: { mode: 'line' } });
    const layer = scene.layers[0];
    expect(layer).toBeDefined();
    if (layer === undefined) return;
    const fillSubLayer = createLayerSubLayer(
      { ...layer, mode: 'fill' },
      {
        id: 'fill-pass',
        label: 'Fill pass',
      },
    );

    expect(
      countEstimatedFillSegments({
        ...scene,
        layers: [{ ...layer, subLayers: [fillSubLayer] }],
      }),
    ).toBeGreaterThan(0);
  });

  it('excludes vector geometry routed to image mode by an object override', () => {
    expect(
      countOutputVectorSegments(
        fillScene({
          contours: [square()],
          layer: { mode: 'line' },
          operationOverride: { mode: 'image' },
        }),
      ),
    ).toBe(0);
  });

  it('counts vector geometry routed from image to line mode by an object override', () => {
    expect(
      countOutputVectorSegments(
        fillScene({
          contours: [square()],
          layer: { mode: 'image' },
          operationOverride: { mode: 'line' },
        }),
      ),
    ).toBeGreaterThan(0);
  });
});

function fillScene(options: {
  readonly contours: ReadonlyArray<ReturnType<typeof square>>;
  readonly layer?: Partial<ReturnType<typeof createLayer>>;
  readonly operationOverride?: ObjectOperationOverride;
}): Scene {
  const color = '#000000';
  const object: SceneObject = {
    kind: 'shape',
    id: 'shape',
    color,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: options.contours }],
    ...(options.operationOverride === undefined
      ? {}
      : { operationOverride: options.operationOverride }),
  };
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'fill', color, mode: 'fill' }),
        hatchSpacingMm: 1,
        ...options.layer,
      },
    ],
  };
}

function square() {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  };
}

it('classifies a counted fill over the compiled budget as over-budget and a small one as within', () => {
  expect(scenePreparationSize(fillScene({ contours: [square()] }))).toBe('within-budget');
  const wide = {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3000 },
      { x: 0, y: 3000 },
    ],
  };
  const scene = fillScene({ contours: [wide], layer: { hatchSpacingMm: 0.1 } });
  expect(scenePreparationSize(scene)).toBe('over-budget');
  expect(scenePreparationTooComplex(scene)).toBe(true);
});
