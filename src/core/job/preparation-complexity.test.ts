import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  IDENTITY_TRANSFORM,
  type ObjectOperationOverride,
  type Scene,
  type SceneObject,
} from '../scene';
import { countEstimatedFillSegments, countOutputVectorSegments } from './preparation-complexity';

describe('fill preparation estimate', () => {
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
