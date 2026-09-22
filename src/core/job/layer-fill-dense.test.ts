import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Polyline, type SceneObject } from '../scene';
import { collectFillSegmentsForLayer } from './layer-fill';

// Isolate the collector's argument-count boundary from the geometry engine's
// >1 GB working heap for this many contours. The real normalizer, winding,
// hole and fill-style semantics remain covered by layer-fill[-composition].
const normalization = vi.hoisted(() => ({ counts: [] as number[], failAt: -1 }));
vi.mock('../geometry/polygon-difference', () => {
  const normalize = (contours: ReadonlyArray<Polyline>) => {
    normalization.counts.push(contours.length);
    return normalization.counts.length === normalization.failAt
      ? { kind: 'error', error: { kind: 'operation-failed', message: 'Test engine failure' } }
      : { kind: 'ok', value: contours };
  };
  return {
    normalizeClosedPolylinesEvenOddChecked: normalize,
    normalizeClosedPolylinesNonZeroChecked: normalize,
  };
});

const COUNT = 150_000;
const color = '#000000';
const layer = { ...createLayer({ id: 'fill', color, mode: 'fill' }), hatchSpacingMm: 0.4 };
const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
const contours = Array.from({ length: COUNT }, (_, index): Polyline => {
  const x = (index % 500) * 0.4;
  const y = Math.floor(index / 500) * 0.4;
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + 0.2, y },
      { x: x + 0.2, y: y + 0.2 },
      { x, y: y + 0.2 },
    ],
  };
});

beforeEach(() => {
  normalization.counts = [];
  normalization.failAt = -1;
});

describe('dense fill contour collection', () => {
  it.each(['svg', 'nonzero-trace', 'batch-fallback', 'union-fallback'] as const)(
    '%s preserves all regions beyond the engine function-argument limit',
    (kind) => {
      if (kind === 'batch-fallback') normalization.failAt = 1;
      if (kind === 'union-fallback') normalization.failAt = 2;
      const object: SceneObject = {
        kind: kind === 'nonzero-trace' ? 'traced-image' : 'imported-svg',
        id: kind,
        source: 'dense',
        transform: IDENTITY_TRANSFORM,
        bounds: { minX: 0, minY: 0, maxX: 200, maxY: 120 },
        paths: [
          {
            color,
            polylines: contours,
            fillRule: kind === 'nonzero-trace' ? 'nonzero' : 'evenodd',
          },
        ],
      };
      const { segments } = collectFillSegmentsForLayer([object], layer, device);
      expect(normalization.counts).toEqual(kind === 'batch-fallback' ? [COUNT] : [COUNT, COUNT]);
      expect(segments).toHaveLength(COUNT);
      expect(
        segments.every((segment) => {
          const [a, b] = segment.polyline;
          return (
            a !== undefined &&
            b !== undefined &&
            a.y === b.y &&
            Number.isFinite(a.y) &&
            Math.abs(Math.abs(a.x - b.x) - 0.2) < 1e-6
          );
        }),
      ).toBe(true);
      expect(
        new Set(
          segments.map(
            ({ polyline: [a, b] }) =>
              `${Math.round(Math.min(a!.x, b!.x) / 0.4)}:${Math.round(a!.y / 0.4)}`,
          ),
        ).size,
      ).toBe(COUNT);
    },
  );
});
