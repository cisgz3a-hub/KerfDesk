import { describe, expect, it } from 'vitest';
import { MAX_RASTER_WORKING_BYTES } from '../../core/raster/raster-budget';
import {
  bitmapConversionResources,
  estimateBitmapGeometryResources,
} from './bitmap-conversion-resources';

describe('conversion peak allocation budget', () => {
  it('refuses the previously admitted 2896-square encoding peak and leaves room for flattened geometry', () => {
    const tooLarge = bitmapConversionResources(2896, 2896);
    expect(tooLarge.verdict.kind).toBe('too-large');
    expect(tooLarge.maxFlattenedSegments).toBe(0);
    const small = bitmapConversionResources(100, 100);
    expect(small.verdict.kind).toBe('ok');
    expect(small.verdict.budget.estimatedWorkingBytes).toBeGreaterThan(100 * 100 * 9);
    expect(small.maxFlattenedSegments).toBeGreaterThan(0);
  });

  it('accounts for cached polylines and canonical source geometry before worker cloning', () => {
    const stats = estimateBitmapGeometryResources([
      {
        paths: [
          {
            color: '#000000',
            polylines: [
              { closed: false, points: Array.from({ length: 200_000 }, () => ({ x: 0, y: 0 })) },
            ],
            curves: [
              {
                closed: false,
                start: { x: 0, y: 0 },
                segments: Array.from({ length: 100_000 }, () => ({
                  kind: 'line' as const,
                  to: { x: 1, y: 0 },
                })),
              },
            ],
          },
        ],
      },
    ]);
    expect(stats.sourceBytes).toBeGreaterThan(MAX_RASTER_WORKING_BYTES);
    expect(stats.minimumFlattenedSegments).toBe(100_000);
    expect(bitmapConversionResources(1, 1, stats).verdict.kind).toBe('too-large');
  });

  it('budgets minimum flattening as well as the serialized source and reduces remaining capacity', () => {
    const empty = bitmapConversionResources(100, 100);
    const geometry = { sourceBytes: 1024, minimumFlattenedSegments: 30 };
    const withGeometry = bitmapConversionResources(100, 100, geometry);
    expect(withGeometry.maxFlattenedSegments).toBeLessThan(empty.maxFlattenedSegments);
    expect(withGeometry.verdict.budget.estimatedWorkingBytes).toBeGreaterThan(
      empty.verdict.budget.estimatedWorkingBytes + geometry.sourceBytes,
    );
    expect(
      bitmapConversionResources(1, 1, { sourceBytes: 0, minimumFlattenedSegments: 1_000_000 })
        .verdict.kind,
    ).toBe('too-large');
  });

  it.each([0, -1, NaN, Infinity])('refuses invalid pixel dimensions (%s)', (width) => {
    expect(bitmapConversionResources(width, 1).verdict.kind).toBe('too-large');
  });
});
