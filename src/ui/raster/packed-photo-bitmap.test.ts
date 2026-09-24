import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Polyline,
  type TracedImage,
} from '../../core/scene';
import { MAX_RASTER_WORKING_BYTES } from '../../core/raster/raster-budget';
import { assembleBitmap, bitmapConversionTarget } from './bitmap-assembly';
import { assertBitmapConversionFits, estimateBitmapConversion } from './bitmap-conversion-plan';
import { packPhotoBitmapGeometry, packedPhotoBitmapResources } from './packed-photo-bitmap';
import { bitmapConversionResources } from './bitmap-conversion-resources';
import { lumaToBase64 } from './luma-bitmap';

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function source(rotationDeg = 0, mirrorX = false): TracedImage {
  const polylines = [
    rectangle(0, 0, 0.017, 10),
    rectangle(1, 0, 3, 10),
    rectangle(4, 0, 2, 10),
    rectangle(2, 3, 1, 4),
    rectangle(8, 1.2, 0.6, 6.7),
  ];
  return {
    kind: 'traced-image',
    id: 'photo',
    source: 'photo.png',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 3.7,
      y: -2.1,
      rotationDeg,
      mirrorX,
      scaleX: 1.1,
      scaleY: 0.8,
    },
    paths: [{ color: '#000000', polylines, curves: polylines.map(polylineToCurveSubpath) }],
  };
}

describe('packed photo bitmap assembly', () => {
  it('offers useful recovery for geometry limits separately from resolution limits', () => {
    const target = {
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
    };
    const geometryLimited = estimateBitmapConversion(
      {
        ...target,
        geometryStats: { sourceBytes: MAX_RASTER_WORKING_BYTES + 1, minimumFlattenedSegments: 0 },
      },
      254,
    );
    expect(() => assertBitmapConversionFits(geometryLimited)).toThrow(/lower trace Detail/);
    expect(() => assertBitmapConversionFits(geometryLimited)).toThrow(
      /Lower DPI or a smaller image will not resolve/,
    );
    const pixelsLimited = estimateBitmapConversion(
      { ...target, bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 } },
      254,
    );
    expect(() => assertBitmapConversionFits(pixelsLimited)).toThrow(
      /Lower DPI, scale the artwork down/,
    );
    expect(pixelsLimited.geometryExceedsBudget).toBe(false);
  });
  it.each([0, 17, 44, 45, 46, 90, 135, 271])(
    'matches existing coverage byte for byte at %s degrees, including mirror, holes and touching ribbons',
    (rotationDeg) => {
      for (const mirrorX of [false, true]) {
        const object = source(rotationDeg, mirrorX);
        const before = structuredClone(object);
        const geometry = packPhotoBitmapGeometry(object);
        expect(geometry).toBeDefined();
        if (geometry === undefined) throw new Error('Expected packed photo geometry');
        const options = {
          dpi: 254,
          brightnessPercent: 0,
          renderType: 'fill-all' as const,
          preserveCoverage: true,
          coverageAxis:
            Math.abs(Math.sin((rotationDeg * Math.PI) / 180)) >
            Math.abs(Math.cos((rotationDeg * Math.PI) / 180))
              ? ('y' as const)
              : ('x' as const),
        };
        const encode = (raster: { luma: Uint8Array }) => ({
          dataUrl: '',
          lumaBase64: lumaToBase64(raster.luma),
        });
        const expected = assembleBitmap([object], encode, 'raster', options);
        const metadata = { ...object, paths: [] };
        const actual = assembleBitmap([metadata], encode, 'raster', {
          ...options,
          photoRibbons: geometry,
        });
        expect(actual).toEqual(expected);
        expect(object).toEqual(before);
      }
    },
  );

  it('packs canonical lines instead of stale compatibility polylines, without changing the source', () => {
    const object = source();
    const canonical = packPhotoBitmapGeometry(object);
    const altered = {
      ...object,
      paths: object.paths.map((path) => ({ ...path, polylines: [rectangle(100, 100, 1, 1)] })),
    };
    expect(packPhotoBitmapGeometry(altered)).toEqual(canonical);
    expect(
      packPhotoBitmapGeometry({
        ...object,
        paths: object.paths.map((path) => ({ color: path.color, polylines: path.polylines })),
      }),
    ).toEqual(canonical);
  });

  it('keeps nonlinear curves, open contours and nonzero paths on the generic route', () => {
    const object = source();
    expect(
      packPhotoBitmapGeometry({
        ...object,
        paths: object.paths.map((path) => ({ ...path, fillRule: 'nonzero' })),
      }),
    ).toBeUndefined();
    expect(
      packPhotoBitmapGeometry({
        ...object,
        paths: [
          {
            color: '#000000',
            polylines: [],
            curves: [{ start: { x: 0, y: 0 }, closed: false, segments: [] }],
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      packPhotoBitmapGeometry({
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
                  {
                    kind: 'cubic',
                    control1: { x: 1, y: 0 },
                    control2: { x: 2, y: 0 },
                    to: { x: 3, y: 1 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('accounts for packed buffers, edge indexes, sort scratch and row coverage without raising the conversion budget', () => {
    const geometry = { points: new Float64Array(600_000), offsets: new Uint32Array([0, 300_000]) };
    const resources = packedPhotoBitmapResources(geometry);
    expect(resources.sourceBytes).toBeGreaterThan(geometry.points.byteLength * 4);
    const plan = bitmapConversionResources(640, 640, resources);
    expect(plan.verdict.kind).toBe('ok');
    expect(plan.verdict.budget.estimatedWorkingBytes).toBeLessThan(MAX_RASTER_WORKING_BYTES);
    expect(bitmapConversionResources(2000, 2000, resources).verdict.kind).toBe('too-large');
    const malformed = { points: new Float64Array(8), offsets: new Uint32Array([0, 5]) };
    expect(() => packedPhotoBitmapResources(malformed)).toThrow(/contour/);
    expect(() => bitmapConversionTarget([source()], geometry)).toThrow(/metadata-only/);
    const target = bitmapConversionTarget(
      [{ ...source(), paths: [] }],
      packPhotoBitmapGeometry(source()),
    );
    expect(estimateBitmapConversion(target, 254).verdict.kind).toBe('ok');
  });
});
