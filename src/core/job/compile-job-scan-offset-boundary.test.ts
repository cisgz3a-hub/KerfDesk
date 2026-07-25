import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

const OUT_OF_RANGE_OFFSET_MM = 4.01;

function square(operationOverride?: SceneObject['operationOverride']): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
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
            ],
          },
        ],
      },
    ],
    ...(operationOverride === undefined ? {} : { operationOverride }),
  };
}

function raster(operationOverride?: RasterImage['operationOverride']): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster',
    source: 'raster.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AA==',
    ...(operationOverride === undefined ? {} : { operationOverride }),
  };
}

function expectCompileToPreserve(object: SceneObject, layer: ReturnType<typeof createLayer>): void {
  expect(
    compileJob({ objects: [object], layers: [layer] }, DEFAULT_DEVICE_PROFILE).groups,
  ).toContainEqual(expect.objectContaining({ bidirectionalScanOffsetMm: OUT_OF_RANGE_OFFSET_MM }));
}

describe('compileJob explicit scan-offset boundary', () => {
  it.each(['scanline', 'island'] as const)(
    'preserves an out-of-policy %s fill layer offset for Job Review',
    (fillStyle) => {
      const layer = {
        ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
        fillStyle,
        hatchSpacingMm: 1,
        bidirectionalScanOffsetMm: OUT_OF_RANGE_OFFSET_MM,
      };

      expectCompileToPreserve(square(), layer);
    },
  );

  it('preserves an out-of-policy vector object override for Job Review', () => {
    const layer = createLayer({ id: 'line', color: '#000000', mode: 'line' });
    const object = square({
      mode: 'fill',
      hatchSpacingMm: 1,
      bidirectionalScanOffsetMm: OUT_OF_RANGE_OFFSET_MM,
    });

    expectCompileToPreserve(object, layer);
  });

  it('preserves out-of-policy raster layer and object overrides for Job Review', () => {
    const layer = createLayer({ id: 'image', color: '#000000', mode: 'image' });
    expectCompileToPreserve(raster(), {
      ...layer,
      bidirectionalScanOffsetMm: OUT_OF_RANGE_OFFSET_MM,
    });
    expectCompileToPreserve(raster({ bidirectionalScanOffsetMm: OUT_OF_RANGE_OFFSET_MM }), layer);
  });

  // Rule 7 / ADR-228 regression pin. This previously asserted a thrown
  // RangeError. That throw relied on the 'scan-offset-out-of-range' preflight
  // stopping the job first, but that code is not among the compile-integrity
  // codes either path refuses, and its message does not match
  // isProgramMaterializationRangeError — so it escaped UNCAUGHT on Start.
  // A non-finite override is now dropped so the device calibration applies;
  // preflight still reports it as an advisory. Compiling must not throw.
  it('drops a non-finite offset instead of throwing, falling back to calibration', () => {
    const layer = {
      ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
      hatchSpacingMm: 1,
      bidirectionalScanOffsetMm: Number.NaN,
    };

    expect(() =>
      compileJob({ objects: [square()], layers: [layer] }, DEFAULT_DEVICE_PROFILE),
    ).not.toThrow();

    const job = compileJob({ objects: [square()], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
    expect(job.groups.length).toBeGreaterThan(0);
  });

  it('preserves an explicit offset at the device limit', () => {
    const layer = {
      ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
      hatchSpacingMm: 1,
      bidirectionalScanOffsetMm: 4,
    };

    expect(
      compileJob({ objects: [square()], layers: [layer] }, DEFAULT_DEVICE_PROFILE).groups[0],
    ).toMatchObject({ bidirectionalScanOffsetMm: 4 });
  });
});
